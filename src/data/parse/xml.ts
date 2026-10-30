import type { RawTable, Row } from '../types';

/** GPX: one row per trkpt, rtept and wpt. Child elements and extensions become columns. */
export function parseGpx(text: string): RawTable {
  const doc = parseXml(text);
  if (typeof doc === 'string') return fail('gpx', doc);

  const builder = new TableBuilder(['lat', 'lon', 'ele', 'time', 'point_type', 'track', 'segment']);
  let n = 0;
  const visit = (pt: Element, type: string, track: string, segment: string) => {
    n++;
    const rec: Record<string, string> = {
      lat: pt.getAttribute('lat') ?? '',
      lon: pt.getAttribute('lon') ?? '',
      point_type: type,
      track,
      segment,
    };
    for (const child of Array.from(pt.children)) {
      const name = localName(child);
      if (name === 'extensions') {
        flatten(child, 'ext', rec);
      } else if (child.children.length) {
        flatten(child, name, rec);
      } else {
        rec[name] = child.textContent ?? '';
      }
    }
    builder.add(rec, n);
  };

  byLocal(doc, 'trk').forEach((trk, ti) => {
    const name = textOf(trk, 'name') || `Track ${ti + 1}`;
    byLocal(trk, 'trkseg').forEach((seg, si) => {
      byLocal(seg, 'trkpt').forEach((pt) => visit(pt, 'track point', name, String(si + 1)));
    });
  });
  byLocal(doc, 'rte').forEach((rte, ri) => {
    const name = textOf(rte, 'name') || `Route ${ri + 1}`;
    byLocal(rte, 'rtept').forEach((pt) => visit(pt, 'route point', name, ''));
  });
  byLocal(doc, 'wpt').forEach((pt) => visit(pt, 'waypoint', '', ''));

  return { format: 'gpx', ...builder.done(), issues: [], skipped: [] };
}

/** KML: one row per Placemark Point and per gx:Track sample. */
export function parseKml(text: string): RawTable {
  const doc = parseXml(text);
  if (typeof doc === 'string') return fail('kml', doc);

  const builder = new TableBuilder(['longitude', 'latitude', 'altitude', 'when', 'name', 'description']);
  const skipped = new Map<string, number>();
  let n = 0;

  for (const pm of byLocal(doc, 'Placemark')) {
    const base: Record<string, string> = {
      name: textOf(pm, 'name'),
      description: textOf(pm, 'description'),
    };
    const ts = byLocal(pm, 'TimeStamp')[0];
    if (ts) base.when = textOf(ts, 'when');
    const span = byLocal(pm, 'TimeSpan')[0];
    if (span) { base.begin = textOf(span, 'begin'); base.end = textOf(span, 'end'); }
    for (const data of byLocal(pm, 'Data')) {
      base[`data:${data.getAttribute('name') ?? 'field'}`] = textOf(data, 'value');
    }
    for (const sd of byLocal(pm, 'SimpleData')) {
      base[`data:${sd.getAttribute('name') ?? 'field'}`] = sd.textContent ?? '';
    }

    const tracks = byLocal(pm, 'Track');
    if (tracks.length) {
      for (const tr of tracks) {
        const whens = byLocal(tr, 'when').map((w) => w.textContent ?? '');
        const coords = byLocal(tr, 'coord').map((c) => (c.textContent ?? '').trim().split(/\s+/));
        const len = Math.max(whens.length, coords.length);
        for (let k = 0; k < len; k++) {
          n++;
          const c = coords[k] ?? [];
          builder.add({ ...base, when: whens[k] ?? '', longitude: c[0] ?? '', latitude: c[1] ?? '', altitude: c[2] ?? '' }, n);
        }
      }
      continue;
    }
    const points = byLocal(pm, 'Point');
    if (points.length) {
      for (const p of points) {
        n++;
        const c = textOf(p, 'coordinates').trim().split(',');
        builder.add({ ...base, longitude: c[0]?.trim() ?? '', latitude: c[1]?.trim() ?? '', altitude: c[2]?.trim() ?? '' }, n);
      }
      continue;
    }
    // Lines and polygons: keep a row for the placemark so it shows in the table.
    const kind = ['LineString', 'Polygon', 'MultiGeometry'].find((k) => byLocal(pm, k).length) ?? 'Placemark without geometry';
    skipped.set(kind, (skipped.get(kind) ?? 0) + 1);
    n++;
    builder.add({ ...base, geometry_type: kind }, n);
  }

  return {
    format: 'kml',
    ...builder.done(),
    issues: [],
    skipped: [...skipped].map(([what, count]) => ({ what: `${what} (in the table, not drawn as points)`, count })),
  };
}

class TableBuilder {
  private columns: string[];
  private index: Map<string, number>;
  private recs: { rec: Record<string, string>; line: number }[] = [];
  constructor(initial: string[]) {
    this.columns = [...initial];
    this.index = new Map(initial.map((c, i) => [c, i]));
  }
  add(rec: Record<string, string>, line: number) {
    for (const k of Object.keys(rec)) {
      if (!this.index.has(k)) { this.index.set(k, this.columns.length); this.columns.push(k); }
    }
    this.recs.push({ rec, line });
  }
  done(): { columns: string[]; rows: Row[] } {
    const rows = this.recs.map(({ rec, line }, i) => {
      const values = new Array<string>(this.columns.length).fill('');
      for (const [k, v] of Object.entries(rec)) values[this.index.get(k)!] = v;
      return { i, line, values };
    });
    return { columns: this.columns, rows };
  }
}

function parseXml(text: string): Document | string {
  if (typeof DOMParser === 'undefined') return 'XML parsing is not available here.';
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) return `Not valid XML: ${(err.textContent ?? '').trim().slice(0, 200)}`;
  return doc;
}

function localName(el: Element): string {
  return el.localName || el.nodeName.replace(/^.*:/, '');
}

/** Descendants by local name, ignoring namespace prefixes (gx:Track, etc.). */
function byLocal(root: Document | Element, name: string): Element[] {
  const out: Element[] = [];
  const all = root.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) if (localName(all[i]) === name) out.push(all[i]);
  return out;
}

function textOf(root: Element, name: string): string {
  for (const c of Array.from(root.children)) if (localName(c) === name) return c.textContent ?? '';
  return '';
}

function flatten(el: Element, prefix: string, rec: Record<string, string>) {
  for (const child of Array.from(el.children)) {
    const key = `${prefix}:${localName(child)}`;
    if (child.children.length) flatten(child, key, rec);
    else rec[key] = child.textContent ?? '';
  }
}

function fail(format: 'gpx' | 'kml', message: string): RawTable {
  return { format, columns: [], rows: [], issues: [{ line: 1, message }], skipped: [] };
}
