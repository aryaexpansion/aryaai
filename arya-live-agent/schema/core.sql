-- ANA UYGULAMA TABLOLARI
-- Ajanın okuduğu/yazdığı temel tablolar. Sizde bu tablolar farklı adlarla
-- veya alanlarla varsa bu dosyayı ÇALIŞTIRMAYIN; src/db.js içindeki
-- sorguları kendi tablolarınıza göre uyarlayın.
-- Tüm zaman alanları Unix milisaniye (Date.now()).

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  email         TEXT,
  coin_balance  INTEGER NOT NULL DEFAULT 0 CHECK (coin_balance >= 0),
  status        TEXT NOT NULL DEFAULT 'active',   -- active | suspended | deleted
  created_at    INTEGER NOT NULL
);

-- Sanal POS ödemeleri. Jeton YALNIZCA bankanın sunucudan sunucuya
-- doğrulaması (callback + hash kontrolü) sonrası status='paid' olunca yüklenir.
CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  order_id      TEXT NOT NULL UNIQUE,              -- bankaya gönderilen sipariş no
  amount_kurus  INTEGER NOT NULL,                  -- 149,90 TL => 14990
  coins         INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | paid | failed | refunded
  provider_ref  TEXT,                              -- bankanın işlem numarası
  created_at    INTEGER NOT NULL,
  paid_at       INTEGER,
  credited_at   INTEGER                            -- jetonun hesaba geçtiği an
);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status, created_at);

-- Tüm jeton hareketleri (yükleme, hediye, iade, düzeltme). Bakiye her zaman
-- bu defterle tutarlı olmalı.
CREATE TABLE IF NOT EXISTS coin_ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL REFERENCES users(id),
  delta         INTEGER NOT NULL,                  -- + giriş, - çıkış
  kind          TEXT NOT NULL,                     -- purchase | gift_sent | gift_received | refund | adjustment
  ref           TEXT,                              -- payment id, gift id, approval id ...
  counterparty  TEXT,                              -- hediyede karşı kullanıcı
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON coin_ledger(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_time ON coin_ledger(created_at);

-- Canlı yayınlar (Cloudflare Stream live input ile eşleşir).
CREATE TABLE IF NOT EXISTS streams (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  live_input_uid TEXT NOT NULL UNIQUE,
  title          TEXT,
  status         TEXT NOT NULL DEFAULT 'idle',     -- idle | live | ended | blocked
  started_at     INTEGER,
  ended_at       INTEGER
);

CREATE TABLE IF NOT EXISTS stream_reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  stream_id    TEXT NOT NULL REFERENCES streams(id),
  reporter_id  TEXT NOT NULL REFERENCES users(id),
  reason       TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_stream ON stream_reports(stream_id, created_at);
