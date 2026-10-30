import type { RawTable, Row } from '../types';

const LON = 'longitude';
const LAT = 'latitude';
const ALT = 'altitude';

/**
 * One row per Point (and per position of a MultiPoint). Every property becomes a
 * column; non-string values are kept as their JSON text so nothing is lost.
 */
export function parseGeoJson(text: string): RawTable {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return fail(`Not valid JSON: ${(e as Error).message}`);
  }
  const features = collectFeatures(doc);
  if (!features) return fail('No GeoJSON Feature or FeatureCollection found.');

  const columns: string[] = [LON, LAT, ALT];
  const index = new Map(columns.map((c, i) => [c, i]));
  const skippedByType = new Map<string, number>();
  const issues: RawTable['issues'] = [];
  const pending: { line: number; props: Record<string, unknown>; coord: unknown[] }[] = [];

  features.forEach((f, fi) => {
    const geom = (f as { geometry?: { type?: string; coordinates?: unknown } }).geometry;
    const props = ((f as { properties?: unknown }).properties ?? {}) as Record<string, unknown>;
    const line = fi + 1;
    if (!geom || !geom.type) {
      pending.push({ line, props, coord: [] });
      issues.push({ line, message: 'Feature has no geometry; kept in the table only.' });
      return;
    }
    if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
      pending.push({ line, props, coord: geom.coordinates });
    } else if (geom.type === 'MultiPoint' && Array.isArray(geom.coordinates)) {
      for (const c of geom.coordinates) pending.push({ line, props, coord: Array.isArray(c) ? c : [] });
    } else {
      skippedByType.set(geom.type, (skippedByType.get(geom.type) ?? 0) + 1);
      pending.push({ line, props: { ...props, geometry_type: geom.type, geometry: geom.coordinates }, coord: [] });
    }
    for (const k of Object.keys(props)) {
      if (!index.has(k)) { index.set(k, columns.length); columns.push(k); }
    }
  });
  // Columns added for non-point features
  for (const p of pending) for (const k of Object.keys(p.props)) {
    if (!index.has(k)) { index.set(k, columns.length); columns.push(k); }
  }

  const rows: Row[] = pending.map((p, i) => {
    const values = new Array<string>(columns.length).fill('');
    values[0] = p.coord[0] === undefined ? '' : String(p.coord[0]);
    values[1] = p.coord[1] === undefined ? '' : String(p.coord[1]);
    values[2] = p.coord[2] === undefined ? '' : String(p.coord[2]);
    for (const [k, v] of Object.entries(p.props)) values[index.get(k)!] = stringify(v);
    return { i, line: p.line, values };
  });

  const skipped = [...skippedByType].map(([what, count]) => ({ what: `${what} features (in the table, not drawn as points)`, count }));
  return { format: 'geojson', columns, rows, issues, skipped };
}

function collectFeatures(doc: unknown): unknown[] | null {
  if (!doc || typeof doc !== 'object') return null;
  const d = doc as { type?: string; features?: unknown[] };
  if (d.type === 'FeatureCollection' && Array.isArray(d.features)) return d.features;
  if (d.type === 'Feature') return [d];
  if (Array.isArray(doc)) return doc as unknown[];
  return null;
}

function stringify(v: unknown): string {
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function fail(message: string): RawTable {
  return { format: 'geojson', columns: [], rows: [], issues: [{ line: 1, message }], skipped: [] };
}
