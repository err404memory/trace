import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/data/parse/csv';
import { buildDataset } from '../src/data/dataset';
import { buildTrack, motionOf } from '../src/data/derive';
import { readable } from '../src/data/format';
import { synthColota } from '../scripts/synth.mjs';

const ds = buildDataset('synthetic.csv', parseCsv(synthColota({ days: 1 })));
const track = buildTrack(ds);

describe('track', () => {
  it('uses a 60 s gap threshold for 5-second data', () => {
    expect(track.medianIntervalMs).toBe(5000);
    expect(track.gapMs).toBe(60_000);
  });

  it('finds the two signal gaps in the synthetic day', () => {
    // Synthetic day: a 150 s gap on the morning drive and a 540 s gap on the evening drive.
    const secs = track.gaps.map((g) => g.ms / 1000);
    expect(secs).toHaveLength(2);
    expect(Math.abs(secs[0] - 150)).toBeLessThanOrEqual(15);
    expect(Math.abs(secs[1] - 540)).toBeLessThanOrEqual(15);
  });

  it('finds the stays: home, café, office, office, home', () => {
    const mins = track.stays.map((s) => Math.round((s.t1 - s.t0) / 60_000));
    expect(track.stays).toHaveLength(5);
    expect(mins[0]).toBeGreaterThan(90);
    expect(mins[1]).toBeGreaterThanOrEqual(15);
    expect(mins[2]).toBeGreaterThan(200);
    // Every stay row is within (or just outside) the drawn radius
    for (const s of track.stays) expect(s.radius).toBeLessThan(50);
  });

  it('labels every row in a stay', () => {
    const s = track.stays[2];
    let inStay = 0;
    for (let k = ds.rank[s.first]; k <= ds.rank[s.last]; k++) if (track.stayOf[ds.order[k]] === s.id) inStay++;
    expect(inStay).toBe(s.rows);
  });
});

describe('readable values', () => {
  const ci = (k: string) => ds.columns.findIndex((c) => c.key === k);
  it('rounds float noise for display but says the stored text differs', () => {
    const shown = readable(ds, 0, ci('accuracy'));
    expect(shown.text).toMatch(/^±\d+(\.\d{1,2})? m$/);
    expect(shown.differs).toBe(true);
  });
  it('calls bearing 0 at rest unknown', () => {
    expect(readable(ds, 0, ci('bearing')).text).toBe('0 · unknown (at rest)');
  });
  it('shows coordinates exactly as stored', () => {
    expect(readable(ds, 0, ci('latitude'))).toMatchObject({ differs: false });
  });
  it('marks empty cells', () => {
    expect(readable(ds, 0, ci('note'))).toMatchObject({ text: '(empty)', empty: true });
  });
});

describe('motion', () => {
  it('estimates from speed', () => {
    expect(motionOf(0.1)).toBe('stationary');
    expect(motionOf(1.4)).toBe('walking');
    expect(motionOf(12)).toBe('vehicle');
    expect(motionOf(NaN)).toBeNull();
  });
});
