import type { Dataset } from './types';
import { haversine } from './geo';

export interface Gap {
  /** Row indices either side of the gap. */
  from: number;
  to: number;
  ms: number;
  metres: number;
}

export interface Stay {
  id: number;
  /** First and last row (row indices) in the stay. */
  first: number;
  last: number;
  rows: number;
  lat: number;
  lon: number;
  /** Radius that holds the stay's rows, metres (at least 15). */
  radius: number;
  t0: number;
  t1: number;
}

export interface Track {
  /** Placed rows (time + position) in time order. */
  seq: Int32Array;
  /** Previous placed row in time order, or -1. Indexed by row. */
  prev: Int32Array;
  next: Int32Array;
  dtPrev: Float64Array;
  distPrev: Float64Array;
  gapMs: number;
  gaps: Gap[];
  stays: Stay[];
  /** Stay index for each row, or -1. */
  stayOf: Int32Array;
  /** Index into `gaps` when the row is the first after a gap, else -1. */
  gapBefore: Int32Array;
  medianIntervalMs: number;
}

export interface TrackOptions {
  /** Override the gap threshold, ms. */
  gapMs?: number;
  stayRadius?: number;
  stayMinMs?: number;
}

export const DEFAULT_STAY_RADIUS = 50;
export const DEFAULT_STAY_MIN_MS = 5 * 60_000;

export function buildTrack(ds: Dataset, opts: TrackOptions = {}): Track {
  const n = ds.rows.length;
  const seqList: number[] = [];
  for (const i of ds.order) if (Number.isFinite(ds.t[i]) && Number.isFinite(ds.lat[i])) seqList.push(i);
  const seq = Int32Array.from(seqList);

  const prev = new Int32Array(n).fill(-1);
  const next = new Int32Array(n).fill(-1);
  const dtPrev = new Float64Array(n).fill(NaN);
  const distPrev = new Float64Array(n).fill(NaN);
  const intervals: number[] = [];
  for (let k = 1; k < seq.length; k++) {
    const a = seq[k - 1], b = seq[k];
    prev[b] = a; next[a] = b;
    dtPrev[b] = ds.t[b] - ds.t[a];
    distPrev[b] = haversine(ds.lat[a], ds.lon[a], ds.lat[b], ds.lon[b]);
    intervals.push(dtPrev[b]);
  }
  const medianIntervalMs = median(intervals);
  const gapMs = opts.gapMs ?? defaultGapMs(medianIntervalMs);

  const gaps: Gap[] = [];
  const gapBefore = new Int32Array(n).fill(-1);
  for (let k = 1; k < seq.length; k++) {
    const b = seq[k];
    if (dtPrev[b] > gapMs) {
      gapBefore[b] = gaps.length;
      gaps.push({ from: seq[k - 1], to: b, ms: dtPrev[b], metres: distPrev[b] });
    }
  }

  const stays = detectStays(ds, seq, opts.stayRadius ?? DEFAULT_STAY_RADIUS, opts.stayMinMs ?? DEFAULT_STAY_MIN_MS);
  const stayOf = new Int32Array(n).fill(-1);
  for (const s of stays) {
    for (let k = ds.rank[s.first]; k <= ds.rank[s.last]; k++) {
      const ri = ds.order[k];
      if (Number.isFinite(ds.lat[ri])) stayOf[ri] = s.id;
    }
  }

  return { seq, prev, next, dtPrev, distPrev, gapMs, gaps, stays, stayOf, gapBefore, medianIntervalMs };
}

export function defaultGapMs(medianIntervalMs: number): number {
  if (!Number.isFinite(medianIntervalMs)) return 60_000;
  return Math.max(60_000, 6 * medianIntervalMs);
}

/**
 * A stay is a run of rows that keeps within `radius` metres of its running,
 * accuracy-weighted centroid for at least `minMs`. Up to 3 stray rows outside
 * the radius are tolerated when the run comes straight back.
 */
export function detectStays(ds: Dataset, seq: Int32Array, radius: number, minMs: number): Stay[] {
  const stays: Stay[] = [];
  const m = seq.length;
  const weight = (ri: number) => {
    const a = ds.acc[ri];
    const acc = Number.isFinite(a) ? Math.max(3, a) : 20;
    return 1 / (acc * acc);
  };
  let i = 0;
  while (i < m) {
    let w = weight(seq[i]);
    let sLat = ds.lat[seq[i]] * w, sLon = ds.lon[seq[i]] * w, sW = w;
    let j = i;
    for (;;) {
      const cLat = sLat / sW, cLon = sLon / sW;
      const inside = (k: number) => haversine(cLat, cLon, ds.lat[seq[k]], ds.lon[seq[k]]) <= radius;
      if (j + 1 < m && inside(j + 1)) {
        j++;
      } else {
        // Look ahead past up to 3 stray rows.
        let back = -1;
        for (let k = j + 2; k <= Math.min(m - 1, j + 4); k++) if (inside(k)) { back = k; break; }
        if (back < 0) break;
        j = back;
      }
      w = weight(seq[j]);
      sLat += ds.lat[seq[j]] * w; sLon += ds.lon[seq[j]] * w; sW += w;
    }
    const t0 = ds.t[seq[i]], t1 = ds.t[seq[j]];
    if (t1 - t0 >= minMs) {
      const cLat = sLat / sW, cLon = sLon / sW;
      const dists: number[] = [];
      for (let k = i; k <= j; k++) dists.push(haversine(cLat, cLon, ds.lat[seq[k]], ds.lon[seq[k]]));
      dists.sort((a, b) => a - b);
      const r90 = dists[Math.floor(dists.length * 0.9)] ?? 0;
      stays.push({ id: stays.length, first: seq[i], last: seq[j], rows: j - i + 1, lat: cLat, lon: cLon, radius: Math.max(15, r90), t0, t1 });
      i = j + 1;
    } else {
      i++;
    }
  }
  return stays;
}

export type Motion = 'stationary' | 'walking' | 'running or cycling' | 'vehicle';

/** Motion estimated from a speed in m/s. */
export function motionOf(speed: number): Motion | null {
  if (!Number.isFinite(speed)) return null;
  if (speed < 0.3) return 'stationary';
  if (speed < 2.5) return 'walking';
  if (speed < 7) return 'running or cycling';
  return 'vehicle';
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
