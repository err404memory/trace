type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;
type Child = Node | string | number | null | undefined | false | Child[];

/** Small element builder: h('button.btn', { onclick }, 'Label'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K | `${K}.${string}`, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name) as HTMLElementTagNameMap[K];
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = [el.className, String(v)].filter(Boolean).join(' ');
    else if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el: Element, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

const ICONS: Record<string, string> = {
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
  upload: '<path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/>',
};

export function icon(name: keyof typeof ICONS | string): SVGSVGElement {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
  return wrap.firstChild as SVGSVGElement;
}

export function logo(): SVGSVGElement {
  const wrap = document.createElement('span');
  wrap.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F2A541" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="6" r="2.5"/><path d="M7 16.5C10 14 9 9 12 8s4 0 5-1" stroke-dasharray="2 3"/></svg>';
  return wrap.firstChild as SVGSVGElement;
}

export function toast(message: string, ms = 2600) {
  const el = h('div.toast', { role: 'status' }, message);
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}

export function download(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
