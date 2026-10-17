import { complete } from './llm.js';
import { istanbulDayStart, now } from './util.js';

const SUMMARY_PROMPT = `Sen Arya Live Music'in operasyon analistisin. Sana bir günün rakamları JSON olarak verilecek.
Yöneticiler için Türkçe, kısa bir günlük özet yaz: gelir, jeton hareketi, yayınlar, destek talepleri.
Dikkat gerektiren noktaları (kritik uyarılar, bekleyen ödemeler, devredilen talepler) ayrı madde olarak belirt.
Rakam uydurma; yalnızca verilen veriyi kullan. Tutarlar kuruş cinsindendir, TL'ye çevirerek yaz.`;

export async function buildDailyReport(env, dayStart) {
  const from = dayStart;
  const to = dayStart + 86400000;
  const first = (sql, ...args) => env.DB.prepare(sql).bind(...args).first();
  const all = (sql, ...args) => env.DB.prepare(sql).bind(...args).all().then((r) => r.results);

  const data = {
    period: { from, to },
    payments: await first(
      `SELECT
         SUM(CASE WHEN status IN ('paid','refunded') AND paid_at >= ?1 AND paid_at < ?2 THEN amount_kurus ELSE 0 END) AS revenue_kurus,
         SUM(CASE WHEN status IN ('paid','refunded') AND paid_at >= ?1 AND paid_at < ?2 THEN 1 ELSE 0 END) AS paid_count,
         SUM(CASE WHEN status IN ('paid','refunded') AND paid_at >= ?1 AND paid_at < ?2 THEN coins ELSE 0 END) AS coins_sold,
         SUM(CASE WHEN status = 'failed' AND created_at >= ?1 AND created_at < ?2 THEN 1 ELSE 0 END) AS failed_count,
         SUM(CASE WHEN status = 'pending' AND created_at < ?2 THEN 1 ELSE 0 END) AS still_pending,
         COUNT(DISTINCT CASE WHEN status IN ('paid','refunded') AND paid_at >= ?1 AND paid_at < ?2 THEN user_id END) AS paying_users
       FROM payments`, from, to),
    coins: await first(
      `SELECT
         SUM(CASE WHEN kind = 'gift_sent' THEN -delta ELSE 0 END) AS gifted,
         SUM(CASE WHEN kind = 'gift_sent' THEN 1 ELSE 0 END) AS gift_count,
         SUM(CASE WHEN kind IN ('refund','adjustment') THEN delta ELSE 0 END) AS adjustments
       FROM coin_ledger WHERE created_at >= ? AND created_at < ?`, from, to),
    top_receivers: await all(
      `SELECT u.username, SUM(l.delta) AS coins FROM coin_ledger l JOIN users u ON u.id = l.user_id
       WHERE l.kind = 'gift_received' AND l.created_at >= ? AND l.created_at < ?
       GROUP BY l.user_id ORDER BY coins DESC LIMIT 10`, from, to),
    top_senders: await all(
      `SELECT u.username, SUM(-l.delta) AS coins FROM coin_ledger l JOIN users u ON u.id = l.user_id
       WHERE l.kind = 'gift_sent' AND l.created_at >= ? AND l.created_at < ?
       GROUP BY l.user_id ORDER BY coins DESC LIMIT 10`, from, to),
    streams: await first(
      `SELECT COUNT(*) AS started, COUNT(DISTINCT user_id) AS streamers,
         ROUND(SUM(MIN(COALESCE(ended_at, ?2), ?2) - started_at) / 3600000.0, 1) AS hours,
         SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked
       FROM streams WHERE started_at >= ?1 AND started_at < ?2`, from, to),
    stream_reports: await first(
      'SELECT COUNT(*) AS n FROM stream_reports WHERE created_at >= ? AND created_at < ?', from, to),
    tickets: await first(
      `SELECT COUNT(*) AS created,
         SUM(CASE WHEN status IN ('resolved','closed') THEN 1 ELSE 0 END) AS resolved
       FROM tickets WHERE created_at >= ? AND created_at < ?`, from, to),
    tickets_by_category: await all(
      `SELECT COALESCE(category, 'uncategorized') AS category, COUNT(*) AS n FROM tickets
       WHERE created_at >= ? AND created_at < ? GROUP BY category ORDER BY n DESC`, from, to),
    tickets_waiting_admin: (await first(`SELECT COUNT(*) AS n FROM tickets WHERE status = 'waiting_admin'`)).n,
    approvals_pending: (await first(`SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'`)).n,
    alerts: await all(
      `SELECT severity, COUNT(*) AS n FROM alerts WHERE created_at >= ? AND created_at < ? GROUP BY severity`, from, to),
  };

  let summary = null;
  try {
    summary = await complete(env, SUMMARY_PROMPT, JSON.stringify(data));
  } catch (e) {
    summary = `Özet üretilemedi: ${String(e?.message || e)}`;
  }

  await env.DB.prepare(
    `INSERT INTO reports (kind, period_start, period_end, data, summary, created_at)
     VALUES ('daily', ?, ?, ?, ?, ?)
     ON CONFLICT(kind, period_start) DO UPDATE SET data = excluded.data, summary = excluded.summary, created_at = excluded.created_at`
  ).bind(from, to, JSON.stringify(data), summary, now()).run();
  return { data, summary };
}

// Cron TR saatiyle gece yarısı çalışır ve biten günü raporlar.
export const runYesterdayReport = (env) =>
  buildDailyReport(env, istanbulDayStart(now()) - 86400000);
