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
