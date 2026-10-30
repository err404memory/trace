import type { Store } from './store';
import { download, h, icon, toast } from './dom';
import { colorOfRow, scaleFor } from './colors';
import { fmtDuration, fmtHM, fmtDay, fmtInt, readable, round } from '../data/format';

const ROW_H = 30;
type ColId = '#' | 'dt' | number;
interface Col { id: ColId; label: string; w: number; right: boolean }
interface SortKey { id: ColId; dir: 1 | -1 }

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export class TableView {
  el: HTMLElement;
  private cols: Col[] = [];
  private sort: SortKey[] = [];
  private query = '';
  private inWindow = true;
  private profileCol: ColId = '#';
  /** Rows (>= 0) and gap markers (-(gapIndex + 1)) in display order. */
  private list = new Int32Array(0);
  private shownRows = 0;
  private nums = new Map<number, Float64Array>();
  private haystack: string[] | null = null;

  private scroller: HTMLElement;
  private head: HTMLElement;
  private bodyEl: HTMLElement;
  private foot: HTMLElement;
  private profile: HTMLElement;
  private windowChip: HTMLElement;
  private searchInput: HTMLInputElement;
  private modeSeg: HTMLElement;

  constructor(private store: Store) {
    const { ds } = store.s;
    const timeCol = ds.columns.findIndex((c) => c.role === 'time');
    this.sort = [{ id: timeCol >= 0 ? timeCol : '#', dir: 1 }];
    this.profileCol = ds.columns.findIndex((c) => c.role === 'speed');
    if (this.profileCol === -1) this.profileCol = '#';
    this.buildCols();

    this.searchInput = h('input', { type: 'search', placeholder: 'Search every column…', 'aria-label': 'Search every column' });
    let timer = 0;
    this.searchInput.addEventListener('input', () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => { this.query = this.searchInput.value.trim().toLowerCase(); this.recompute(); }, 150);
    });
    this.windowChip = h('span');
    this.modeSeg = h('div.seg', { role: 'radiogroup', 'aria-label': 'Values' });

    const toolbar = h('div.toolbar', {},
      h('label.search', {}, icon('search'), this.searchInput),
      this.windowChip,
      h('div.spacer'),
      this.modeSeg,
      h('button.btn', { onclick: () => this.exportView() }, icon('download'), 'Export view'),
    );

    this.head = h('div.grid-head', { role: 'row' });
    this.bodyEl = h('div.grid-body', { role: 'rowgroup' });
    this.scroller = h('div.grid-scroll', { role: 'grid', 'aria-label': 'Rows', tabindex: 0 }, this.head, this.bodyEl);
    this.scroller.addEventListener('scroll', () => this.paint(), { passive: true });
    this.foot = h('div.grid-foot');
    this.profile = h('aside.profile', { 'aria-label': 'Column profile' });

    this.el = h('div.table-view', {}, h('div.table-main', {}, toolbar, this.scroller, this.foot), this.profile);

    new ResizeObserver(() => this.paint()).observe(this.scroller);
    store.on((changed) => {
      if (changed.has('win') || changed.has('daysOn') || changed.has('track')) this.recompute();
      else if (changed.has('pinned') || changed.has('storedValues') || changed.has('colorBy')) { this.renderMode(); this.paint(); }
    });
    this.renderMode();
    this.recompute();
  }

  /** Make sure row i is listed, then scroll to it. */
  reveal(i: number) {
    let pos = this.list.indexOf(i);
    if (pos < 0) {
      this.query = ''; this.searchInput.value = ''; this.inWindow = false;
      this.recompute();
      pos = this.list.indexOf(i);
      toast('Filters cleared to show this row');
    }
    if (pos >= 0) {
      const top = pos * ROW_H;
      const sc = this.scroller;
      const headH = this.head.offsetHeight;
      if (top < sc.scrollTop || top > sc.scrollTop + sc.clientHeight - headH - ROW_H * 2) sc.scrollTop = Math.max(0, top - sc.clientHeight / 3);
      this.paint();
    }
  }

  private buildCols() {
    const { ds } = this.store.s;
    const width = (label: string, ci: number) => {
      let max = label.length + 2;
      const step = Math.max(1, Math.floor(ds.rows.length / 300));
      for (let r = 0; r < ds.rows.length; r += step) max = Math.max(max, Math.min(40, readable(ds, r, ci, true).text.length));
      return Math.min(300, Math.max(64, max * 7.6 + 22));
    };
    this.cols = [
      { id: '#', label: '#', w: Math.max(64, String(ds.rows.length).length * 8 + 40), right: false },
      { id: 'dt', label: 'Δ prev', w: 92, right: true },
      ...ds.columns.map((c, ci) => ({ id: ci as ColId, label: c.key, w: width(c.key, ci), right: c.kind === 'number' && c.role !== 'time' })),
    ];
  }

  private numeric(ci: number): Float64Array {
    let arr = this.nums.get(ci);
    if (!arr) {
      const { ds } = this.store.s;
      const role = ds.columns[ci].role;
      arr = role === 'time' ? ds.t : Float64Array.from(ds.rows, (r) => { const v = r.values[ci]; return v.trim() === '' ? NaN : Number(v); });
      this.nums.set(ci, arr);
    }
    return arr;
  }

  private recompute() {
    const s = this.store.s;
    const { ds, track } = s;
    if (this.query && !this.haystack) this.haystack = ds.rows.map((r) => r.values.join('\u0001').toLowerCase());
    const rows: number[] = [];
    for (let i = 0; i < ds.rows.length; i++) {
      if (this.inWindow && !this.store.inWindow(i)) continue;
      if (this.query && !this.haystack![i].includes(this.query)) continue;
      rows.push(i);
    }
    const cmp = this.comparator();
    rows.sort(cmp);
    this.shownRows = rows.length;

    // Gap markers only make sense in plain time order.
    const timeCol = ds.columns.findIndex((c) => c.role === 'time');
    const timeOrder = !this.query && this.sort.length === 1 && this.sort[0].dir === 1 && this.sort[0].id === timeCol;
    if (timeOrder) {
      const out: number[] = [];
      for (const i of rows) {
        const g = track.gapBefore[i];
        if (g >= 0) out.push(-(g + 1));
        out.push(i);
      }
      this.list = Int32Array.from(out);
    } else {
      this.list = Int32Array.from(rows);
    }

    this.bodyEl.style.height = `${this.list.length * ROW_H}px`;
    this.renderHead();
    this.renderChrome();
    this.renderProfile();
    this.paint();
  }

  private comparator(): (a: number, b: number) => number {
    const { ds, track } = this.store.s;
    const keys = this.sort.map((k) => {
      if (k.id === '#') return { dir: k.dir, num: null as Float64Array | null, text: false, id: k.id };
      if (k.id === 'dt') return { dir: k.dir, num: track.dtPrev, text: false, id: k.id };
      const c = ds.columns[k.id];
      return c.kind === 'number' || c.role === 'time'
        ? { dir: k.dir, num: this.numeric(k.id), text: false, id: k.id }
        : { dir: k.dir, num: null, text: true, id: k.id };
    });
    return (a, b) => {
      for (const k of keys) {
        let d = 0;
        if (k.id === '#') d = a - b;
        else if (k.num) {
          const x = k.num[a], y = k.num[b];
          const nx = Number.isNaN(x), ny = Number.isNaN(y);
          if (nx || ny) { if (nx !== ny) return nx ? 1 : -1; continue; } // blanks always last
          d = x - y;
        } else if (k.text) d = collator.compare(ds.rows[a].values[k.id as number], ds.rows[b].values[k.id as number]);
        if (d) return d * k.dir;
      }
      return a - b;
    };
  }

  private clickHeader(id: ColId, add: boolean) {
    const at = this.sort.findIndex((k) => k.id === id);
    if (add) {
      if (at >= 0) this.sort[at].dir = this.sort[at].dir === 1 ? -1 : 1;
      else this.sort.push({ id, dir: 1 });
    } else if (at === 0 && this.sort.length === 1) {
      this.sort[0].dir = this.sort[0].dir === 1 ? -1 : 1;
    } else {
      this.sort = [{ id, dir: 1 }];
    }
    this.profileCol = id;
    this.recompute();
  }

  private renderHead() {
    this.head.replaceChildren(...this.cols.map((c) => {
      const at = this.sort.findIndex((k) => k.id === c.id);
      const arrow = at < 0 ? '↕' : `${this.sort[at].dir === 1 ? '↑' : '↓'}${this.sort.length > 1 ? at + 1 : ''}`;
      const cls = [c.right && 'r', at >= 0 && 'sorted', this.profileCol === c.id && 'profiled'].filter(Boolean).join(' ');
      return h('button', {
        class: cls,
        style: `width:${c.w}px`,
        title: `${c.label} — click to sort, shift-click to add a second sort`,
        'aria-sort': at < 0 ? 'none' : this.sort[at].dir === 1 ? 'ascending' : 'descending',
        onclick: (e: Event) => this.clickHeader(c.id, (e as MouseEvent).shiftKey),
      }, c.label, h('span.arrow', { 'aria-hidden': 'true' }, arrow));
    }));
  }

  private renderMode() {
    const stored = this.store.s.storedValues;
    this.modeSeg.replaceChildren(
      h('button', { role: 'radio', 'aria-checked': String(!stored), onclick: () => this.store.set({ storedValues: false }) }, 'Readable'),
      h('button', { role: 'radio', 'aria-checked': String(stored), onclick: () => this.store.set({ storedValues: true }) }, 'As stored'),
    );
  }

  private renderChrome() {
    const s = this.store.s;
    const [a, b] = s.win;
    this.windowChip.replaceChildren(this.inWindow
      ? h('span.chip', {}, `Time window: ${fmtDay(a)} ${fmtHM(a)} – ${fmtDay(b) === fmtDay(a) ? '' : fmtDay(b) + ' '}${fmtHM(b)}`,
          h('button.x', { 'aria-label': 'Show rows from every day', onclick: () => { this.inWindow = false; this.recompute(); } }, icon('x')))
      : h('button.chip.off', { onclick: () => { this.inWindow = true; this.recompute(); } }, '+ Only the map’s time window'));

    const total = s.ds.rows.length;
    const hidden = total - this.shownRows;
    this.foot.replaceChildren(...[
      h('span', {}, `${fmtInt(this.shownRows)} rows shown · ${fmtInt(total)} in file${hidden ? ` · ${fmtInt(hidden)} hidden by filters` : ''}`),
      h('span', {}, `All ${s.ds.columns.length} columns`),
      h('div.spacer'),
      this.list.length !== this.shownRows ? h('span', {}, 'Gap rows are added by Trace and are not in your file') : null,
    ].filter((x): x is HTMLElement => x !== null));
  }

  private paint() {
    const s = this.store.s;
    const { ds, track } = s;
    const sc = this.scroller;
    const headH = this.head.offsetHeight;
    const first = Math.max(0, Math.floor((sc.scrollTop - headH) / ROW_H) - 8);
    const last = Math.min(this.list.length, first + Math.ceil(sc.clientHeight / ROW_H) + 16);
    const scale = scaleFor(s);
    const out: HTMLElement[] = [];
    for (let k = first; k < last; k++) {
      const v = this.list[k];
      const top = `top:${k * ROW_H}px`;
      if (v < 0) {
        const g = track.gaps[-v - 1];
        out.push(h('div.grow.gap', { style: top, role: 'row' },
          h('span', {}, `Gap · ${fmtDuration(g.ms)} with no rows, ${round(g.metres, 0)} m apart — path across it is inferred`)));
        continue;
      }
      const i = v;
      const cells = this.cols.map((c) => {
        const style = `width:${c.w}px`;
        if (c.id === '#') {
          const placed = Number.isFinite(ds.lat[i]);
          return h('span.d', { style: `${style};display:flex;align-items:center;gap:8px` },
            h('span.dot', { style: `width:8px;height:8px;background:${placed ? colorOfRow(s, scale, i) : 'transparent'};${placed ? '' : 'border:1px solid #5A6575'}` }),
            String(i + 1));
        }
        if (c.id === 'dt') {
          const dt = track.dtPrev[i];
          return h('span.r.d', { style }, Number.isFinite(dt) ? `+${fmtDuration(dt)}` : '');
        }
        const raw = ds.rows[i].values[c.id];
        if (s.storedValues) return h(`span${c.right ? '.r' : ''}` as 'span', { style, title: raw }, raw);
        const shown = readable(ds, i, c.id, true);
        return h(`span${c.right ? '.r' : ''}${shown.empty ? '.e' : ''}` as 'span', { style, title: raw }, shown.text);
      });
      out.push(h(`div.grow${i === s.pinned ? '.sel' : ''}` as 'div', {
        style: top, role: 'row', 'aria-selected': String(i === s.pinned),
        onclick: () => this.store.pin(i),
      }, cells));
    }
    this.bodyEl.replaceChildren(...out);
  }

  private renderProfile() {
    const { ds } = this.store.s;
    const id = this.profileCol;
    const rows: number[] = [];
    for (const v of this.list) if (v >= 0) rows.push(v);
    const label = id === '#' ? 'row number' : id === 'dt' ? 'Δ prev' : ds.columns[id].key;
    const parts: (HTMLElement | null)[] = [h('h2.h', {}, 'Column profile · ', h('span.plain.mono', {}, label))];

    if (id === '#' || id === 'dt' || ds.columns[id].kind === 'number' || ds.columns[id].role === 'time') {
      const src = id === '#' ? null : id === 'dt' ? this.store.s.track.dtPrev : this.numeric(id);
      const vals: number[] = [];
      let empty = 0;
      for (const r of rows) {
        const x = src ? src[r] : r + 1;
        if (Number.isNaN(x)) empty++; else vals.push(x);
      }
      vals.sort((a, b) => a - b);
      const fmt = (x: number) => !Number.isFinite(x) ? '—' : id === 'dt' ? fmtDuration(x) : (id !== '#' && ds.columns[id as number].role === 'time') ? `${fmtDay(x)} ${fmtHM(x)}` : round(x, 4);
      const min = vals[0], max = vals[vals.length - 1];
      const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
      const distinct = new Set(vals).size;
      const bins = new Array(24).fill(0);
      for (const x of vals) bins[Math.min(23, Math.floor(((x - min) / (max - min || 1)) * 24))]++;
      const peak = Math.max(1, ...bins);
      parts.push(
        h('div.hist', { 'aria-hidden': 'true' }, bins.map((b) => h('span', { style: `height:${Math.max(2, (b / peak) * 64)}px` }))),
        h('dl.pgrid', {}, [['min', fmt(min)], ['max', fmt(max)], ['median', fmt(vals[Math.floor(vals.length / 2)])], ['mean', id === '#' ? '—' : fmt(mean)], ['empty', fmtInt(empty)], ['distinct', fmtInt(distinct)]]
          .map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v)))),
      );
    } else {
      const counts = new Map<string, number>();
      let empty = 0;
      for (const r of rows) {
        const v = ds.rows[r].values[id];
        if (v.trim() === '') { empty++; continue; }
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8);
      parts.push(
        h('dl.pgrid', {}, [['distinct', fmtInt(counts.size)], ['empty', fmtInt(empty)]].map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v)))),
        top.length ? h('div.top-values', {}, top.map(([v, n]) => h('div', {}, h('span', {}, v), h('span.muted', {}, fmtInt(n))))) : null,
      );
    }
    parts.push(h('p.note', {}, `Over the ${fmtInt(rows.length)} rows shown. Click any column header to profile it.`));
    this.profile.replaceChildren(...parts.filter(Boolean) as HTMLElement[]);
  }

  private exportView() {
    const { ds } = this.store.s;
    const q = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [ds.columns.map((c) => q(c.key)).join(',')];
    for (const v of this.list) if (v >= 0) lines.push(ds.rows[v].values.map(q).join(','));
    const base = ds.name.replace(/\.[^.]+$/, '');
    download(`${base}-view.csv`, lines.join('\n') + '\n');
    toast(`Exported ${fmtInt(lines.length - 1)} rows with their stored values`);
  }
}
