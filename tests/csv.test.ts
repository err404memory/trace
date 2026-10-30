import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/data/parse/csv';
import { buildDataset, parseTime } from '../src/data/dataset';
import { synthColota } from '../scripts/synth.mjs';

const COLOTA_HEAD = 'id,timestamp,iso_time,latitude,longitude,accuracy,altitude,speed,bearing,battery,battery_status,note';
// Rows copied in shape from a real Colota export (values made up).
const COLOTA = `${COLOTA_HEAD}
0,1793104160,2026-10-27T12:29:20.000Z,45.5228875,-122.6116729,9.071999549865723,35,0.03999999910593033,0,49,Charging,
1,1793104165,2026-10-27T12:29:25.000Z,45.5228798,-122.6116784,10.288999557495117,35,0.10999999940395355,259.1000061035156,49,Charging,
`;

describe('CSV parser', () => {
  it('recognises Colota and keeps every cell exactly as stored', () => {
    const raw = parseCsv(COLOTA);
    expect(raw.source).toBe('Colota');
    expect(raw.columns).toEqual(COLOTA_HEAD.split(','));
    expect(raw.rows).toHaveLength(2);
    expect(raw.rows[0].values[5]).toBe('9.071999549865723');
    expect(raw.rows[1].values[8]).toBe('259.1000061035156');
    expect(raw.rows[0].values[11]).toBe('');
    expect(raw.issues).toEqual([]);
  });

  it('round-trips: every data line becomes one row with identical cells', () => {
    const text = synthColota({ days: 1 });
    const lines = text.trim().split('\n');
    const raw = parseCsv(text);
    expect(raw.rows).toHaveLength(lines.length - 1);
    for (let i = 0; i < raw.rows.length; i += 997) {
      expect(raw.rows[i].values.join(',')).toBe(lines[i + 1]);
    }
  });

  it('handles quotes, embedded commas and newlines, CRLF and BOM', () => {
    const text = '﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n2,"two\nlines",\r\n';
    const raw = parseCsv(text);
    expect(raw.columns).toEqual(['a', 'b', 'c']);
    expect(raw.rows.map((r) => r.values)).toEqual([
      ['1', 'x, y', 'say "hi"'],
      ['2', 'two\nlines', ''],
    ]);
    expect(raw.rows[1].line).toBe(3);
  });

  it('keeps rows with the wrong number of cells and reports them', () => {
    const raw = parseCsv('a,b,c\n1,2\n1,2,3,4\n');
    expect(raw.rows.map((r) => r.values)).toEqual([['1', '2', ''], ['1', '2', '3,4']]);
    expect(raw.issues.map((i) => i.line)).toEqual([2, 3]);
  });

  it('detects semicolons and renames duplicate or blank headers', () => {
    const raw = parseCsv('lat;lat;;lon\n1;2;3;4\n');
    expect(raw.columns).toEqual(['lat', 'lat_2', 'column_3', 'lon']);
  });
});

describe('dataset', () => {
  it('maps Colota roles and keeps unplaceable rows', () => {
    const text = `${COLOTA}2,1793104170,2026-10-27T12:29:30.000Z,,,8.5,35,0,0,49,Charging,no fix\n`;
    const ds = buildDataset('x.csv', parseCsv(text));
    const roles = Object.fromEntries(ds.columns.filter((c) => c.role).map((c) => [c.role, c.key]));
    expect(roles).toMatchObject({ time: 'iso_time', lat: 'latitude', lon: 'longitude', accuracy: 'accuracy', speed: 'speed', bearing: 'bearing', battery: 'battery' });
    expect(ds.rows).toHaveLength(3);
    expect(ds.placed).toBe(2);
    expect(ds.t[0]).toBe(Date.parse('2026-10-27T12:29:20.000Z'));
    expect(ds.bat[0]).toBeCloseTo(0.49);
  });

  it('sorts by time but keeps file order for rows without a time', () => {
    const ds = buildDataset('x.csv', parseCsv('time,lat,lon\n2026-01-02T00:00:00Z,1,1\n,2,2\n2026-01-01T00:00:00Z,3,3\n'));
    expect(Array.from(ds.order)).toEqual([2, 0, 1]);
  });

  it('reads epoch seconds and milliseconds', () => {
    expect(parseTime('1793104160')).toBe(1793104160000);
    expect(parseTime('1793104160000')).toBe(1793104160000);
    expect(parseTime('12')).toBeNaN();
    expect(parseTime('')).toBeNaN();
  });
});
