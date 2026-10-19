import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/api/stats.js';

function fixture(t) {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync(new URL('../migrations/0001_player_stats.sql', import.meta.url), 'utf8'));
  t.after(() => database.close());
  const binding = {
    prepare(sql) {
      const statement = database.prepare(sql);
      return { statement, args: [], bind(...args) { this.args = args; return this; }, async first() { return statement.get(...this.args); } };
    },
    async batch(statements) {
      database.exec('BEGIN');
      try {
        const results = statements.map(s => ({ results: s.statement.all(...s.args) }));
        database.exec('COMMIT');
        return results;
      } catch (error) { database.exec('ROLLBACK'); throw error; }
    }
  };
  const send = (playerId, event, extra = {}) => onRequest({ env: { STATS_DB: binding }, request: new Request('https://game.example/api/stats', {
    method: 'POST', headers: { Origin: 'https://game.example', 'Content-Type': 'application/json', ...extra }, body: JSON.stringify({ playerId, event })
  }) });
  const get = () => onRequest({ env: { STATS_DB: binding }, request: new Request('https://game.example/api/stats') });
  return { database, binding, send, get };
}

test('only CONNECT creates a player; repeated visits, retries and resets do not inflate totals', async t => {
  const { get, send } = fixture(t);
  const id = crypto.randomUUID();
  for (let i = 0; i < 3; i++) assert.equal((await (await get()).json()).totals.players, 0);
  const first = await (await send(id, 'connected')).json();
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(await (await send(id, 'connected')).json(), first);
  }
  assert.deepEqual(first, { totals: { players: 1, winners: 0, losers: 0, launched: 0, averted: 0 }, revision: 1 });
});

test('wins/losses and both endings count distinct players, not rounds or repeats', async t => {
  const { get, send, database } = fixture(t);
  const [a, b, c] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await Promise.all([send(a, 'connected'), send(b, 'connected'), send(c, 'connected')]);
  for (let i = 0; i < 4; i++) await Promise.all([send(a, 'won'), send(a, 'lost'), send(a, 'launched'), send(a, 'averted'), send(b, 'lost'), send(b, 'launched')]);
  const data = await (await get()).json();
  assert.deepEqual(data.totals, { players: 3, winners: 1, losers: 2, launched: 2, averted: 1 });
  assert.equal(data.revision, 9);
  const actual = database.prepare('SELECT COUNT(*) players, SUM(won) winners, SUM(lost) losers, SUM(launched) launched, SUM(averted) averted FROM players').get();
  assert.deepEqual(data.totals, { ...actual }, 'Materialized totals must match the player records');
});

test('out-of-order events still create one anonymous player and normalize the ID', async t => {
  const { get, send } = fixture(t);
  const id = crypto.randomUUID();
  await send(id.toUpperCase(), 'averted');
  await send(id, 'connected');
  await send(id, 'averted');
  assert.deepEqual((await (await get()).json()).totals, { players: 1, winners: 0, losers: 0, launched: 0, averted: 1 });
});

test('invalid and cross-origin writes cannot change statistics; reads reveal only totals', async t => {
  const { get, send, binding } = fixture(t);
  assert.equal((await send('invalid', 'won')).status, 400);
  assert.equal((await send(crypto.randomUUID(), 'draw')).status, 400);
  assert.equal((await send(crypto.randomUUID(), 'won', { Origin: 'https://other.example' })).status, 403);
  assert.equal((await send(crypto.randomUUID(), 'won', { 'Content-Type': 'text/plain' })).status, 415);
  const oversized = new Request('https://game.example/api/stats', { method: 'POST', headers: { Origin: 'https://game.example', 'Content-Type': 'application/json' }, body: ' '.repeat(257) });
  assert.equal((await onRequest({ env: { STATS_DB: binding }, request: oversized })).status, 413);
  const response = await get();
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(Object.keys(await response.json()), ['totals', 'revision']);
  assert.equal((await (await get()).json()).totals.players, 0);
  assert.equal((await onRequest({ env: {}, request: new Request('https://game.example/api/stats') })).status, 503);
});


function streamedRequest(chunks, { length, cancel = () => {} } = {}) {
  let reads = 0, cancellations = 0;
  const body = new ReadableStream({
    pull(controller) {
      reads++;
      if (reads <= chunks.length) controller.enqueue(chunks[reads - 1]);
      else controller.close();
    },
    cancel() { cancellations++; return cancel(); }
  }, { highWaterMark: 0 });
  const headers = { Origin: 'https://game.example', 'Content-Type': 'application/json' };
  if (length !== undefined) headers['Content-Length'] = length;
  const request = new Request('https://game.example/api/stats', { method: 'POST', headers, body, duplex: 'half' });
  return { request, activity: () => ({ reads, cancellations, locked: request.body.locked }) };
}

test('bounded body reader stops oversized streams without consuming the tail or touching D1', async t => {
  for (const length of [undefined, '32', 'invalid']) {
    const { binding } = fixture(t);
    let databaseCalls = 0;
    binding.prepare = () => { databaseCalls++; throw Error('Rejected body reached D1'); };
    const stream = streamedRequest([new Uint8Array(600).fill(32), new Uint8Array(600).fill(32), new Uint8Array(600).fill(32)], { length });
    const response = await onRequest({ env: { STATS_DB: binding }, request: stream.request });
    assert.equal(response.status, 413);
    assert.equal(databaseCalls, 0);
    assert.deepEqual(stream.activity(), { reads: 1, cancellations: 1, locked: false });
  }
});

test('bounded body reader rejects a large chunk and cumulative or trailing excess', async t => {
  const encode = text => new TextEncoder().encode(text);
  const valid = JSON.stringify({ playerId: crypto.randomUUID(), event: 'connected' });
  const cases = [
    [new Uint8Array(65536)],
    [encode(valid.padEnd(200)), encode(' '.repeat(57)), encode('unread tail')],
    [encode(valid), encode(' '.repeat(257)), encode('unread tail')]
  ];
  for (const chunks of cases) {
    const { binding } = fixture(t);let databaseCalls = 0;
    binding.prepare = () => { databaseCalls++; throw Error('Rejected body reached D1'); };
    const stream = streamedRequest(chunks);
    assert.equal((await onRequest({ env: { STATS_DB: binding }, request: stream.request })).status, 413);
    assert.equal(databaseCalls, 0);
    assert.equal(stream.activity().cancellations, 1);
    assert.ok(stream.activity().reads <= 2);
    assert.equal(stream.activity().locked, false);
  }
});

test('bounded body reader preserves exact-limit JSON and split UTF-8 with BOM', async t => {
  const encode = text => new TextEncoder().encode(text);
  for (const multibyte of [false, true]) {
    const { binding, get } = fixture(t);
    const base = { playerId: crypto.randomUUID().toUpperCase(), event: 'won' };
    const text = multibyte ? JSON.stringify({ ...base, note: '漢'.repeat(100) }) : JSON.stringify(base).padEnd(256);
    assert.ok(text.length <= 256);
    const bytes = encode(multibyte ? '\uFEFF' + text : text);
    const chunks = [];
    for (let i = 0; i < bytes.length; i += 7) chunks.push(bytes.slice(i, i + 7));
    const stream = streamedRequest(chunks);
    assert.equal((await onRequest({ env: { STATS_DB: binding }, request: stream.request })).status, 200);
    assert.deepEqual((await (await get()).json()).totals, { players: 1, winners: 1, losers: 0, launched: 0, averted: 0 });
    assert.equal(stream.activity().cancellations, 0);
    assert.equal(stream.activity().locked, false);
  }
});

test('bounded body reader cancellation failures cannot delay or replace 413', async t => {
  for (const cancel of [() => Promise.reject(Error('cancel failed')), () => new Promise(() => {})]) {
    const { binding } = fixture(t);
    const stream = streamedRequest([new Uint8Array(2048)], { cancel });
    let timer;
    try {
      const response = await Promise.race([
        onRequest({ env: { STATS_DB: binding }, request: stream.request }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Cancellation stalled response')), 500); })
      ]);
      assert.equal(response.status, 413);
      assert.equal(stream.activity().cancellations, 1);
      assert.equal(stream.activity().locked, false);
    } finally { clearTimeout(timer); }
  }
});

test('bounded body reader preserves empty, malformed and failed-read error behavior', async t => {
  const { binding } = fixture(t);
  for (const body of [null, '{']) {
    const request = new Request('https://game.example/api/stats', { method: 'POST', headers: { Origin: 'https://game.example', 'Content-Type': 'application/json' }, body });
    assert.equal((await onRequest({ env: { STATS_DB: binding }, request })).status, 400);
  }
  t.mock.method(console, 'error', () => {});
  const body = new ReadableStream({ pull(controller) { controller.error(Error('read failed')); } });
  const request = new Request('https://game.example/api/stats', { method: 'POST', headers: { Origin: 'https://game.example', 'Content-Type': 'application/json' }, body, duplex: 'half' });
  assert.equal((await onRequest({ env: { STATS_DB: binding }, request })).status, 503);
  assert.equal(request.body.locked, false);
});
