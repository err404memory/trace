import type { Store, Layers } from './store';
import { h, icon } from './dom';
import { COLOR_BY, GRADIENT_CSS, scaleFor } from './colors';
import { defaultGapMs } from '../data/derive';
import { fmtDay, fmtDistance, fmtDuration, fmtInt } from '../data/format';

const GAP_STEPS = [10, 20, 30, 45, 60, 90, 120, 180, 300, 600, 900].map((s) => s * 1000);

const LAYERS: { key: keyof Layers; label: string; swatch: string }[] = [
  { key: 'points', label: 'Points', swatch: '<span class="dot" style="background:#5CC2A0"></span>' },
  { key: 'paths', label: 'Recorded paths', swatch: '<span style="width:20px;border-top:3px solid #C8D1DC"></span>' },
  { key: 'inferred', label: 'Inferred across gaps', swatch: '<span style="width:20px;border-top:3px dotted #AEB9C7"></span>' },
  { key: 'accuracy', label: 'GPS accuracy, to scale', swatch: '<span style="width:14px;height:14px;border-radius:50%;background:rgba(92,194,160,.3)"></span>' },
  { key: 'stays', label: 'Stays', swatch: '<span style="width:14px;height:14px;border-radius:50%;border:1px dashed #8592A2"></span>' },
];

export class Rail {
  el: HTMLElement;

  constructor(private store: Store) {
    this.el = h('aside.rail', { 'aria-label': 'Dataset and layers' });
    store.on((changed) => {
      if (['win', 'daysOn', 'track', 'layers', 'colorBy'].some((k) => changed.has(k as never))) this.render();
    });
    this.render();
  }

  render() {
    const s = this.store.s;
    const { ds, track } = s;
    let rowsIn = 0, recorded = 0, inferred = 0, gaps = 0;
    for (const i of track.seq) {
      if (!this.store.inWindow(i)) continue;
      rowsIn++;
      const p = track.prev[i];
      if (p < 0 || !this.store.inWindow(p)) continue;
      if (track.gapBefore[i] >= 0) { inferred += track.distPrev[i]; gaps++; } else recorded += track.distPrev[i];
    }
    const stays = track.stays.filter((st) => st.t1 >= s.win[0] && st.t0 <= s.win[1]).length;
    const dist = (m: number) => { const t = fmtDistance(m).split(' '); return h('b', {}, t[0], h('small', {}, ` ${t[1]}`)); };

    const selected = s.days.filter((d) => s.daysOn.has(d.key));
    const title = selected.length === 1 ? fmtDay(selected[0].start) : selected.length ? `${selected.length} days` : 'No day selected';

    const problems = ds.issues.length + ds.skipped.reduce((a, b) => a + b.count, 0);
    const unplaced = ds.rows.length - ds.placed;
    const summary = h('section', {},
      h('h2.h', {}, title),
      h('div.stats', {},
        h('div.stat', {}, h('b', {}, fmtInt(rowsIn)), h('span', {}, 'Rows on the map')),
        h('div.stat', {}, dist(recorded), h('span', {}, 'Recorded distance')),
        h('div.stat', {}, h('b', {}, fmtInt(stays)), h('span', {}, 'Stays')),
        h('div.stat', {}, h('b', {}, fmtInt(gaps)), h('span', {}, `Gaps · ${fmtDistance(inferred)} inferred`))),
      h('p.note.good', { style: 'display:flex;gap:6px;align-items:center' }, icon('check'), `All ${fmtInt(ds.rows.length)} rows read`),
      unplaced ? h('p.note.warn', {}, `${fmtInt(unplaced)} rows have no usable time or position: they’re in the table, not on the map.`) : null,
      problems ? h('details', { class: 'note' },
        h('summary', {}, `${fmtInt(problems)} things to know about this file`),
        ...ds.skipped.map((k) => h('div', {}, `${fmtInt(k.count)} × ${k.what}`)),
        ...ds.issues.slice(0, 50).map((iss) => h('div', {}, `Line ${iss.line}: ${iss.message}`)),
        ds.issues.length > 50 ? h('div', {}, `…and ${ds.issues.length - 50} more`) : null) : null,
    );

    const layers = h('section', {}, h('h2.h', {}, 'Layers'),
      ...LAYERS.map((L) => {
        const on = s.layers[L.key];
        const sw = h('span.sw', { 'aria-hidden': 'true' });
        sw.innerHTML = L.swatch;
        return h('button.switch-row', {
          role: 'switch', 'aria-checked': String(on),
          onclick: () => this.store.set({ layers: { ...s.layers, [L.key]: !on } }),
        }, sw, h('span.label', {}, L.label), h('span.track', { 'aria-hidden': 'true' }));
      }));

    const sc = scaleFor(s);
    const color = h('section', {}, h('h2.h', {}, 'Colour points by'),
      h('div.seg.full', { role: 'radiogroup', 'aria-label': 'Colour points by' },
        ...COLOR_BY.map((c) => h('button', { role: 'radio', 'aria-checked': String(s.colorBy === c.key), onclick: () => this.store.set({ colorBy: c.key }) }, c.label))),
      h('div.legend-bar', { style: `background:${GRADIENT_CSS}`, 'aria-hidden': 'true' }),
      h('div.legend-labels', {}, ...sc.labels.map((l) => h('span', {}, l))),
      sc.note ? h('p.note', {}, sc.note) : null,
    );

    const auto = defaultGapMs(track.medianIntervalMs);
    const steps = [...new Set([...GAP_STEPS, auto])].sort((a, b) => a - b);
    const slider = h('input', { type: 'range', min: 0, max: steps.length - 1, step: 1, value: Math.max(0, steps.indexOf(track.gapMs)), 'aria-label': 'Gap threshold' });
    const val = h('span.val', {}, fmtDuration(track.gapMs));
    slider.addEventListener('input', () => { val.textContent = fmtDuration(steps[Number(slider.value)]); });
    slider.addEventListener('change', () => this.store.setGap(steps[Number(slider.value)]));
    const inference = h('section', {}, h('h2.h', {}, 'Gaps'),
      h('label.range-row', {},
        h('span', { style: 'display:flex;justify-content:space-between;gap:8px' }, h('span', {}, 'Rows further apart than'), val),
        slider),
      h('p.note', {}, Number.isFinite(track.medianIntervalMs)
        ? `This file usually records every ${fmtDuration(track.medianIntervalMs)}. Default: ${fmtDuration(auto)}.`
        : 'Not enough timed rows to measure the recording interval.'),
    );

    const days = h('section', {}, h('h2.h', {}, 'Days in file'),
      ...s.days.map((d) => {
        const box = h('input', { type: 'checkbox' });
        box.checked = s.daysOn.has(d.key);
        box.addEventListener('change', () => {
          const next = new Set(s.daysOn);
          if (box.checked) next.add(d.key); else next.delete(d.key);
          this.store.setDays(next);
        });
        return h('label.day', {}, box, h('span', {}, fmtDay(d.start)), h('span.n', {}, `${fmtInt(d.rows)} rows`));
      }),
      s.days.length > 1 ? h('div', { style: 'display:flex;gap:8px;margin-top:6px' },
        h('button.btn', { onclick: () => this.store.setDays(new Set(s.days.map((d) => d.key))) }, 'All days'),
        h('button.btn', { onclick: () => this.store.setDays(new Set([s.days[0].key])) }, 'First day')) : null,
    );

    this.el.replaceChildren(summary, layers, color, inference, days);
  }
}
