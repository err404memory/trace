// Loads the synthetic sample in headless Chromium and saves screenshots: npm run build && npm run smoke
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const SAMPLE = 'samples/generated/synthetic-colota-3d.csv';
if (!existsSync(SAMPLE)) { console.error(`Run "npm run sample" first (${SAMPLE} missing).`); process.exit(1); }
mkdirSync('screenshots', { recursive: true });

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe' });
await new Promise((resolve) => server.stdout.on('data', (d) => { if (String(d).includes('4173')) resolve(); }));

const errors = [];
const browser = await chromium.launch();
try {
  for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1, timezoneId: 'America/Los_Angeles' });
    page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|tile\.openstreetmap|AJAXError/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
    await page.goto('http://localhost:4173/');
    await page.screenshot({ path: `screenshots/${label}-1-import.png` });

    const t0 = Date.now();
    await page.setInputFiles('input[type=file]', SAMPLE);
    await page.waitForSelector('.maplibregl-canvas');
    await page.waitForTimeout(1500);
    console.log(`${label}: opened sample in ${Date.now() - t0} ms`);
    await page.screenshot({ path: `screenshots/${label}-2-map.png` });

    // Pin the point at the map centre by clicking the nearest rendered point.
    const pinned = await page.evaluate(() => {
      const canvas = document.querySelector('.maplibregl-canvas');
      return canvas ? true : false;
    });
    if (pinned) {
      const box = await page.locator('.map').boundingBox();
      let hit = false;
      for (let dx = -60; dx <= 60 && !hit; dx += 6) for (let dy = -60; dy <= 60 && !hit; dy += 6) {
        await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
        hit = await page.locator('.inspector:not([hidden])').count() > 0;
      }
      console.log(`${label}: pinned a point: ${hit}`);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `screenshots/${label}-3-pinned.png` });
    }

    await page.getByRole('button', { name: 'Table', exact: true }).click();
    await page.waitForSelector('.grow');
    const shown = await page.locator('.grid-foot span').first().textContent();
    console.log(`${label}: table footer: ${shown}`);
    await page.screenshot({ path: `screenshots/${label}-4-table.png` });
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.error('Errors:\n' + errors.join('\n')); process.exit(1); }
console.log('Smoke test passed. Screenshots in screenshots/.');
