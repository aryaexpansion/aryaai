import { blockStream } from './streams.js';
import { audit, HttpError, now } from './util.js';

async function creditCoins(env, approval, { user_id, coins }) {
  if (!Number.isInteger(coins) || coins <= 0) throw new Error('Geçersiz jeton miktarı');
  const res = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO coin_ledger (user_id, delta, kind, ref, created_at) VALUES (?, ?, 'refund', ?, ?)`
    ).bind(user_id, coins, approval.id, now()),
    env.DB.prepare('UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?').bind(coins, user_id),
  ]);
  if (!res[1].meta.changes) throw new Error('Kullanıcı bulunamadı');
  return { credited: coins, user_id };
}

const EXECUTORS = {
  credit_coins: creditCoins,
  block_stream: (env, _approval, payload) => blockStream(env, payload),
};

export async function decideApproval(env, id, admin, decision, note) {
  const approval = await env.DB.prepare('SELECT * FROM approvals WHERE id = ?').bind(id).first();
  if (!approval) throw new HttpError(404, 'Onay kaydı bulunamadı');

  // Koşullu güncelleme: iki admin aynı anda onaylasa da işlem bir kez çalışır.
  const next = decision === 'approve' ? 'executing' : 'rejected';
  const claim = await env.DB.prepare(
    `UPDATE approvals SET status = ?, decided_at = ?, decided_by = ?, result = ?
     WHERE id = ? AND status = 'pending'`
  ).bind(next, now(), admin, note ? JSON.stringify({ note }) : null, id).run();
  if (!claim.meta.changes) throw new HttpError(409, `Bu kayıt zaten işlenmiş (${approval.status})`);

  await audit(env, `admin:${admin}`, 'approvals', decision, id, { kind: approval.kind, note });
  if (decision !== 'approve') return { status: 'rejected' };

  const executor = EXECUTORS[approval.kind];
  try {
    if (!executor) throw new Error(`Bilinmeyen işlem türü: ${approval.kind}`);
    const result = await executor(env, approval, JSON.parse(approval.payload));
    await env.DB.prepare(`UPDATE approvals SET status = 'executed', result = ? WHERE id = ?`)
      .bind(JSON.stringify(result), id).run();

    if (approval.source === 'ticket' && approval.kind === 'credit_coins') {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO ticket_messages (ticket_id, author_type, body, created_at) VALUES (?, 'agent', ?, ?)`
        ).bind(approval.source_ref, `Talebiniz onaylandı ve hesabınıza ${result.credited} jeton yüklendi. Başka bir konuda yardımcı olabilir miyim?`, now()),
        env.DB.prepare(`UPDATE tickets SET status = 'waiting_user', updated_at = ? WHERE id = ? AND status = 'waiting_admin'`)
          .bind(now(), approval.source_ref),
      ]);
    }
    await audit(env, `admin:${admin}`, 'approvals', 'executed', id, result);
    return { status: 'executed', result };
  } catch (e) {
    const message = String(e?.message || e);
    await env.DB.prepare(`UPDATE approvals SET status = 'failed', result = ? WHERE id = ?`)
      .bind(JSON.stringify({ error: message }), id).run();
    await audit(env, 'system', 'approvals', 'failed', id, { error: message });
    return { status: 'failed', error: message };
  }
}
