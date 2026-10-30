import type { Column, Dataset, Format, RawTable, Role } from './types';
import { parseCsv } from './parse/csv';
import { parseGeoJson } from './parse/geojson';
import { parseGpx, parseKml } from './parse/xml';

/** Candidate column names per role, in order of preference. */
const NAMES: Record<Role, string[]> = {
  lat: ['latitude', 'lat'],
  lon: ['longitude', 'lon', 'lng', 'long'],
  time: ['iso_time', 'time', 'datetime', 'date_time', 'timestamp', 'when', 'recorded_at', 'date', 'ts'],
  accuracy: ['accuracy', 'horizontal_accuracy', 'hacc', 'h_accuracy', 'acc'],
  altitude: ['altitude', 'ele', 'elevation', 'alt'],
  speed: ['speed', 'velocity', 'ext:speed'],
  bearing: ['bearing', 'course', 'heading', 'ext:course'],
  battery: ['battery', 'battery_level', 'batt'],
  id: ['id'],
};

export function detectFormat(name: string, text: string): Format {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') return 'csv';
  if (ext === 'geojson' || ext === 'json') return 'geojson';
  if (ext === 'gpx') return 'gpx';
  if (ext === 'kml') return 'kml';
  const head = text.slice(0, 2000).trimStart();
  if (head.startsWith('{') || head.startsWith('[')) return 'geojson';
  if (head.startsWith('<')) return /<gpx[\s>]/i.test(head) ? 'gpx' : 'kml';
  return 'csv';
}

export function parseText(name: string, text: string): RawTable {
  switch (detectFormat(name, text)) {
    case 'geojson': return parseGeoJson(text);
    case 'gpx': return parseGpx(text);
    case 'kml': return parseKml(text);
    default: return parseCsv(text);
  }
}

/** Parses a time cell: ISO text, or epoch seconds / milliseconds. NaN when unknown. */
export function parseTime(s: string): number {
  const v = s.trim();
  if (v === '') return NaN;
  if (/^-?\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    if (n > 1e11) return n; // epoch ms
    if (n > 1e8) return n * 1000; // epoch s
    return NaN;
  }
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : NaN;
}

export function parseNum(s: string): number {
  const v = s.trim();
  if (v === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** Works out column roles. Overrides (from the mapping dialog) win. */
export function detectRoles(raw: RawTable, overrides: Partial<Record<Role, string>> = {}): Partial<Record<Role, number>> {
  const lower = raw.columns.map((c) => c.trim().toLowerCase());
  const out: Partial<Record<Role, number>> = {};
  const sample = raw.rows.slice(0, 200);
  for (const role of Object.keys(NAMES) as Role[]) {
    const forced = overrides[role];
    if (forced !== undefined) {
      const idx = raw.columns.indexOf(forced);
      if (idx >= 0) out[role] = idx;
      continue;
    }
    for (const name of NAMES[role]) {
      const idx = lower.indexOf(name);
      if (idx < 0) continue;
      const parse = role === 'time' ? parseTime : parseNum;
      // Judge only cells that hold something: optional fields are often blank.
      const filled = sample.filter((r) => (r.values[idx] ?? '').trim() !== '');
      const ok = filled.filter((r) => Number.isFinite(parse(r.values[idx]))).length;
      if (filled.length === 0 || ok / filled.length >= 0.5) { out[role] = idx; break; }
    }
  }
  return out;
}

export function buildDataset(name: string, raw: RawTable, overrides: Partial<Record<Role, string>> = {}): Dataset {
  const roles = detectRoles(raw, overrides);
  const n = raw.rows.length;
  const columns: Column[] = raw.columns.map((key, ci) => ({ key, kind: columnKind(raw, ci) }));
  for (const [role, ci] of Object.entries(roles) as [Role, number][]) columns[ci].role = role;

  const col = (role: Role, parse: (s: string) => number) => {
    const arr = new Float64Array(n).fill(NaN);
    const ci = roles[role];
    if (ci === undefined) return arr;
    for (let i = 0; i < n; i++) arr[i] = parse(raw.rows[i].values[ci] ?? '');
    return arr;
  };
  const t = col('time', parseTime);
  const lat = col('lat', parseNum);
  const lon = col('lon', parseNum);
  for (let i = 0; i < n; i++) {
    if (!(lat[i] >= -90 && lat[i] <= 90) || !(lon[i] >= -180 && lon[i] <= 180)) { lat[i] = NaN; lon[i] = NaN; }
  }
  const bat = col('battery', parseNum);
  let batMax = 0;
  for (let i = 0; i < n; i++) if (bat[i] > batMax) batMax = bat[i];
  if (batMax > 1.0001) for (let i = 0; i < n; i++) bat[i] = bat[i] / 100; // store as 0–1

  const order = Int32Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => {
    const ta = t[a], tb = t[b];
    const na = Number.isNaN(ta), nb = Number.isNaN(tb);
    if (na || nb) return na === nb ? a - b : na ? 1 : -1;
    return ta - tb || a - b;
  });
  const rank = new Int32Array(n);
  order.forEach((ri, k) => { rank[ri] = k; });

  let placed = 0;
  for (let i = 0; i < n; i++) if (Number.isFinite(t[i]) && Number.isFinite(lat[i])) placed++;

  return {
    name,
    format: raw.format,
    source: raw.source,
    columns,
    rows: raw.rows,
    issues: raw.issues,
    skipped: raw.skipped,
    t, lat, lon,
    acc: col('accuracy', parseNum),
    spd: col('speed', parseNum),
    brg: col('bearing', parseNum),
    alt: col('altitude', parseNum),
    bat,
    order,
    rank,
    placed,
  };
}

/** True when the roles needed to draw a map could not be found. */
export function needsMapping(raw: RawTable): Role[] {
  const roles = detectRoles(raw);
  return (['lat', 'lon', 'time'] as Role[]).filter((r) => roles[r] === undefined);
}

function columnKind(raw: RawTable, ci: number): Column['kind'] {
  let nonEmpty = 0;
  for (const r of raw.rows) {
    const v = r.values[ci] ?? '';
    if (v.trim() === '') continue;
    nonEmpty++;
    if (!Number.isFinite(Number(v))) return 'text';
  }
  return nonEmpty === 0 ? 'empty' : 'number';
}
