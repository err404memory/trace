import maplibregl, { type GeoJSONSource, type MapLayerMouseEvent, type MapLayerTouchEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Store, State } from './store';
import { h } from './dom';
import { colorExpression, colorOfRow, scaleFor } from './colors';
import { circleRing } from '../data/geo';
import { motionOf } from '../data/derive';
import { fmtClock, fmtDuration, round } from '../data/format';

type FC = GeoJSON.FeatureCollection;
const EMPTY: FC = { type: 'FeatureCollection', features: [] };

/** OpenStreetMap raster tiles, darkened in the renderer. Swappable later in settings. */
const BASEMAP = {
  tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
  attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
};

export class MapView {
  el: HTMLElement;
  private map: maplibregl.Map;
  private tip: HTMLElement;
  private labels: maplibregl.Marker[] = [];
  private ready = false;
  private lastPointer: string = 'mouse';
  private lastTap = { i: -1, at: 0 };

  constructor(private store: Store) {
    const mapEl = h('div.map');
    this.tip = h('div.tip', { hidden: true });
    this.el = h('div.map-wrap', { role: 'region', 'aria-label': 'Map' }, mapEl, this.tip, legend());

    this.map = new maplibregl.Map({
      container: mapEl,
      style: {
        version: 8,
        sources: { osm: { type: 'raster', tiles: BASEMAP.tiles, tileSize: 256, maxzoom: 19, attribution: BASEMAP.attribution } },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#10141A' } },
          {
            id: 'osm', type: 'raster', source: 'osm',
            // Invert brightness and pull colour down: a quiet dark basemap.
            paint: { 'raster-brightness-min': 0.92, 'raster-brightness-max': 0.06, 'raster-saturation': -0.85, 'raster-contrast': 0.05, 'raster-hue-rotate': 190, 'raster-opacity': 0.9 },
          },
        ],
      },
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      maxZoom: 20,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
    mapEl.addEventListener('pointerdown', (e) => { this.lastPointer = e.pointerType; }, { capture: true });

    this.map.on('load', () => {
      this.addLayers();
      this.ready = true;
      this.refreshAll();
      this.fit();
    });

    store.on((changed) => {
      if (!this.ready) return;
      if (changed.has('track') || changed.has('win') || changed.has('daysOn')) this.refreshData();
      if (changed.has('colorBy') || changed.has('win')) this.refreshColors();
      if (changed.has('layers')) this.refreshLayers();
      if (changed.has('pinned')) this.refreshPin(true);
      if (changed.has('daysOn')) this.fit();
      if (changed.has('view') && store.s.view === 'map') this.map.resize();
    });
  }

  resize() { this.map.resize(); }

  fit() {
    const { ds } = this.store.s;
    let w = 180, s = 90, e = -180, n = -90, any = false;
    for (const i of this.store.s.track.seq) {
      if (!this.store.inWindow(i)) continue;
      const lat = ds.lat[i], lon = ds.lon[i];
      if (lon < w) w = lon; if (lon > e) e = lon; if (lat < s) s = lat; if (lat > n) n = lat;
      any = true;
    }
    if (any) this.map.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 16, duration: 0 });
  }

  private addLayers() {
    const m = this.map;
    for (const id of ['points', 'paths', 'inferred', 'stays', 'pin']) m.addSource(id, { type: 'geojson', data: EMPTY });

    m.addLayer({ id: 'stays-fill', type: 'fill', source: 'stays', paint: { 'fill-color': '#AEB9C7', 'fill-opacity': 0.07 } });
    m.addLayer({ id: 'stays-line', type: 'line', source: 'stays', paint: { 'line-color': '#AEB9C7', 'line-opacity': 0.4, 'line-width': 1.2, 'line-dasharray': [3, 3] } });
    m.addLayer({
      id: 'accuracy', type: 'circle', source: 'points',
      paint: { 'circle-color': '#5CC2A0', 'circle-opacity': 0.1, 'circle-radius': 0 },
    });
    m.addLayer({
      id: 'inferred', type: 'line', source: 'inferred',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#AEB9C7', 'line-opacity': 0.65, 'line-width': 2.5, 'line-dasharray': [0.5, 2.5] },
    });
    m.addLayer({
      id: 'paths-casing', type: 'line', source: 'paths',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#0D1015', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 7] },
    });
    m.addLayer({
      id: 'paths', type: 'line', source: 'paths',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#C8D1DC', 'line-opacity': 0.8, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 16, 3.2] },
    });
    m.addLayer({
      id: 'points', type: 'circle', source: 'points',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 1, 13, 2.2, 16, 4.5, 19, 7],
        'circle-stroke-color': '#10141A',
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 0, 15, 1.5],
        'circle-color': '#5CC2A0',
      },
    });
    m.addLayer({ id: 'pin-halo', type: 'circle', source: 'pin', paint: { 'circle-radius': 17, 'circle-color': '#FFFFFF', 'circle-opacity': 0.12, 'circle-stroke-color': '#FFFFFF', 'circle-stroke-opacity': 0.4, 'circle-stroke-width': 1 } });
    m.addLayer({ id: 'pin', type: 'circle', source: 'pin', paint: { 'circle-radius': 7, 'circle-color': ['get', 'c'], 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2.5 } });

    m.on('mousemove', 'points', (e) => this.onHover(e));
    m.on('mouseleave', 'points', () => { if (this.lastPointer === 'mouse') this.hideTip(); m.getCanvas().style.cursor = ''; });
    m.on('click', 'points', (e) => this.onClick(e));
    m.on('click', (e) => {
      // Clicking empty map hides the touch preview (pins stay until Esc / ✕).
      if (!m.queryRenderedFeatures(e.point, { layers: ['points'] }).length) this.hideTip();
    });
    // Double-tap on a point pins it instead of zooming.
    m.on('dblclick', 'points', (e: MapLayerMouseEvent | MapLayerTouchEvent) => { e.preventDefault(); });
    m.on('move', () => { if (this.tipRow >= 0) this.placeTip(this.tipRow); });
  }

  private tipRow = -1;

  private rowAt(e: MapLayerMouseEvent): number {
    const f = e.features?.[0];
    return f ? Number(f.properties?.i) : -1;
  }

  private onHover(e: MapLayerMouseEvent) {
    if (this.lastPointer !== 'mouse') return;
    this.map.getCanvas().style.cursor = 'pointer';
    const i = this.rowAt(e);
    if (i >= 0) this.showTip(i, 'Click to pin');
  }

  private onClick(e: MapLayerMouseEvent) {
    const i = this.rowAt(e);
    if (i < 0) return;
    if (this.lastPointer === 'mouse') {
      this.store.pin(i);
      this.hideTip();
      return;
    }
    // Touch: first tap previews, a second tap on the same point (double-tap) pins.
    const now = performance.now();
    if (this.lastTap.i === i && now - this.lastTap.at < 450) {
      this.store.pin(i);
      this.hideTip();
      this.lastTap = { i: -1, at: 0 };
    } else {
      this.showTip(i, 'Double-tap to pin');
      this.lastTap = { i, at: now };
    }
  }

  private showTip(i: number, hint: string) {
    const s = this.store.s;
    const { ds } = s;
    const sc = scaleFor(s);
    const parts: string[] = [];
    const mo = motionOf(ds.spd[i]);
    if (mo) parts.push(mo[0].toUpperCase() + mo.slice(1));
    if (Number.isFinite(ds.spd[i])) parts.push(`${round(ds.spd[i], 1)} m/s`);
    if (Number.isFinite(ds.acc[i])) parts.push(`±${round(ds.acc[i], 0)} m`);
    const st = s.track.stayOf[i];
    this.tip.replaceChildren(...[
      h('div.t', {}, h('span.dot', { style: `background:${colorOfRow(s, sc, i)}` }), fmtClock(ds.t[i])),
      h('div', {}, parts.join(' · ') || 'No speed or accuracy recorded'),
      st >= 0 ? h('div', {}, `In a stay of ${fmtDuration(s.track.stays[st].t1 - s.track.stays[st].t0)}`) : null,
      h('div.hint', {}, hint),
    ].filter((x): x is HTMLDivElement => x !== null));
    this.tip.hidden = false;
    this.tipRow = i;
    this.placeTip(i);
  }

  private placeTip(i: number) {
    const { ds } = this.store.s;
    const p = this.map.project([ds.lon[i], ds.lat[i]]);
    const w = this.tip.offsetWidth, hgt = this.tip.offsetHeight;
    const W = this.el.clientWidth;
    const x = Math.min(Math.max(8, p.x - w / 2), W - w - 8);
    const y = p.y - hgt - 14 < 8 ? p.y + 14 : p.y - hgt - 14;
    this.tip.style.left = `${x}px`;
    this.tip.style.top = `${y}px`;
  }

  private hideTip() {
    this.tip.hidden = true;
    this.tipRow = -1;
  }

  private refreshAll() {
    this.refreshData();
    this.refreshColors();
    this.refreshLayers();
    this.refreshPin(false);
  }

  private refreshData() {
    const s = this.store.s;
    const { ds, track } = s;
    const pts: GeoJSON.Feature[] = [];
    const lines: GeoJSON.Feature[] = [];
    let cur: [number, number][] = [];
    const flush = () => { if (cur.length > 1) lines.push(line(cur)); cur = []; };
    // MapLibre's GeoJSON source needs plain numbers; NaN properties are left out.
    for (const i of track.seq) {
      if (!this.store.inWindow(i)) { flush(); continue; }
      const props: Record<string, number> = { i, t: ds.t[i] };
      if (Number.isFinite(ds.spd[i])) props.spd = ds.spd[i];
      if (Number.isFinite(ds.acc[i])) props.acc = ds.acc[i];
      if (Number.isFinite(ds.bat[i])) props.bat = ds.bat[i];
      pts.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [ds.lon[i], ds.lat[i]] }, properties: props });
      if (track.gapBefore[i] >= 0) flush();
      cur.push([ds.lon[i], ds.lat[i]]);
    }
    flush();
    const inferred = track.gaps
      .filter((g) => this.store.inWindow(g.from) && this.store.inWindow(g.to))
      .map((g) => line([[ds.lon[g.from], ds.lat[g.from]], [ds.lon[g.to], ds.lat[g.to]]]));
    const stays = track.stays.filter((st) => st.t1 >= s.win[0] && st.t0 <= s.win[1]);

    (this.map.getSource('points') as GeoJSONSource).setData({ type: 'FeatureCollection', features: pts });
    (this.map.getSource('paths') as GeoJSONSource).setData({ type: 'FeatureCollection', features: lines });
    (this.map.getSource('inferred') as GeoJSONSource).setData({ type: 'FeatureCollection', features: inferred });
    (this.map.getSource('stays') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: stays.map((st) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [circleRing(st.lat, st.lon, st.radius)] }, properties: {} })),
    });

    this.labels.forEach((m) => m.remove());
    this.labels = stays.map((st) => {
      const el = h('div.stay-label', {}, `Stay · ${fmtDuration(st.t1 - st.t0)}`);
      const top = circleRing(st.lat, st.lon, st.radius, 4)[3];
      return new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, 4] }).setLngLat([st.lon, top[1]]).addTo(this.map);
    });
    this.updateAccuracyRadius();
    this.hideTip();
  }

  private updateAccuracyRadius() {
    // Accuracy circles drawn to scale: metres → pixels at each zoom.
    const lat = this.map.getCenter().lat;
    const mpp0 = 156543.03392 * Math.cos((lat * Math.PI) / 180);
    this.map.setPaintProperty('accuracy', 'circle-radius', [
      'interpolate', ['exponential', 2], ['zoom'],
      0, ['/', ['coalesce', ['get', 'acc'], 0], mpp0],
      22, ['/', ['coalesce', ['get', 'acc'], 0], mpp0 / 2 ** 22],
    ]);
  }

  private refreshColors() {
    const sc = scaleFor(this.store.s);
    this.map.setPaintProperty('points', 'circle-color', colorExpression(sc));
    this.map.setPaintProperty('accuracy', 'circle-color', colorExpression(sc));
    this.refreshPin(false);
  }

  private refreshLayers() {
    const L = this.store.s.layers;
    const vis = (ids: string[], on: boolean) => ids.forEach((id) => this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
    vis(['points'], L.points);
    vis(['paths', 'paths-casing'], L.paths);
    vis(['inferred'], L.inferred);
    vis(['accuracy'], L.accuracy);
    vis(['stays-fill', 'stays-line'], L.stays);
    this.labels.forEach((m) => { m.getElement().style.display = L.stays ? '' : 'none'; });
  }

  private refreshPin(pan: boolean) {
    const s: State = this.store.s;
    const i = s.pinned;
    const src = this.map.getSource('pin') as GeoJSONSource | undefined;
    if (!src) return;
    if (i < 0 || !Number.isFinite(s.ds.lat[i])) { src.setData(EMPTY); return; }
    const c = colorOfRow(s, scaleFor(s), i);
    const lngLat: [number, number] = [s.ds.lon[i], s.ds.lat[i]];
    src.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: lngLat }, properties: { c } }] });
    if (pan) {
      // Pan only when the point is near the edge or off screen.
      const p = this.map.project(lngLat);
      const W = this.el.clientWidth, H = this.el.clientHeight;
      if (p.x < W * 0.15 || p.x > W * 0.85 || p.y < H * 0.15 || p.y > H * 0.85) this.map.easeTo({ center: lngLat, duration: 400 });
    }
  }
}

function line(coords: [number, number][]): GeoJSON.Feature {
  return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} };
}

function legend(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'map-legend';
  wrap.innerHTML = `
    <span><svg width="26" height="8" aria-hidden="true"><path d="M2 4H24" stroke="#C8D1DC" stroke-width="3" stroke-linecap="round"/></svg>Recorded</span>
    <span><svg width="26" height="8" aria-hidden="true"><path d="M2 4H24" stroke="#AEB9C7" stroke-opacity=".75" stroke-width="2.5" stroke-dasharray="1.5 6" stroke-linecap="round"/></svg>Inferred across a gap</span>
    <span><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="#AEB9C7" fill-opacity=".08" stroke="#AEB9C7" stroke-opacity=".5" stroke-dasharray="2 2"/></svg>Stay</span>`;
  return wrap;
}
