import type { RawTable, Role } from '../data/types';
import { h } from './dom';

const LABELS: Partial<Record<Role, string>> = { lat: 'Latitude', lon: 'Longitude', time: 'Time' };

/** Asks which columns hold latitude, longitude and time when Trace can't tell. Resolves null for "table only". */
export function askMapping(raw: RawTable, missing: Role[]): Promise<Partial<Record<Role, string>> | null> {
  return new Promise((resolve) => {
    const selects = new Map<Role, HTMLSelectElement>();
    const roles: Role[] = ['lat', 'lon', 'time'];
    const dialog = h('dialog', { 'aria-labelledby': 'map-title' },
      h('h2', { id: 'map-title' }, 'Which columns are which?'),
      h('p.muted', { style: 'margin:0;font-size:13px' },
        `Trace couldn’t find ${missing.map((r) => LABELS[r]?.toLowerCase()).join(', ')} by name. Pick the columns, or open the file as a table only.`),
      ...roles.map((role) => {
        const sel = h('select', {}, h('option', { value: '' }, '—'), ...raw.columns.map((c) => h('option', { value: c }, c)));
        selects.set(role, sel);
        return h('label', {}, LABELS[role]!, sel);
      }),
      h('div.actions', {},
        h('button.btn', { type: 'button', onclick: () => { dialog.close(); resolve(null); } }, 'Table only'),
        h('button.btn.primary', {
          type: 'button',
          onclick: () => {
            const out: Partial<Record<Role, string>> = {};
            for (const [role, sel] of selects) if (sel.value) out[role] = sel.value;
            dialog.close();
            resolve(out);
          },
        }, 'Use these')),
    );
    dialog.addEventListener('cancel', () => resolve(null));
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  });
}
