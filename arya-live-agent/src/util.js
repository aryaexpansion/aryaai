export const now = () => Date.now();

export const newId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const error = (status, message) => json({ error: message }, status);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Geçersiz JSON gövdesi');
  }
}

// Zamanlama saldırısına karşı sabit süreli karşılaştırma.
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export function bearer(request) {
  const h = request.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

export function audit(env, actor, module, action, ref, detail) {
  return env.DB.prepare(
    'INSERT INTO audit_log (actor, module, action, ref, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(actor, module, action, ref ?? null, detail ? JSON.stringify(detail) : null, now()).run();
}

// dedupeKey verilirse aynı uyarı ikinci kez oluşturulmaz.
export function raiseAlert(env, { module, severity, title, detail, dedupeKey }) {
  return env.DB.prepare(
    `INSERT INTO alerts (module, severity, title, detail, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(dedupe_key) DO NOTHING`
  ).bind(module, severity, title, detail ? JSON.stringify(detail) : null, dedupeKey ?? null, now()).run();
}

export function createApproval(env, { kind, payload, reason, source, sourceRef }) {
  const id = newId('apr');
  return env.DB.prepare(
    `INSERT INTO approvals (id, kind, payload, reason, source, source_ref, requested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, kind, JSON.stringify(payload), reason, source, sourceRef ?? null, now()).run().then(() => id);
}

export const intVar = (env, name, fallback) => {
  const n = parseInt(env[name], 10);
  return Number.isFinite(n) ? n : fallback;
};

// İstanbul gününün (UTC+3) başlangıcı.
export function istanbulDayStart(ts) {
  const offset = 3 * 3600 * 1000;
  return Math.floor((ts + offset) / 86400000) * 86400000 - offset;
}
