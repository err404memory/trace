import './styles.css';
import { buildDataset, needsMapping, parseText } from './data/dataset';
import { forgetLast, loadLast, saveLast, takeSharedFile } from './storage';
import { importView } from './ui/importView';
import { askMapping } from './ui/mappingDialog';
import { shell } from './ui/shell';
import { toast } from './ui/dom';

const root = document.getElementById('app')!;

async function openText(name: string, text: string, remember = true) {
  const raw = parseText(name, text);
  if (!raw.rows.length) {
    await showImport(raw.issues[0]?.message ?? `No rows found in ${name}.`);
    return;
  }
  const missing = needsMapping(raw);
  let overrides = {};
  if (missing.length) {
    const picked = await askMapping(raw, missing);
    if (picked) overrides = picked;
  }
  const ds = buildDataset(name, raw, overrides);
  root.replaceChildren(shell(ds, openFile));
  if (remember) void saveLast({ name, text, openedAt: Date.now(), rows: ds.rows.length });
}

async function openFile(file: File) {
  try {
    await openText(file.name, await file.text());
  } catch (e) {
    await showImport(`Couldn’t open ${file.name}: ${(e as Error).message}`);
  }
}

async function showImport(error?: string) {
  const last = await loadLast();
  root.replaceChildren(importView({
    onFile: openFile,
    last,
    error,
    onReopen: () => { if (last) void openText(last.name, last.text, false); },
    onForget: async () => { await forgetLast(); toast('Forgotten on this device'); void showImport(); },
  }));
}

async function start() {
  // Shared from another app (Android share sheet → service worker → cache).
  if (new URLSearchParams(location.search).has('shared')) {
    history.replaceState(null, '', location.pathname);
    const shared = await takeSharedFile();
    if (shared) return openText(shared.name, shared.text);
  }
  // "Open with Trace" on desktop.
  const lq = (window as unknown as { launchQueue?: { setConsumer: (fn: (p: { files: FileSystemFileHandle[] }) => void) => void } }).launchQueue;
  if (lq) {
    lq.setConsumer(async (params) => {
      const handle = params.files[0];
      if (handle) void openFile(await handle.getFile());
    });
  }
  await showImport();
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support unavailable */ });
}

void start();
