/**
 * Per-Entry cache (ADR 0003 points 5 and 7): fresh for 5 minutes, then kept as a stale
 * fallback for when FPL is down. Bounded: least recently used Entries are evicted, so
 * typed-in team ids can't grow memory without limit. Never persisted, never logged.
 */
export const ENTRY_TTL_MS = 5 * 60_000;
export const ENTRY_CACHE_MAX = 200;

export interface Cached<T> { value: T; fetchedAt: number }

export class EntryCache<T> {
  private map = new Map<number, Cached<T>>();
  constructor(private max = ENTRY_CACHE_MAX, private ttl = ENTRY_TTL_MS) {}

  get(id: number, now = Date.now()): { hit: Cached<T>; fresh: boolean } | null {
    const hit = this.map.get(id);
    if (!hit) return null;
    this.map.delete(id);
    this.map.set(id, hit); // most recently used last
    return { hit, fresh: now - hit.fetchedAt < this.ttl };
  }

  set(id: number, value: T, now = Date.now()) {
    this.map.delete(id);
    this.map.set(id, { value, fetchedAt: now });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }

  get size() { return this.map.size; }
}
