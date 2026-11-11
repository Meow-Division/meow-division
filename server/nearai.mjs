// server/nearai.mjs — NEAR AI Cloud (cloud.near.ai, docs.near.ai): its OpenAI-compatible chat completions, asked for
// Walt's words (server/waltai.mjs) and the market watch (server/watch.mjs). The model runs in NEAR AI's attested TEE.
// The key comes from the environment (NEAR_AI_API_KEY) and goes only into the request's Authorization header: no
// error, log line or answer here carries it (an error says the HTTP status alone). No key: off, and every caller keeps
// its plain texts. The model's thinking is turned off (chat_template_kwargs.thinking: a short line in 2–10 s instead of
// 30–50, a tenth of the tokens) and the reply asked as a JSON object. A day's token cap bounds what the server can spend
// (NEAR_AI_DAILY_TOKENS; a call that could go past it is not made).
const DAY = 864e5;

export function makeNearAI({
  key = '',
  base = 'https://cloud-api.near.ai/v1',
  model = 'deepseek-ai/DeepSeek-V4.1-Flash-1017',
  dailyTokens = 300e3,
  timeoutMs = 45e3,
  fetch: get = globalThis.fetch,
} = {}) {
  const url = String(base).replace(/\/+$/, '') + '/chat/completions';
  let day = Math.floor(Date.now() / DAY),
    used = 0,
    calls = 0,
    fails = 0;
  const roll = () => {
    const d = Math.floor(Date.now() / DAY);
    if (d !== day) [day, used, calls, fails] = [d, 0, 0, 0];
  };
  // one exchange: the messages, at most maxTokens back; resolves to the reply's JSON object, throws on anything else
  async function json(messages, { maxTokens = 800, temperature = 0.8 } = {}) {
    if (!key) throw new Error('off');
    roll();
    if (used + maxTokens > dailyTokens) throw new Error("the day's tokens are spent");
    calls++;
    const ac = new AbortController(),
      t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await get(url, {
        method: 'POST',
        signal: ac.signal,
        headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature,
          response_format: { type: 'json_object' },
          chat_template_kwargs: { thinking: false },
        }),
      });
      const text = await r.text();
      if (!r.ok) throw new Error('http ' + r.status); // (not the body: an API's error may quote part of the key)
      const j = JSON.parse(text);
      used += Number.isFinite(j?.usage?.total_tokens) ? j.usage.total_tokens : maxTokens;
      const c = j?.choices?.[0]?.message?.content;
      if (typeof c !== 'string') throw new Error('no reply');
      return parse(c);
    } catch (e) {
      fails++;
      throw e.name === 'AbortError' ? new Error('timed out') : e;
    } finally {
      clearTimeout(t);
    }
  }
  return {
    on: () => !!key,
    model,
    json,
    // what today cost (the tokens counted from the replies), for GET /api/health and the log
    usage() {
      roll();
      return { used, calls, fails, cap: dailyTokens };
    },
  };
}

// the reply's object: the content as JSON, or the first {...} in it (a model that wraps it in a fence or a word)
export function parse(c) {
  const i = c.indexOf('{'),
    j = c.lastIndexOf('}');
  if (i < 0 || j < i) throw new Error('not json');
  const o = JSON.parse(c.slice(i, j + 1));
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('not an object');
  return o;
}
