// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parseGeoJson } from '../src/data/parse/geojson';
import { parseGpx, parseKml } from '../src/data/parse/xml';
import { buildDataset, detectFormat } from '../src/data/dataset';

describe('GeoJSON', () => {
  it('turns points into rows and keeps every property', () => {
    const raw = parseGeoJson(JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-122.1, 45.2, 30] }, properties: { timestamp: '2026-10-27T10:00:00Z', motion: ['walking'], floor: null, speed: 1.2 } },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { name: 'a line' } },
      ],
    }));
    expect(raw.rows).toHaveLength(2);
    const col = (k: string) => raw.columns.indexOf(k);
    const r0 = raw.rows[0].values;
    expect(r0[col('longitude')]).toBe('-122.1');
    expect(r0[col('altitude')]).toBe('30');
    expect(r0[col('motion')]).toBe('["walking"]');
    expect(r0[col('floor')]).toBe('null');
    expect(r0[col('speed')]).toBe('1.2');
    expect(raw.skipped).toEqual([{ what: 'LineString features (in the table, not drawn as points)', count: 1 }]);
    const ds = buildDataset('a.geojson', raw);
    expect(ds.placed).toBe(1);
  });
});

describe('GPX', () => {
  it('reads track points with extensions', () => {
    const raw = parseGpx(`<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Morning</name><trkseg>
    <trkpt lat="45.5" lon="-122.6"><ele>31.5</ele><time>2026-10-27T15:00:00Z</time>
      <extensions><speed>1.4</speed><course>90</course></extensions></trkpt>
    <trkpt lat="45.6" lon="-122.7"><time>2026-10-27T15:00:05Z</time></trkpt>
  </trkseg></trk>
  <wpt lat="45" lon="-122"><name>Spot</name></wpt>
</gpx>`);
    expect(raw.rows).toHaveLength(3);
    const v = (r: number, k: string) => raw.rows[r].values[raw.columns.indexOf(k)];
    expect(v(0, 'ele')).toBe('31.5');
    expect(v(0, 'ext:speed')).toBe('1.4');
    expect(v(0, 'track')).toBe('Morning');
    expect(v(2, 'point_type')).toBe('waypoint');
    const ds = buildDataset('a.gpx', raw);
    expect(ds.placed).toBe(2);
    expect(ds.spd[0]).toBe(1.4);
  });
});

describe('KML', () => {
  it('reads placemarks and gx:Track samples', () => {
    const raw = parseKml(`<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document>
  <Placemark><name>Cafe</name><TimeStamp><when>2026-10-27T15:00:00Z</when></TimeStamp>
    <ExtendedData><Data name="accuracy"><value>12</value></Data></ExtendedData>
    <Point><coordinates>-122.6,45.5,10</coordinates></Point></Placemark>
  <Placemark><gx:Track>
    <when>2026-10-27T16:00:00Z</when><when>2026-10-27T16:00:05Z</when>
    <gx:coord>-122.61 45.51 11</gx:coord><gx:coord>-122.62 45.52 12</gx:coord>
  </gx:Track></Placemark>
</Document></kml>`);
    expect(raw.rows).toHaveLength(3);
    const v = (r: number, k: string) => raw.rows[r].values[raw.columns.indexOf(k)];
    expect(v(0, 'data:accuracy')).toBe('12');
    expect(v(2, 'latitude')).toBe('45.52');
    const ds = buildDataset('a.kml', raw);
    expect(ds.placed).toBe(3);
  });
});

describe('detectFormat', () => {
  it('uses the extension, then sniffs the content', () => {
    expect(detectFormat('x.gpx', '')).toBe('gpx');
    expect(detectFormat('export', '{"type":"FeatureCollection"}')).toBe('geojson');
    expect(detectFormat('export', '<?xml version="1.0"?><gpx>')).toBe('gpx');
    expect(detectFormat('export', 'a,b\n1,2')).toBe('csv');
  });
});
