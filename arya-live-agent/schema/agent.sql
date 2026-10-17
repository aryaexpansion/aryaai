-- AJAN TABLOLARI (ticket sistemi, onay kuyruğu, uyarılar, raporlar, denetim kaydı)

CREATE TABLE IF NOT EXISTS tickets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  subject     TEXT NOT NULL,
  category    TEXT,                               -- payment | coins | stream | account | technical | abuse | other
  priority    TEXT NOT NULL DEFAULT 'normal',     -- low | normal | high | urgent
  status      TEXT NOT NULL DEFAULT 'open',       -- open | waiting_user | waiting_admin | resolved | closed
  assigned_to TEXT,                               -- admin kullanıcı adı
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id, created_at);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   TEXT NOT NULL REFERENCES tickets(id),
  author_type TEXT NOT NULL,                      -- user | agent | admin
  author_id   TEXT,
  body        TEXT NOT NULL,
  internal    INTEGER NOT NULL DEFAULT 0,         -- 1 = yalnızca admin görür
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msgs_ticket ON ticket_messages(ticket_id, id);

-- Ajanın kendi başına yapmadığı, yetkili onayı bekleyen işlemler.
CREATE TABLE IF NOT EXISTS approvals (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,                     -- credit_coins | block_stream
  payload      TEXT NOT NULL,                     -- JSON
  reason       TEXT NOT NULL,
  source       TEXT NOT NULL,                     -- ticket | streams | payments
  source_ref   TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending | executing | executed | rejected | failed
  requested_at INTEGER NOT NULL,
  decided_at   INTEGER,
  decided_by   TEXT,
  result       TEXT
);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status, requested_at);

CREATE TABLE IF NOT EXISTS alerts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  module     TEXT NOT NULL,                       -- streams | payments | tickets
  severity   TEXT NOT NULL,                       -- info | warning | critical
  title      TEXT NOT NULL,
  detail     TEXT,
  dedupe_key TEXT UNIQUE,                         -- aynı uyarının tekrar üretilmesini engeller
  status     TEXT NOT NULL DEFAULT 'open',        -- open | acknowledged
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status, created_at);

CREATE TABLE IF NOT EXISTS reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,                     -- daily
  period_start INTEGER NOT NULL,
  period_end   INTEGER NOT NULL,
  data         TEXT NOT NULL,                     -- JSON rakamlar
  summary      TEXT,                              -- ajanın yazdığı Türkçe özet
  created_at   INTEGER NOT NULL,
  UNIQUE (kind, period_start)
);

-- Ajanın ve adminlerin yaptığı her işlemin değiştirilemez kaydı.
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      TEXT NOT NULL,                       -- agent | admin:<ad> | system
  module     TEXT NOT NULL,
  action     TEXT NOT NULL,
  ref        TEXT,
  detail     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at);
