import { decideApproval } from './approvals.js';
import { checkPayments } from './payments.js';
import { buildDailyReport, runYesterdayReport } from './reports.js';
import { checkStreams, handleStreamWebhook } from './streams.js';
import {
  addUserMessage, createTicket, getTicket, listUserTickets, runTicketAgent,
} from './tickets.js';
import {
  audit, bearer, error, HttpError, istanbulDayStart, json, now, readJson, safeEqual,
} from './util.js';

const TICKET_STATUSES = ['open', 'waiting_user', 'waiting_admin', 'resolved', 'closed'];

// /internal/* : ana uygulama (aryalive.tr) kullanıcıyı kendi oturumuyla doğrular,
// sonra bu servisi INTERNAL_TOKEN ve X-User-Id başlığıyla çağırır.
async function internalRoutes(request, env, ctx, parts) {
  if (!safeEqual(bearer(request), env.INTERNAL_TOKEN)) throw new HttpError(401, 'Yetkisiz');
  const userId = request.headers.get('x-user-id');
  if (!userId) throw new HttpError(400, 'X-User-Id gerekli');
  const [, resource, id, sub] = parts;
  const m = request.method;

  if (resource !== 'tickets') throw new HttpError(404, 'Bulunamadı');
  if (!id && m === 'GET') return json(await listUserTickets(env, userId));
  if (!id && m === 'POST') {
    const ticketId = await createTicket(env, userId, await readJson(request));
    ctx.waitUntil(runTicketAgent(env, ticketId));
    return json({ id: ticketId }, 201);
  }
  if (id && !sub && m === 'GET') return json(await getTicket(env, id, { userId }));
  if (id && sub === 'messages' && m === 'POST') {
    const { body } = await readJson(request);
    await addUserMessage(env, userId, id, body);
    ctx.waitUntil(runTicketAgent(env, id));
    return json({ ok: true }, 201);
  }
  throw new HttpError(404, 'Bulunamadı');
}

// /admin/* : aryalive.tr admin paneli ADMIN_TOKEN ve X-Admin-User ile çağırır.
async function adminRoutes(request, env, ctx, parts) {
  if (!safeEqual(bearer(request), env.ADMIN_TOKEN)) throw new HttpError(401, 'Yetkisiz');
  const admin = (request.headers.get('x-admin-user') || '').trim().slice(0, 64);
  if (!admin) throw new HttpError(400, 'X-Admin-User gerekli');
  const url = new URL(request.url);
  const q = (k) => url.searchParams.get(k);
  const limit = Math.min(parseInt(q('limit'), 10) || 50, 200);
  const [, resource, id, action] = parts;
  const m = request.method;
  const DB = env.DB;
  const all = (sql, ...args) => DB.prepare(sql).bind(...args).all().then((r) => r.results);

  switch (resource) {
    case 'dashboard': {
      const today = istanbulDayStart(now());
      const [tickets, approvals, alerts, live, revenue] = await DB.batch([
        DB.prepare(`SELECT status, COUNT(*) AS n FROM tickets WHERE status NOT IN ('closed') GROUP BY status`),
        DB.prepare(`SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'`),
        DB.prepare(`SELECT severity, COUNT(*) AS n FROM alerts WHERE status = 'open' GROUP BY severity`),
        DB.prepare(`SELECT COUNT(*) AS n FROM streams WHERE status = 'live'`),
        DB.prepare(`SELECT COALESCE(SUM(amount_kurus), 0) AS kurus, COUNT(*) AS n FROM payments
                    WHERE status = 'paid' AND paid_at >= ?`).bind(today),
      ]);
      return json({
        tickets: tickets.results,
        pending_approvals: approvals.results[0].n,
        open_alerts: alerts.results,
        live_streams: live.results[0].n,
        today_revenue_kurus: revenue.results[0].kurus,
        today_payments: revenue.results[0].n,
      });
    }

    case 'tickets': {
      if (!id && m === 'GET') {
        const status = q('status');
        return json(status
          ? await all('SELECT * FROM tickets WHERE status = ? ORDER BY updated_at DESC LIMIT ?', status, limit)
          : await all('SELECT * FROM tickets ORDER BY updated_at DESC LIMIT ?', limit));
      }
      if (id && !action && m === 'GET') return json(await getTicket(env, id, { includeInternal: true }));
      if (id && action === 'messages' && m === 'POST') {
        const { body, internal } = await readJson(request);
        const text = String(body ?? '').trim().slice(0, 5000);
        if (!text) throw new HttpError(400, 'Mesaj boş olamaz');
        await getTicket(env, id); // var mı kontrolü
        // Admin yanıt verince talep onun üzerine geçer; ajan bu talepte artık yanıt vermez.
        await DB.batch([
          DB.prepare(`INSERT INTO ticket_messages (ticket_id, author_type, author_id, body, internal, created_at)
                      VALUES (?, 'admin', ?, ?, ?, ?)`).bind(id, admin, text, internal ? 1 : 0, now()),
          internal
            ? DB.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').bind(now(), id)
            : DB.prepare(`UPDATE tickets SET status = 'waiting_user', assigned_to = COALESCE(assigned_to, ?), updated_at = ?
                          WHERE id = ?`).bind(admin, now(), id),
        ]);
        await audit(env, `admin:${admin}`, 'tickets', internal ? 'note' : 'reply', id);
        return json({ ok: true }, 201);
      }
      if (id && action === 'assign' && m === 'POST') {
        // assignee: null => talebi tekrar ajana bırak
        const { assignee } = await readJson(request);
        const value = assignee ? String(assignee).slice(0, 64) : null;
        await DB.prepare(`UPDATE tickets SET assigned_to = ?, status = CASE WHEN ? IS NULL AND status = 'waiting_admin'
                          THEN 'open' ELSE status END, updated_at = ? WHERE id = ?`)
          .bind(value, value, now(), id).run();
        await audit(env, `admin:${admin}`, 'tickets', 'assign', id, { assignee: value });
        if (!value) ctx.waitUntil(runTicketAgent(env, id));
        return json({ ok: true });
      }
      if (id && action === 'status' && m === 'POST') {
        const { status } = await readJson(request);
        if (!TICKET_STATUSES.includes(status)) throw new HttpError(400, 'Geçersiz durum');
        await DB.prepare('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?').bind(status, now(), id).run();
        await audit(env, `admin:${admin}`, 'tickets', 'status', id, { status });
        return json({ ok: true });
      }
      break;
    }

    case 'approvals': {
      if (!id && m === 'GET') {
        return json(await all('SELECT * FROM approvals WHERE status = ? ORDER BY requested_at DESC LIMIT ?',
          q('status') || 'pending', limit));
      }
      if (id && (action === 'approve' || action === 'reject') && m === 'POST') {
        const { note } = await readJson(request).catch(() => ({}));
        return json(await decideApproval(env, id, admin, action, note));
      }
      break;
    }

    case 'alerts': {
      if (!id && m === 'GET') {
        return json(await all('SELECT * FROM alerts WHERE status = ? ORDER BY created_at DESC LIMIT ?',
          q('status') || 'open', limit));
      }
      if (id && action === 'ack' && m === 'POST') {
        await DB.prepare(`UPDATE alerts SET status = 'acknowledged' WHERE id = ?`).bind(id).run();
        await audit(env, `admin:${admin}`, 'alerts', 'ack', id);
        return json({ ok: true });
      }
      break;
    }

    case 'reports': {
      if (!id && m === 'GET') {
        return json(await all('SELECT * FROM reports ORDER BY period_start DESC LIMIT ?', limit));
      }
      if (id === 'run' && m === 'POST') {
        // { "date": "2026-10-16" } verilmezse dünün raporu üretilir
        const { date } = await readJson(request).catch(() => ({}));
        const start = date
          ? istanbulDayStart(Date.parse(`${date}T12:00:00+03:00`))
          : istanbulDayStart(now()) - 86400000;
        if (!Number.isFinite(start)) throw new HttpError(400, 'Tarih YYYY-AA-GG biçiminde olmalı');
        return json(await buildDailyReport(env, start));
      }
      break;
    }

    case 'audit':
      if (m === 'GET') return json(await all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', limit));
      break;
  }
  throw new HttpError(404, 'Bulunamadı');
}

export default {
  async fetch(request, env, ctx) {
    const parts = new URL(request.url).pathname.split('/').filter(Boolean);
    try {
      if (parts[0] === 'webhooks' && parts[1] === 'stream' && request.method === 'POST') {
        return await handleStreamWebhook(request, env);
      }
      if (parts[0] === 'internal') return await internalRoutes(request, env, ctx, parts);
      if (parts[0] === 'admin') return await adminRoutes(request, env, ctx, parts);
      if (parts.length === 0) return json({ service: 'arya-live-agent', ok: true });
      return error(404, 'Bulunamadı');
    } catch (e) {
      if (e instanceof HttpError) return error(e.status, e.message);
      console.error(e);
      return error(500, 'Sunucu hatası');
    }
  },

  async scheduled(event, env, ctx) {
    if (event.cron === '0 21 * * *') {
      ctx.waitUntil(runYesterdayReport(env));
      return;
    }
    // Biri hata verse de diğeri çalışsın.
    const results = await Promise.allSettled([checkStreams(env), checkPayments(env)]);
    for (const r of results) if (r.status === 'rejected') console.error(r.reason);
  },
};
