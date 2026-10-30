import type { Store } from './store';
import { h } from './dom';
import { colorOfRow, scaleFor } from './colors';
import { fmtDay, fmtHM, fmtInt } from '../data/format';

/** Histogram of rows over the selected days, with a draggable time window. */
export class Timeline {
  el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private label: HTMLElement;
  private ticks: HTMLElement;
  private extent: [number, number] = [0, 1];
  private drag: { mode: 'new' | 'move' | 'a' | 'b'; x0: number; win0: [number, number] } | null = null;
  private raf = 0;

  constructor(private store: Store) {
    this.canvas = h('canvas', { 'aria-label': 'Rows over time. Drag to choose a time window; double-click to reset.', role: 'img' });
    this.label = h('div.row');
    this.ticks = h('div.ticks', { 'aria-hidden': 'true' });
    this.el = h('section.timeline', { 'aria-label': 'Timeline' }, this.label, this.canvas, this.ticks);

    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', () => { this.drag = null; });
    this.canvas.addEventListener('dblclick', () => this.store.set({ win: [...this.extent] as [number, number] }));
    new ResizeObserver(() => this.draw()).observe(this.canvas);
    store.on((changed) => {
      if (changed.has('daysOn') || changed.has('track')) this.computeExtent();
      if (['win', 'daysOn', 'colorBy', 'track'].some((k) => changed.has(k as never))) this.schedule();
    });
    this.computeExtent();
  }

  private computeExtent() {
    const s = this.store.s;
    let a = Infinity, b = -Infinity;
    for (const d of s.days) if (s.daysOn.has(d.key)) { a = Math.min(a, d.start); b = Math.max(b, d.end); }
    if (!Number.isFinite(a)) { this.extent = [0, 1]; return; }
    let lo = Infinity, hi = -Infinity;
    for (const i of s.track.seq) { const t = s.ds.t[i]; if (t >= a && t <= b) { lo = Math.min(lo, t); hi = Math.max(hi, t); } }
    this.extent = Number.isFinite(lo) && hi > lo ? [lo, hi] : [a, b];
  }

  private xToT(x: number): number {
    const w = this.canvas.clientWidth || 1;
    const [a, b] = this.extent;
    return a + (Math.min(Math.max(x, 0), w) / w) * (b - a);
  }
  private tToX(t: number): number {
    const [a, b] = this.extent;
    return ((t - a) / (b - a || 1)) * this.canvas.clientWidth;
  }

  private down(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    const x = e.offsetX;
    const win = this.store.s.win;
    const xa = this.tToX(win[0]), xb = this.tToX(win[1]);
    const near = e.pointerType === 'mouse' ? 6 : 14;
    const mode = Math.abs(x - xa) <= near ? 'a' : Math.abs(x - xb) <= near ? 'b' : x > xa && x < xb ? 'move' : 'new';
    this.drag = { mode, x0: x, win0: [...win] as [number, number] };
  }

  private move(e: PointerEvent) {
    const x = e.offsetX;
    if (!this.drag) {
      const win = this.store.s.win;
      const near = Math.abs(x - this.tToX(win[0])) <= 6 || Math.abs(x - this.tToX(win[1])) <= 6;
      this.canvas.style.cursor = near ? 'ew-resize' : 'crosshair';
      return;
    }
    const d = this.drag;
    const [ea, eb] = this.extent;
    const minSpan = 60_000;
    let win: [number, number];
    if (d.mode === 'move') {
      const dt = this.xToT(x) - this.xToT(d.x0);
      const span = d.win0[1] - d.win0[0];
      const a = Math.min(Math.max(d.win0[0] + dt, ea), eb - span);
      win = [a, a + span];
    } else if (d.mode === 'a') {
      win = [Math.min(this.xToT(x), d.win0[1] - minSpan), d.win0[1]];
    } else if (d.mode === 'b') {
      win = [d.win0[0], Math.max(this.xToT(x), d.win0[0] + minSpan)];
    } else {
      const t0 = this.xToT(d.x0), t1 = this.xToT(x);
      if (Math.abs(x - d.x0) < 4) return;
      win = [Math.min(t0, t1), Math.max(t0, t1)];
    }
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.store.set({ win }));
  }

  private schedule() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.draw());
  }

  draw() {
    const s = this.store.s;
    const c = this.canvas;
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const [a, b] = this.extent;
    const nb = Math.max(20, Math.floor(W / 4));
    const counts = new Array(nb).fill(0);
    const sample = new Array(nb).fill(-1);
    for (const i of s.track.seq) {
      const t = s.ds.t[i];
      if (t < a || t > b) continue;
      const k = Math.min(nb - 1, Math.floor(((t - a) / (b - a || 1)) * nb));
      counts[k]++;
      if (sample[k] < 0) sample[k] = i;
    }
    const peak = Math.max(1, ...counts);
    const sc = scaleFor(s);
    const bw = W / nb;
    const [wa, wb] = s.win;
    for (let k = 0; k < nb; k++) {
      const t = a + ((k + 0.5) / nb) * (b - a);
      const inWin = t >= wa && t <= wb;
      const hgt = counts[k] ? 4 + (counts[k] / peak) * (H - 8) : 1.5;
      g.fillStyle = counts[k] ? (inWin ? colorOfRow(s, sc, sample[k]) : '#3A4452') : '#252D38';
      g.fillRect(k * bw + 0.5, H - hgt, Math.max(1, bw - 1), hgt);
    }
    // Window
    const xa = this.tToX(wa), xb = this.tToX(wb);
    g.fillStyle = 'rgba(242,165,65,0.08)';
    g.fillRect(xa, 0, xb - xa, H);
    g.fillStyle = '#F2A541';
    g.fillRect(xa - 1, 0, 2, H);
    g.fillRect(xb - 1, 0, 2, H);

    let inWin = 0;
    for (const i of s.track.seq) if (this.store.inWindow(i)) inWin++;
    const sameDay = fmtDay(wa) === fmtDay(wb);
    this.label.replaceChildren(
      h('b', {}, `${fmtDay(wa)} ${fmtHM(wa)} – ${sameDay ? '' : fmtDay(wb) + ' '}${fmtHM(wb)}`),
      h('span.muted', {}, `${fmtInt(inWin)} rows in window`),
      h('div.spacer'),
      h('span.muted', { style: 'font-size:12px' }, 'Drag to choose a window · double-click for the whole span'),
    );

    const span = b - a;
    const hour = 3_600_000;
    const step = span <= 6 * hour ? hour : span <= 30 * hour ? 3 * hour : span <= 4 * 24 * hour ? 12 * hour : 24 * hour;
    const first = Math.ceil(a / step) * step;
    const ticks: HTMLElement[] = [];
    for (let t = first; t <= b; t += step) {
      const local = new Date(t);
      // Align to local clock hours.
      const aligned = t - local.getMinutes() * 60_000 - local.getSeconds() * 1000 - local.getMilliseconds();
      const x = (this.tToX(aligned) / W) * 100;
      if (x < 2 || x > 98) continue;
      ticks.push(h('span', { style: `left:${x}%` }, step >= 12 * hour ? `${fmtDay(aligned)} ${fmtHM(aligned)}` : fmtHM(aligned)));
    }
    this.ticks.replaceChildren(...ticks);
  }
}
