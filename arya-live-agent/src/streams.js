import { audit, createApproval, intVar, now, raiseAlert, safeEqual } from './util.js';

const LIVE_STATES = new Set(['connected', 'reconnected', 'reconnecting']);

function streamApi(env, path, init = {}) {
  return fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/stream${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env.CF_STREAM_TOKEN}`, 'content-type': 'application/json' },
  });
}

// Cloudflare Notifications -> "Stream Live Input" webhook'u.
// Webhook hedefini oluştururken girilen gizli değer cf-webhook-auth başlığında gelir.
export async function handleStreamWebhook(request, env) {
  if (!safeEqual(request.headers.get('cf-webhook-auth') || '', env.STREAM_WEBHOOK_SECRET)) {
    return new Response('unauthorized', { status: 401 });
  }
  const payload = await request.json().catch(() => null);
  const data = payload?.data || {};
  const inputId = data.input_id;
  const event = data.event_type || '';
  if (!inputId) return new Response('ok'); // test bildirimi

  const t = now();
  if (event.endsWith('.connected')) {
    await env.DB.prepare(
      `UPDATE streams SET status = 'live', started_at = ?, ended_at = NULL
       WHERE live_input_uid = ? AND status != 'blocked'`
    ).bind(t, inputId).run();
  } else if (event.endsWith('.disconnected') || event.endsWith('.errored')) {
    await env.DB.prepare(
      `UPDATE streams SET status = 'ended', ended_at = ? WHERE live_input_uid = ? AND status = 'live'`
    ).bind(t, inputId).run();
    if (event.endsWith('.errored')) {
      await raiseAlert(env, {
        module: 'streams', severity: 'warning', title: 'Canlı yayın hata ile kesildi',
        detail: { live_input_uid: inputId, event }, dedupeKey: `stream-error:${inputId}:${Math.floor(t / 600000)}`,
      });
    }
  }
  await audit(env, 'system', 'streams', 'webhook', inputId, { event });
  return new Response('ok');
}

// Zamanlanmış kontrol: şikâyet yoğunluğu, çok uzun yayınlar ve kaçırılmış webhook'lar.
export async function checkStreams(env) {
  const t = now();
  const threshold = intVar(env, 'STREAM_REPORT_THRESHOLD', 5);
  const { results: live } = await env.DB.prepare(
    `SELECT s.id, s.user_id, s.live_input_uid, s.title, s.started_at, u.username,
       (SELECT COUNT(*) FROM stream_reports r WHERE r.stream_id = s.id AND r.created_at > ?) AS recent_reports
     FROM streams s JOIN users u ON u.id = s.user_id
     WHERE s.status = 'live' ORDER BY s.started_at LIMIT 200`
  ).bind(t - 30 * 60000).all();

  for (const s of live) {
    if (s.recent_reports >= threshold) {
      const { results: reasons } = await env.DB.prepare(
        `SELECT reason, COUNT(*) AS n FROM stream_reports WHERE stream_id = ? AND created_at > ?
         GROUP BY reason ORDER BY n DESC LIMIT 5`
      ).bind(s.id, t - 30 * 60000).all();
      await raiseAlert(env, {
        module: 'streams', severity: 'critical',
        title: `Yayın son 30 dakikada ${s.recent_reports} şikâyet aldı: @${s.username}`,
        detail: { stream_id: s.id, title: s.title, reasons }, dedupeKey: `stream-reports:${s.id}`,
      });
      const pending = await env.DB.prepare(
        `SELECT 1 FROM approvals WHERE kind = 'block_stream' AND source_ref = ? AND status = 'pending'`
      ).bind(s.id).first();
      if (!pending) {
        await createApproval(env, {
          kind: 'block_stream',
          payload: { stream_id: s.id, live_input_uid: s.live_input_uid },
          reason: `Son 30 dakikada ${s.recent_reports} şikâyet. Başlıca nedenler: ${reasons.map((r) => `${r.reason} (${r.n})`).join(', ')}`,
          source: 'streams',
          sourceRef: s.id,
        });
      }
    }
    if (s.started_at && t - s.started_at > 12 * 3600000) {
      await raiseAlert(env, {
        module: 'streams', severity: 'info', title: `12 saati aşan yayın: @${s.username}`,
        detail: { stream_id: s.id }, dedupeKey: `stream-long:${s.id}`,
      });
    }
  }

  // Webhook kaçırıldıysa durumu Stream API'den doğrula (alt istek sınırı için en fazla 40).
  if (env.CF_STREAM_TOKEN && env.CF_ACCOUNT_ID) {
    for (const s of live.slice(0, 40)) {
      const res = await streamApi(env, `/live_inputs/${s.live_input_uid}`);
      if (!res.ok) continue;
      const state = (await res.json())?.result?.status?.current?.state;
      if (state && !LIVE_STATES.has(state)) {
        await env.DB.prepare(`UPDATE streams SET status = 'ended', ended_at = ? WHERE id = ? AND status = 'live'`)
          .bind(t, s.id).run();
      }
    }
  }
}

// Onaydan sonra çalışır: live input'u devre dışı bırakır, yayın yeniden başlatılamaz.
export async function blockStream(env, { stream_id, live_input_uid }) {
  const res = await streamApi(env, `/live_inputs/${live_input_uid}`, {
    method: 'PUT',
    body: JSON.stringify({ enabled: false }),
  });
  if (!res.ok) throw new Error(`Stream API ${res.status}: ${await res.text()}`);
  await env.DB.prepare(`UPDATE streams SET status = 'blocked', ended_at = ? WHERE id = ?`)
    .bind(now(), stream_id).run();
  return { blocked: stream_id };
}
