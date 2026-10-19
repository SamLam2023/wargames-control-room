const EVENTS = ['connected', 'won', 'lost', 'launched', 'averted'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORAGE = 'wopr-stats-v1';

export class PlayerStats {
  constructor(onUpdate, { storage = null, fetcher = fetch } = {}) {
    this.onUpdate = onUpdate;
    // Native window.fetch rejects a PlayerStats instance as its receiver.
    this.fetcher = (...args) => fetcher(...args);
    this.storage = storage;
    let saved;
    try { saved = JSON.parse(storage?.getItem(STORAGE)); } catch { /* Private storage may be unavailable. */ }
    this.playerId = UUID.test(saved?.playerId) ? saved.playerId : crypto.randomUUID();
    this.pending = new Set((Array.isArray(saved?.pending) ? saved.pending : []).filter(event => EVENTS.includes(event)));
    this.confirmed = new Set((Array.isArray(saved?.confirmed) ? saved.confirmed : []).filter(event => EVENTS.includes(event)));
    this.revision = -1;
    this.snapshot = null;
    this.persist();
  }

  persist() {
    try { this.storage?.setItem(STORAGE, JSON.stringify({ playerId: this.playerId, pending: [...this.pending], confirmed: [...this.confirmed] })); }
    catch { /* The current tab can still play and report without local storage. */ }
  }

  start() {
    this.sync();
    this.timer = setInterval(() => { if (!document.hidden) this.sync(); }, 30000);
    window.addEventListener('online', () => this.sync());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.sync(); });
  }

  record(event) {
    if (!EVENTS.includes(event) || this.confirmed.has(event)) return;
    this.pending.add(event);
    this.persist();
    this.sync();
  }

  accept(data) {
    const keys = ['players', 'winners', 'losers', 'launched', 'averted'];
    if (!Number.isSafeInteger(data.revision) || keys.some(key => !Number.isSafeInteger(data.totals?.[key]) || data.totals[key] < 0)) throw new Error('Invalid statistics');
    if (data.revision < this.revision) return;
    this.revision = data.revision;
    this.snapshot = data.totals;
    this.onUpdate(this.snapshot, true);
  }

  async sync() {
    if (this.syncing) return;
    this.syncing = true;
    let succeeded = false;
    try {
      // A pending achievement survives reloads. Server-side de-duplication also
      // handles replies lost after a successful write and simultaneous tabs.
      while (this.pending.size) {
        const event = this.pending.values().next().value;
        const response = await this.fetcher('/api/stats', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerId: this.playerId, event }),
          signal: AbortSignal.timeout(6000), keepalive: true, cache: 'no-store'
        });
        if (!response.ok) throw new Error('Statistics offline');
        this.accept(await response.json());
        this.pending.delete(event); this.confirmed.add(event); this.persist();
      }
      const response = await this.fetcher('/api/stats', { signal: AbortSignal.timeout(6000), cache: 'no-store' });
      if (!response.ok) throw new Error('Statistics offline');
      this.accept(await response.json());
      succeeded = true;
    } catch {
      this.onUpdate(this.snapshot, false);
    } finally {
      this.syncing = false;
      // An event arriving during the final GET is drained immediately. Network
      // failures instead wait for online/visibility/polling to retry.
      if (succeeded && this.pending.size) this.sync();
    }
  }
}
