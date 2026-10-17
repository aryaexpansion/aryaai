import { intVar, now, raiseAlert } from './util.js';

const LOOKBACK = 10 * 60000; // cron 5 dk'da bir çalışır; 10 dk pencere boşluk bırakmaz, dedupe tekrarı önler

export async function checkPayments(env) {
  const t = now();
  const pendingMin = intVar(env, 'PENDING_PAYMENT_MINUTES', 30);
  const largeCoins = intVar(env, 'LARGE_TRANSFER_COINS', 5000);
  const all = (sql, ...args) => env.DB.prepare(sql).bind(...args).all().then((r) => r.results);

  // 1) Uzun süre "pending" kalan ödemeler (banka dönüşü gelmemiş olabilir).
  const stale = await all(
    `SELECT p.id, p.order_id, p.amount_kurus, p.coins, p.created_at, u.username
     FROM payments p JOIN users u ON u.id = p.user_id
     WHERE p.status = 'pending' AND p.created_at < ? AND p.created_at > ? LIMIT 100`,
    t - pendingMin * 60000, t - 24 * 3600000
  );
  for (const p of stale) {
    await raiseAlert(env, {
      module: 'payments', severity: 'warning',
      title: `Ödeme ${pendingMin} dakikadır beklemede: ${p.order_id} (@${p.username})`,
      detail: p, dedupeKey: `pay-pending:${p.id}`,
    });
  }

  // 2) Ödendi ama jeton yüklenmedi: kullanıcı parasını verdi, jetonunu alamadı.
  const uncredited = await all(
    `SELECT p.id, p.order_id, p.coins, p.paid_at, u.username
     FROM payments p JOIN users u ON u.id = p.user_id
     WHERE p.status = 'paid' AND p.credited_at IS NULL AND p.paid_at < ? LIMIT 100`,
    t - 5 * 60000
  );
  for (const p of uncredited) {
    await raiseAlert(env, {
      module: 'payments', severity: 'critical',
      title: `Ödeme alındı fakat jeton yüklenmedi: ${p.order_id} (@${p.username}, ${p.coins} jeton)`,
      detail: p, dedupeKey: `pay-uncredited:${p.id}`,
    });
  }

  // 3) Aynı ödeme için birden fazla jeton yüklemesi (çift yükleme).
  const doubles = await all(
    `SELECT ref, user_id, COUNT(*) AS n, SUM(delta) AS total FROM coin_ledger
     WHERE kind = 'purchase' AND ref IS NOT NULL AND ref IN (
       SELECT ref FROM coin_ledger WHERE kind = 'purchase' AND created_at > ?)
     GROUP BY ref, user_id HAVING n > 1`,
    t - LOOKBACK
  );
  for (const d of doubles) {
    await raiseAlert(env, {
      module: 'payments', severity: 'critical', title: `Aynı ödeme ${d.n} kez yüklendi: ${d.ref}`,
      detail: d, dedupeKey: `pay-double:${d.ref}`,
    });
  }

  // 4) Büyük tek seferlik hediye/aktarımlar.
  const large = await all(
    `SELECT l.id, l.user_id, l.delta, l.counterparty, l.created_at, u.username
     FROM coin_ledger l JOIN users u ON u.id = l.user_id
     WHERE l.kind = 'gift_sent' AND -l.delta >= ? AND l.created_at > ? LIMIT 100`,
    largeCoins, t - LOOKBACK
  );
  for (const l of large) {
    await raiseAlert(env, {
      module: 'payments', severity: 'warning',
      title: `Büyük jeton aktarımı: @${l.username} ${-l.delta} jeton gönderdi`,
      detail: l, dedupeKey: `ledger-large:${l.id}`,
    });
  }

  // 5) Bakiye ile hareket defteri uyuşmazlığı (yalnızca son hareketi olan kullanıcılar).
  const mismatched = await all(
    `SELECT u.id, u.username, u.coin_balance, COALESCE(SUM(l.delta), 0) AS ledger_sum
     FROM users u LEFT JOIN coin_ledger l ON l.user_id = u.id
     WHERE u.id IN (SELECT DISTINCT user_id FROM coin_ledger WHERE created_at > ?)
     GROUP BY u.id HAVING u.coin_balance != ledger_sum LIMIT 100`,
    t - LOOKBACK
  );
  for (const m of mismatched) {
    await raiseAlert(env, {
      module: 'payments', severity: 'critical',
      title: `Bakiye tutarsız: @${m.username} (bakiye ${m.coin_balance}, defter ${m.ledger_sum})`,
      detail: m, dedupeKey: `balance-mismatch:${m.id}:${m.coin_balance}`,
    });
  }
}
