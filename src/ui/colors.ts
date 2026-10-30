import type { State, ColorBy } from './store';
import { fmtHM, round } from '../data/format';

/** Sequential ramp: dark-ish blue → teal → green → yellow → amber. Lightness rises along it. */
export const STOPS: [number, number, number][] = [[76, 111, 208], [63, 167, 201], [92, 194, 160], [216, 194, 90], [242, 154, 74]];
export const GRADIENT_CSS = `linear-gradient(90deg, ${STOPS.map((c) => `rgb(${c.join(',')})`).join(', ')})`;
export const NO_VALUE = '#5A6575';

export function ramp(f: number): string {
  if (!Number.isFinite(f)) return NO_VALUE;
  f = Math.min(1, Math.max(0, f));
  const n = STOPS.length - 1;
  const i = Math.min(n - 1, Math.floor(f * n));
  const t = f * n - i;
  const a = STOPS[i], b = STOPS[i + 1];
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * t)).join(',')})`;
}

export interface Scale {
  prop: 't' | 'spd' | 'acc' | 'bat';
  lo: number;
  hi: number;
  labels: [string, string, string];
  note?: string;
}

export function scaleFor(s: State): Scale {
  const { ds } = s;
  switch (s.colorBy) {
    case 'speed': {
      const hi = percentile(ds.spd, 0.98) || 1;
      return { prop: 'spd', lo: 0, hi, labels: ['0', `${round(hi * 1.8, 0)} km/h`, `${round(hi * 3.6, 0)} km/h`] };
    }
    case 'accuracy': {
      const lo = percentile(ds.acc, 0.02), hi = percentile(ds.acc, 0.98) || lo + 1;
      return { prop: 'acc', lo, hi, labels: [`±${round(lo, 0)} m`, `±${round((lo + hi) / 2, 0)} m`, `±${round(hi, 0)} m`], note: 'Warmer means less precise.' };
    }
    case 'battery':
      return { prop: 'bat', lo: 0, hi: 1, labels: ['0 %', '50 %', '100 %'] };
    default: {
      const [a, b] = s.win;
      return { prop: 't', lo: a, hi: b, labels: [fmtHM(a), fmtHM((a + b) / 2), fmtHM(b)] };
    }
  }
}

export function colorOfRow(s: State, sc: Scale, i: number): string {
  const v = valueOf(s, sc.prop, i);
  return ramp((v - sc.lo) / (sc.hi - sc.lo || 1));
}

function valueOf(s: State, prop: Scale['prop'], i: number): number {
  const { ds } = s;
  return prop === 't' ? ds.t[i] : prop === 'spd' ? ds.spd[i] : prop === 'acc' ? ds.acc[i] : ds.bat[i];
}

/** MapLibre expression colouring point features by their property. Missing values are grey. */
export function colorExpression(sc: Scale): unknown[] {
  const stops: unknown[] = [];
  STOPS.forEach((c, k) => {
    stops.push(sc.lo + ((sc.hi - sc.lo || 1) * k) / (STOPS.length - 1), `rgb(${c.join(',')})`);
  });
  return ['case', ['==', ['typeof', ['get', sc.prop]], 'number'], ['interpolate', ['linear'], ['get', sc.prop], ...stops], NO_VALUE];
}

export const COLOR_BY: { key: ColorBy; label: string }[] = [
  { key: 'time', label: 'Time' },
  { key: 'speed', label: 'Speed' },
  { key: 'accuracy', label: 'Accuracy' },
  { key: 'battery', label: 'Battery' },
];

function percentile(arr: Float64Array, p: number): number {
  const xs: number[] = [];
  for (const v of arr) if (Number.isFinite(v)) xs.push(v);
  if (!xs.length) return NaN;
  xs.sort((a, b) => a - b);
  return xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
}
