import type { Store } from './store';
import { h, icon, toast } from './dom';
import { colorOfRow, scaleFor } from './colors';
import { motionOf } from '../data/derive';
import { fmtClock, fmtDayYear, fmtDistance, fmtDuration, fmtHM, fmtInt, fmtOffset, readable } from '../data/format';

export class Inspector {
  el: HTMLElement;

  constructor(private store: Store, private showInTable: (i: number) => void) {
    this.el = h('aside.inspector', { 'aria-label': 'Pinned point', hidden: true });
    store.on((changed) => {
      if (changed.has('pinned') || changed.has('rawView') || changed.has('track') || changed.has('colorBy') || changed.has('win')) this.render();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && store.s.pinned >= 0 && !(e.target instanceof HTMLInputElement)) store.pin(-1);
    });
  }

  private step(dir: 1 | -1) {
    const { ds, pinned } = this.store.s;
    const k = ds.rank[pinned] + dir;
    if (k >= 0 && k < ds.order.length) this.store.pin(ds.order[k]);
  }

  render() {
    const s = this.store.s;
    const i = s.pinned;
    if (i < 0) { this.el.hidden = true; return; }
    this.el.hidden = false;
    const { ds, track } = s;
    const row = ds.rows[i];
    const t = ds.t[i];
    const placed = Number.isFinite(ds.lat[i]);
    const idCol = ds.columns.findIndex((c) => c.role === 'id');

    const head = h('div.insp-head', {},
      h('span.dot', { style: `background:${placed ? colorOfRow(s, scaleFor(s), i) : '#5A6575'};box-shadow:0 0 0 2px #fff;margin:0 4px` }),
      h('div.who', {},
        h('b', {}, idCol >= 0 ? `Row id ${row.values[idCol]}` : `Row ${fmtInt(i + 1)}`),
        h('span', {}, `${ds.format === 'csv' ? `Line ${fmtInt(row.line)}` : `Item ${fmtInt(row.line)}`} · ${fmtInt(ds.rank[i] + 1)} of ${fmtInt(ds.rows.length)} in time order`)),
      h('button.btn.icon', { 'aria-label': 'Previous row in time', onclick: () => this.step(-1) }, icon('left')),
      h('button.btn.icon', { 'aria-label': 'Next row in time', onclick: () => this.step(1) }, icon('right')),
      h('button.btn.icon.ghost', { 'aria-label': 'Unpin', onclick: () => this.store.pin(-1) }, icon('x')),
    );

    const timeBlock = h('div.insp-time', {},
      h('div.big', {}, Number.isFinite(t) ? fmtClock(t) : 'No time', ' ',
        Number.isFinite(t) ? h('small', {}, `${fmtDayYear(t)} · ${fmtOffset(t)}`) : null),
      h('div.coords', {}, placed ? `${row.values[ds.columns.findIndex((c) => c.role === 'lat')]}, ${row.values[ds.columns.findIndex((c) => c.role === 'lon')]}` : 'Not on the map: no usable coordinates'),
    );

    const kv: [string, string][] = [];
    const p = track.prev[i], n = track.next[i];
    if (p >= 0) kv.push(['Since previous row', `${fmtDuration(track.dtPrev[i])} · ${fmtDistance(track.distPrev[i])} away`]);
    if (n >= 0) kv.push(['Until next row', `${fmtDuration(track.dtPrev[n])} · ${fmtDistance(track.distPrev[n])} away`]);
    const g = track.gapBefore[i];
    if (g >= 0) kv.push(['After a gap', `${fmtDuration(track.gaps[g].ms)} with no rows`]);
    if (n >= 0 && track.gapBefore[n] >= 0) kv.push(['Before a gap', `${fmtDuration(track.gaps[track.gapBefore[n]].ms)} with no rows`]);
    const mo = motionOf(ds.spd[i]);
    if (mo) kv.push(['Motion (from speed)', mo[0].toUpperCase() + mo.slice(1)]);
    const st = track.stayOf[i];
    if (st >= 0) {
      const stay = track.stays[st];
      kv.push(['Part of', `Stay · ${fmtHM(stay.t0)}–${fmtHM(stay.t1)} · ${fmtDuration(stay.t1 - stay.t0)} · ${fmtInt(stay.rows)} rows`]);
    }
    const derived = h('div.derived', {},
      h('div.h', { style: 'margin:0' }, 'Derived by Trace ', h('span.plain', {}, '· not in the file')),
      kv.length ? kv.map(([k, v]) => h('div.kv', {}, h('span', {}, k), h('span', {}, v))) : h('div.kv', {}, h('span', {}, 'Nothing to add for this row')),
    );

    const fieldsHead = h('div.fields-head', {},
      h('div.h', {}, 'From the file ', h('span.plain', {}, `· ${ds.columns.length} of ${ds.columns.length} columns`)),
      h('div.seg.small', { role: 'tablist', 'aria-label': 'Field view' },
        h('button', { role: 'tab', 'aria-selected': String(!s.rawView), 'aria-pressed': String(!s.rawView), onclick: () => this.store.set({ rawView: false }) }, 'Fields'),
        h('button', { role: 'tab', 'aria-selected': String(s.rawView), 'aria-pressed': String(s.rawView), onclick: () => this.store.set({ rawView: true }) }, 'As stored')),
    );

    const stored = Object.fromEntries(ds.columns.map((c, ci) => [c.key, row.values[ci]]));
    const body = s.rawView
      ? h('pre.raw', {}, JSON.stringify(stored, null, 2))
      : h('dl.fields', {}, ds.columns.map((c, ci) => {
          const shown = readable(ds, i, ci);
          const cls = shown.empty ? 'empty' : c.role === 'time' ? 'time' : c.kind === 'number' ? 'num' : 'str';
          return h('div', {},
            h('dt', { title: c.key }, c.key),
            h(`dd.${cls}`, {}, shown.text, shown.differs ? h('span.stored', {}, `stored as ${JSON.stringify(row.values[ci])}`) : null));
        }));

    const foot = h('div.insp-foot', {},
      h('button.btn', {
        onclick: async () => {
          try { await navigator.clipboard.writeText(JSON.stringify(stored, null, 2)); toast('Copied the row as JSON'); } catch { toast('Copy is not available here'); }
        },
      }, icon('copy'), 'Copy as JSON'),
      h('button.btn', { onclick: () => this.showInTable(i) }, icon('table'), 'Show in table'),
    );

    this.el.replaceChildren(head, h('div.insp-scroll', {}, timeBlock, derived, fieldsHead, body), foot);
  }
}
