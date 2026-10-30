// Renders public/icon.svg to the PNG sizes Android needs for installing: npm run icons
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Playwright is not a project dependency: use the copy installed on the machine (NODE_PATH works with require).
const { chromium } = createRequire(import.meta.url)('playwright');

const svg = readFileSync('public/icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
const shots = [
  ['public/icon-192.png', 192, 0],
  ['public/icon-512.png', 512, 0],
  // Maskable: artwork inside the 80% safe zone on a full-bleed background.
  ['public/icon-maskable-512.png', 512, 0.1],
];
for (const [file, size, pad] of shots) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - 2 * pad));
  await page.setContent(`<body style="margin:0;background:#10141A;display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body>`);
  await page.screenshot({ path: file, omitBackground: false });
  console.log(file);
}
await browser.close();
