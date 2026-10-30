import { h, icon, logo } from './dom';
import type { SavedFile } from '../storage';
import { fmtDayYear, fmtInt } from '../data/format';

export const ACCEPT = '.csv,.tsv,.txt,.geojson,.json,.gpx,.kml,text/csv,application/geo+json,application/json,application/gpx+xml,application/vnd.google-earth.kml+xml';

const FORMATS: [string, string, string][] = [
  ['.csv', 'CSV', 'Every column kept. Colota exports are recognised; for other apps Trace finds latitude, longitude and time, or asks you.'],
  ['.geojson', 'GeoJSON', 'One row per point, with every property. Nested values kept as written.'],
  ['.gpx', 'GPX', 'Track points, route points and waypoints, with time, elevation and extensions.'],
  ['.kml', 'KML', 'Placemarks and Google Earth tracks, with timestamps and ExtendedData.'],
];

export function importView(opts: {
  onFile: (file: File) => void;
  last: SavedFile | null;
  onReopen: () => void;
  onForget: () => void;
  error?: string;
}): HTMLElement {
  const input = h('input', { type: 'file', accept: ACCEPT, class: 'sr-only', 'aria-label': 'Choose a location export' });
  input.addEventListener('change', () => { if (input.files?.[0]) opts.onFile(input.files[0]); });

  const drop = h('button.drop', { type: 'button', onclick: () => input.click() },
    h('span.circle', {}, icon('upload')),
    h('b', { style: 'font-size:16px' }, 'Choose a file'),
    h('span.muted', { style: 'font-size:13px' }, 'or drop it here · on Android, share it to Trace from any app'),
  );
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f) opts.onFile(f);
  });

  return h('main.import', {},
    h('div.import-inner', {},
      h('div.brand', {}, logo(), 'Trace'),
      h('div', {},
        h('h1', {}, 'Open a location export'),
        h('p.muted', { style: 'margin:6px 0 0' }, 'Every row and every field is kept. Nothing is dropped, rounded or merged.')),
      opts.error ? h('div.error', { role: 'alert' }, opts.error) : null,
      drop, input,
      h('p.note.good', { style: 'display:flex;gap:8px;align-items:center;margin:0' }, icon('lock'), 'Read on this device. Never uploaded.'),
      opts.last ? h('section', {},
        h('h2.h', {}, 'Last opened'),
        h('button.recent', { onclick: opts.onReopen }, icon('file'),
          h('span', { style: 'flex:1 1 auto;min-width:0;display:flex;flex-direction:column' },
            h('span.mono', { style: 'font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, opts.last.name),
            h('span.muted', { style: 'font-size:12px' }, `${opts.last.rows ? fmtInt(opts.last.rows) + ' rows · ' : ''}opened ${fmtDayYear(opts.last.openedAt)}`)),
          icon('right')),
        h('button.btn.ghost', { style: 'margin-top:6px', onclick: opts.onForget }, 'Forget it on this device')) : null,
      h('section.formats', {},
        h('h2.h', {}, 'Formats it reads'),
        ...FORMATS.map(([ext, name, desc]) => h('div', {}, h('span.ext', {}, ext), h('span', {}, h('b', {}, name), h('p', {}, desc))))),
    ));
}
