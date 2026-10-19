const EVENTS = new Set(['connected', 'won', 'lost', 'launched', 'averted']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BODY_CHAR_LIMIT = 256;
// Preserve the existing UTF-16 character limit, including headerless UTF-8 JSON.
// This independent byte budget also bounds input before any chunk is decoded.
const BODY_BYTE_LIMIT = BODY_CHAR_LIMIT * 4;
const TOTALS = 'SELECT players, winners, losers, launched, averted, revision FROM totals WHERE id = 1';

function json(body, status = 200, extra = {}) {
  return Response.json(body, { status, headers: {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra
  } });
}

function snapshot(row) {
  const { revision, ...totals } = row;
  return { totals, revision };
}

async function readBoundedBody(request) {
  if (!request.body) return '';
  const reader = request.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, text = '';
  const reject = () => {
    // An upstream cancellation failure must not delay the 413 response.
    reader.cancel().catch(() => {});
    return null;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > BODY_BYTE_LIMIT) return reject();
      text += decoder.decode(value, { stream: true });
      if (text.length > BODY_CHAR_LIMIT) return reject();
    }
    text += decoder.decode();
    return text.length > BODY_CHAR_LIMIT ? null : text;
  } finally {
    reader.releaseLock();
  }
}

export async function onRequest({ request, env }) {
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405, { Allow: 'GET, POST' });
  if (!env.STATS_DB) return json({ error: 'Statistics temporarily unavailable' }, 503);
  try {
    if (request.method === 'GET') return json(snapshot(await env.STATS_DB.prepare(TOTALS).first()));
    // Writes are same-origin JSON only. Player IDs are random, never derived
    // from names, IP addresses, devices or other fingerprinting information.
    if (request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: 'Invalid origin' }, 403);
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return json({ error: 'JSON required' }, 415);
    if (Number(request.headers.get('Content-Length')) > BODY_CHAR_LIMIT) return json({ error: 'Request too large' }, 413);
    const raw = await readBoundedBody(request);
    if (raw === null) return json({ error: 'Request too large' }, 413);
    let data;
    try { data = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!data || typeof data.playerId !== 'string' || !UUID.test(data.playerId) || !EVENTS.has(data.event)) return json({ error: 'Invalid player or event' }, 400);
    const flags = ['won', 'lost', 'launched', 'averted'].map(event => Number(data.event === event));
    const update = env.STATS_DB.prepare(`
      INSERT INTO players (id, won, lost, launched, averted) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        won = MAX(players.won, excluded.won),
        lost = MAX(players.lost, excluded.lost),
        launched = MAX(players.launched, excluded.launched),
        averted = MAX(players.averted, excluded.averted)
      WHERE players.won < excluded.won OR players.lost < excluded.lost
         OR players.launched < excluded.launched OR players.averted < excluded.averted
    `).bind(data.playerId.toLowerCase(), ...flags);
    // Atomic upsert + triggers + snapshot. Concurrent/retried events cannot
    // increment an achievement twice or lose another player's update.
    const results = await env.STATS_DB.batch([update, env.STATS_DB.prepare(TOTALS)]);
    return json(snapshot(results[1].results[0]));
  } catch (error) {
    console.error('Statistics database unavailable:', error.message);
    return json({ error: 'Statistics temporarily unavailable' }, 503);
  }
}
