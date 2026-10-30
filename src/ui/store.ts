import type { Dataset } from '../data/types';
import { buildTrack, type Track } from '../data/derive';
import { dayKey } from '../data/format';

export type ColorBy = 'time' | 'speed' | 'accuracy' | 'battery';
export type View = 'map' | 'table';

export interface Layers {
  points: boolean;
  paths: boolean;
  inferred: boolean;
  accuracy: boolean;
  stays: boolean;
}

export interface Day {
  key: string;
  /** Start and end of the local calendar day, ms. */
  start: number;
  end: number;
  rows: number;
}

export interface State {
  ds: Dataset;
  track: Track;
  view: View;
  colorBy: ColorBy;
  layers: Layers;
  days: Day[];
  daysOn: Set<string>;
  /** Visible time window, ms. Always inside the span of the selected days. */
  win: [number, number];
  pinned: number;
  /** Row the inspector shows "Raw" for, else fields. */
  rawView: boolean;
  storedValues: boolean;
}

type Key = keyof State;
type Listener = (changed: Set<Key>) => void;

export class Store {
  s: State;
  private listeners = new Set<Listener>();

  constructor(ds: Dataset) {
    const track = buildTrack(ds);
    const days = listDays(ds);
    // Open on the first day; all days are one tap away.
    const first = days[0];
    const daysOn = new Set(first ? [first.key] : []);
    this.s = {
      ds, track, view: 'map', colorBy: 'time',
      layers: { points: true, paths: true, inferred: true, accuracy: false, stays: true },
      days, daysOn, win: spanOf(days, daysOn, ds),
      pinned: -1, rawView: false, storedValues: false,
    };
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set(patch: Partial<State>) {
    const changed = new Set<Key>();
    for (const [k, v] of Object.entries(patch) as [Key, unknown][]) {
      if (this.s[k] !== v) { (this.s as unknown as Record<string, unknown>)[k] = v; changed.add(k); }
    }
    if (changed.size) this.listeners.forEach((fn) => fn(changed));
  }

  setDays(daysOn: Set<string>) {
    this.set({ daysOn, win: spanOf(this.s.days, daysOn, this.s.ds) });
  }

  setGap(gapMs: number) {
    this.set({ track: buildTrack(this.s.ds, { gapMs }) });
  }

  /** Is row i inside the selected days and time window? */
  inWindow(i: number): boolean {
    const t = this.s.ds.t[i];
    return t >= this.s.win[0] && t <= this.s.win[1];
  }

  pin(i: number) {
    this.set({ pinned: i });
  }
}

export function listDays(ds: Dataset): Day[] {
  const map = new Map<string, Day>();
  for (const i of ds.order) {
    const t = ds.t[i];
    if (!Number.isFinite(t)) break;
    const key = dayKey(t);
    let d = map.get(key);
    if (!d) {
      const dt = new Date(t);
      const start = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
      const end = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1).getTime() - 1;
      d = { key, start, end, rows: 0 };
      map.set(key, d);
    }
    d.rows++;
  }
  return [...map.values()];
}

/** Earliest to latest row time across the selected days. */
function spanOf(days: Day[], on: Set<string>, ds: Dataset): [number, number] {
  let a = Infinity, b = -Infinity;
  for (const d of days) if (on.has(d.key)) { a = Math.min(a, d.start); b = Math.max(b, d.end); }
  if (!Number.isFinite(a)) return [0, 0];
  // Tighten to actual data so the timeline isn't mostly empty.
  let lo = Infinity, hi = -Infinity;
  for (const i of ds.order) {
    const t = ds.t[i];
    if (t >= a && t <= b) { if (t < lo) lo = t; if (t > hi) hi = t; }
  }
  return Number.isFinite(lo) ? [lo, hi] : [a, b];
}
