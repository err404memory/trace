import type { Dataset } from './types';
import { parseTime } from './dataset';

export interface Shown {
  /** Readable text for display. */
  text: string;
  /** True when `text` is not the stored text, so the UI should offer the stored value. */
  differs: boolean;
  empty: boolean;
}

/**
 * Readable form of one cell. The stored text is always `ds.rows[ri].values[ci]`.
 * `compact` shortens times for table cells.
 */
export function readable(ds: Dataset, ri: number, ci: number, compact = false): Shown {
  const raw = ds.rows[ri].values[ci] ?? '';
  if (raw.trim() === '') return { text: '(empty)', differs: raw !== '', empty: true };
  const col = ds.columns[ci];
  const n = Number(raw);
  const same = (text: string): Shown => ({ text, differs: text !== raw, empty: false });

  switch (col.role) {
    case 'time': {
      const t = ds.t[ri];
      return Number.isFinite(t) ? same(compact ? fmtShort(t) : fmtDateTime(t)) : same(raw);
    }
    case 'lat':
    case 'lon':
    case 'id':
      return same(raw);
    case 'accuracy':
      return Number.isFinite(n) ? same(`±${round(n, 2)} m`) : same(raw);
    case 'altitude':
      return Number.isFinite(n) ? same(`${round(n, 1)} m`) : same(raw);
    case 'speed':
      return Number.isFinite(n) ? same(`${round(n, 2)} m/s · ${round(n * 3.6, 1)} km/h`) : same(raw);
    case 'bearing': {
      if (!Number.isFinite(n)) return same(raw);
      const spd = ds.spd[ri];
      if (n === 0 && Number.isFinite(spd) && spd < 0.3) return same('0 · unknown (at rest)');
      if (n < 0) return same(`${raw} · unknown`);
      return same(`${round(n, 1)}°`);
    }
    case 'battery':
      return Number.isFinite(ds.bat[ri]) ? same(`${round(ds.bat[ri] * 100, 0)} %`) : same(raw);
  }
  // Other time columns (e.g. Colota's epoch `timestamp` next to `iso_time`).
  if (/time|date|when|stamp/i.test(col.key)) {
    const t = parseTime(raw);
    if (Number.isFinite(t)) return same(compact ? fmtShort(t) : fmtDateTime(t));
  }
  if (col.kind === 'number' && Number.isFinite(n) && /\.\d{7,}/.test(raw)) return same(String(round(n, 6)));
  return same(raw);
}

export function round(n: number, digits: number): string {
  const f = 10 ** digits;
  const v = Math.round(n * f) / f;
  return v.toFixed(digits).replace(/\.?0+$/, '') || '0';
}

const dateTime = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const hm = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const day = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const dayYear = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export const fmtDateTime = (t: number) => dateTime.format(t);
export const fmtShort = (t: number) => `${day.format(t)} ${clock.format(t)}`;
export const fmtClock = (t: number) => clock.format(t);
export const fmtHM = (t: number) => hm.format(t);
export const fmtDay = (t: number) => day.format(t);
export const fmtDayYear = (t: number) => dayYear.format(t);

/** "UTC−7", for the local time zone at time t. */
export function fmtOffset(t: number): string {
  const mins = -new Date(t).getTimezoneOffset();
  const sign = mins < 0 ? '−' : '+';
  const a = Math.abs(mins);
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''}`;
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${s % 60 ? ` ${s % 60} s` : ''}`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

export function fmtDistance(m: number): string {
  if (!Number.isFinite(m)) return '—';
  if (m < 1000) return `${round(m, m < 10 ? 1 : 0)} m`;
  return `${round(m / 1000, m < 10_000 ? 2 : 1)} km`;
}

export const fmtInt = (n: number) => n.toLocaleString();

/** Local calendar day key (YYYY-MM-DD) for a time. */
export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
