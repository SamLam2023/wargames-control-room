import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerStats } from '../src/stats.js';

const totals = { players: 1, winners: 0, losers: 0, launched: 0, averted: 0 };
const tick = () => new Promise(resolve => setImmediate(resolve));
const storage = () => {
  const data = new Map();
  return { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
};

test('requests do not pass the PlayerStats instance as native fetch receiver', async () => {
  let calls = 0;
  const client = new PlayerStats(() => {}, { fetcher: function () {
    assert.equal(this, undefined);
    calls++;
    return Promise.resolve(Response.json({ totals, revision: 1 }));
  } });
  await client.sync();
  assert.equal(calls, 1);
});

test('a failed event survives reload and is confirmed only after the server accepts it', async () => {
  const saved = storage();
  const offline = new PlayerStats(() => {}, { storage: saved, fetcher: async () => { throw new Error('offline'); } });
  offline.record('averted'); await tick();
  const sent = [];
  const online = new PlayerStats(() => {}, { storage: saved, fetcher: async (url, options) => {
    if (options.method === 'POST') sent.push(JSON.parse(options.body));
    return Response.json({ totals: { ...totals, averted: 1 }, revision: 2 });
  } });
  await online.sync();
  assert.equal(online.playerId, offline.playerId);
  assert.deepEqual(sent, [{ playerId: offline.playerId, event: 'averted' }]);
  assert.equal(online.pending.size, 0);
  online.record('averted'); await tick();
  assert.equal(sent.length, 1, 'A replay does not send the same achievement again');
});

test('an achievement arriving during a GET is sent without waiting for the next poll', async () => {
  let resolveGet;
  const sent = [];
  let gets = 0;
  const client = new PlayerStats(() => {}, { fetcher: async (url, options) => {
    if (options.method === 'POST') { sent.push(JSON.parse(options.body).event); return Response.json({ totals, revision: 2 }); }
    gets++;
    return gets === 1 ? new Promise(resolve => { resolveGet = resolve; }) : Response.json({ totals, revision: 2 });
  } });
  const pendingGet = client.sync();
  client.record('connected');
  resolveGet(Response.json({ totals, revision: 1 }));
  await pendingGet; await tick();
  assert.deepEqual(sent, ['connected']);
  assert.equal(client.pending.size, 0);
});

test('late snapshots cannot move counters backwards and blocked storage cannot break play', () => {
  const updates = [];
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const client = new PlayerStats((data, online) => updates.push({ data, online }), { storage: blocked });
  client.accept({ totals, revision: 3 });
  client.accept({ totals: { ...totals, players: 0 }, revision: 1 });
  assert.equal(updates.length, 1);
  assert.equal(client.snapshot.players, 1);
  assert.throws(() => client.accept({ totals: { ...totals, winners: -1 }, revision: 4 }));
});
