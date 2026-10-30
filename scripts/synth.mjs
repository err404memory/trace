// Synthetic location data in the exact shape of a Colota CSV export.
// All places are made up; this exists so development and tests never need real data.

const HEADER = 'id,timestamp,iso_time,latitude,longitude,accuracy,altitude,speed,bearing,battery,battery_status,note';
const ORIGIN = { lat: 45.5152, lon: -122.6784 };
const M_PER_DEG_LAT = 111_320;

/** Small deterministic PRNG so samples and tests are repeatable. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

const PLACES = {
  home: [0, 0],
  cafe: [520, 430],
  office: [5200, 2900],
  parkA: [5600, 2500],
  parkB: [6100, 2300],
  parkC: [6000, 1900],
  store: [2400, -900],
};

/**
 * @param {{days?: number, start?: string, tzOffsetMin?: number, seed?: number, intervalS?: number}} opts
 * start is a local date (YYYY-MM-DD); tzOffsetMin is local minus UTC (e.g. -420 for UTC−7).
 */
export function synthColota(opts = {}) {
  const { days = 1, start = '2026-10-27', tzOffsetMin = -420, seed = 7, intervalS = 5 } = opts;
  const rand = rng(seed);
  const gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const f32 = (x) => String(Math.fround(x));
  const lines = [HEADER];
  let id = 0;
  let battery = 96;
  const startMs = Date.parse(`${start}T00:00:00Z`) - tzOffsetMin * 60_000;

  for (let d = 0; d < days; d++) {
    const dayMs = startMs + d * 86_400_000;
    const at = (h, m) => dayMs + (h * 60 + m) * 60_000;
    // [kind, from local time, to local time, place or waypoints, speed m/s]
    const plan = [
      ['stay', at(6, 30), at(8, 5), 'home'],
      ['move', at(8, 5), at(8, 16), ['home', 'cafe'], 1.35],
      ['stay', at(8, 16), at(8, 34), 'cafe'],
      ['move', at(8, 34), at(8, 50), ['cafe', 'office'], 9.5, { gapFrom: 0.45, gapS: 150 }],
      ['stay', at(8, 50), at(12, 30), 'office'],
      ['move', at(12, 30), at(13, 22), ['office', 'parkA', 'parkB', 'parkC', 'parkA', 'office'], 1.4],
      ['stay', at(13, 22), at(17, 40 + d * 7), 'office'],
      ['move', at(17, 40 + d * 7), at(18, 2 + d * 7), d % 2 ? ['office', 'store', 'home'] : ['office', 'home'], 8.5, { gapFrom: 0.6, gapS: 540 }],
      ['stay', at(18, 2 + d * 7), at(22, 30), 'home'],
    ];

    let pos = [0, 0];
    for (const [kind, t0, t1, where, speed, opt] of plan) {
      const steps = Math.floor((t1 - t0) / 1000 / intervalS);
      const path = kind === 'move' ? where.map((p) => PLACES[p]) : null;
      const lengths = path ? path.slice(1).map((p, k) => Math.hypot(p[0] - path[k][0], p[1] - path[k][1])) : [];
      const total = lengths.reduce((a, b) => a + b, 0);
      for (let s = 0; s < steps; s++) {
        const t = t0 + s * intervalS * 1000;
        const frac = s / steps;
        if (opt && frac >= opt.gapFrom && frac < opt.gapFrom + opt.gapS / ((t1 - t0) / 1000)) continue; // no fix
        let x, y, spd, brg;
        if (kind === 'stay') {
          [x, y] = PLACES[where];
          spd = Math.abs(gauss() * 0.06);
          brg = 0;
        } else {
          let dist = frac * total;
          let k = 0;
          while (k < lengths.length - 1 && dist > lengths[k]) { dist -= lengths[k]; k++; }
          const a = path[k], b = path[k + 1];
          const u = lengths[k] ? dist / lengths[k] : 0;
          x = a[0] + (b[0] - a[0]) * u;
          y = a[1] + (b[1] - a[1]) * u;
          spd = Math.max(0, total / ((t1 - t0) / 1000) * (1 + gauss() * 0.08));
          brg = ((Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI + 360) % 360;
        }
        const acc = kind === 'stay' ? 7 + rand() * 7 : 3.6 + rand() * 3;
        const jitter = acc / 3;
        pos = [x + gauss() * jitter, y + gauss() * jitter];
        const lat = ORIGIN.lat + pos[1] / M_PER_DEG_LAT;
        const lon = ORIGIN.lon + pos[0] / (M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180));
        const localHour = new Date(t + tzOffsetMin * 60_000).getUTCHours();
        const charging = kind === 'stay' && where === 'home' && localHour >= 21;
        if (s % 120 === 0) battery = Math.max(5, Math.min(100, battery + (charging ? 2 : -1)));
        lines.push([
          id++,
          Math.round(t / 1000),
          new Date(t).toISOString(),
          lat.toFixed(7),
          lon.toFixed(7),
          f32(acc),
          Math.round(35 + y / 400 + gauss() * 0.4),
          f32(spd),
          f32(brg),
          battery,
          charging ? 'Charging' : 'Discharging',
          '',
        ].join(','));
      }
    }
  }
  return lines.join('\n') + '\n';
}
