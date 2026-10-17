// Claude Messages API ile araç (tool) kullanan basit ajan döngüsü.
async function callClaude(env, body) {
  const base = env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: env.AGENT_MODEL, max_tokens: 2048, ...body }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  return res.json();
}

const textOf = (content) =>
  content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

// handlers: { araç_adı: async (input) => sonuç }. Araç hataları modele geri
// bildirilir; model düzeltip devam edebilir.
export async function runAgent(env, { system, messages, tools, handlers, maxTurns = 8 }) {
  const msgs = [...messages];
  for (let turn = 0; turn < maxTurns; turn++) {
    const data = await callClaude(env, { system, tools, messages: msgs });
    msgs.push({ role: 'assistant', content: data.content });
    if (data.stop_reason !== 'tool_use') return textOf(data.content);

    const results = [];
    for (const block of data.content) {
      if (block.type !== 'tool_use') continue;
      let out;
      let isError = false;
      try {
        const handler = handlers[block.name];
        if (!handler) throw new Error(`Bilinmeyen araç: ${block.name}`);
        out = await handler(block.input || {});
      } catch (e) {
        out = { error: String(e?.message || e) };
        isError = true;
      }
      results.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(out ?? { ok: true }),
        is_error: isError,
      });
    }
    msgs.push({ role: 'user', content: results });
  }
  throw new Error('Ajan tur sınırını aştı');
}

// Araçsız tek seferlik metin üretimi (rapor özetleri için).
export async function complete(env, system, prompt) {
  const data = await callClaude(env, { system, messages: [{ role: 'user', content: prompt }] });
  return textOf(data.content);
}
