import type { Dataset } from '../data/types';
import { Store } from './store';
import { h, icon, logo } from './dom';
import { MapView } from './mapView';
import { Inspector } from './inspector';
import { Rail } from './rail';
import { Timeline } from './timeline';
import { TableView } from './tableView';
import { ACCEPT } from './importView';
import { fmtDuration, fmtInt } from '../data/format';

/** The main app once a file is open: header, rail, map or table, inspector. */
export function shell(ds: Dataset, onFile: (f: File) => void): HTMLElement {
  const store = new Store(ds);
  const rail = new Rail(store);
  const map = new MapView(store);
  const timeline = new Timeline(store);
  let table: TableView | null = null;
  const inspector = new Inspector(store, (i) => {
    store.set({ view: 'table' });
    table?.reveal(i);
  });

  const mapCol = h('div.center', {}, map.el, timeline.el);
  const tableCol = h('div.center', { hidden: true });
  const body = h('div.body', {}, rail.el, mapCol, tableCol, inspector.el);

  const viewBtn = (view: 'map' | 'table', label: string) =>
    h('button', { 'aria-pressed': String(store.s.view === view), 'aria-label': label, onclick: () => store.set({ view }) }, icon(view), h('span.lbl', {}, label));
  const nav = h('nav.seg', { 'aria-label': 'View' }, viewBtn('map', 'Map'), viewBtn('table', 'Table'));

  const input = h('input', { type: 'file', accept: ACCEPT, class: 'sr-only', 'aria-label': 'Open another export' });
  input.addEventListener('change', () => { if (input.files?.[0]) onFile(input.files[0]); });

  const interval = store.s.track.medianIntervalMs;
  const header = h('header.top', {},
    h('button.btn.icon.only-narrow', { 'aria-label': 'Layers and days', onclick: () => rail.el.classList.toggle('open') }, icon('layers')),
    h('div.brand', {}, logo(), h('span', {}, 'Trace')),
    h('div.file-chip', { title: ds.name },
      h('span.name', {}, ds.name),
      h('span.badge', {}, `${ds.format.toUpperCase()}${ds.source ? ' · ' + ds.source : ''}`),
      h('span.meta.muted', { style: 'font-size:13px;white-space:nowrap' },
        `${fmtInt(ds.rows.length)} rows · ${ds.columns.length} columns${Number.isFinite(interval) ? ` · every ${fmtDuration(interval)}` : ''}`)),
    h('div.spacer'),
    nav,
    h('button.btn.primary', { 'aria-label': 'Open another file', onclick: () => input.click() }, icon('upload'), h('span.lbl', {}, 'Open')),
    input,
  );

  store.on((changed) => {
    if (!changed.has('view')) return;
    const v = store.s.view;
    nav.querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-pressed', String((k === 0) === (v === 'map'))));
    mapCol.hidden = v !== 'map';
    tableCol.hidden = v !== 'table';
    if (v === 'table' && !table) {
      table = new TableView(store);
      tableCol.append(table.el);
    }
    if (v === 'map') map.resize();
  });
  // Close the drawer when tapping the map on narrow screens.
  mapCol.addEventListener('pointerdown', () => rail.el.classList.remove('open'));

  return h('div.app', {}, header, body);
}
