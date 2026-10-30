# Trace

Open a location export and explore every point on a map, in a table and over
time. Runs entirely on your device: files are read in the browser and never
uploaded.

**Status:** phase 1 (open + see everything) and most of phase 2 (stays, gaps,
timeline). See [SPEC.md](SPEC.md) for the full plan.

## What works now

- Reads **Colota CSV** (recognised automatically), any CSV with latitude /
  longitude / time columns (or you pick them), **GeoJSON**, **GPX** and **KML**.
- **Lossless:** every row and cell is kept exactly as stored. Rows without a
  usable position stay in the table and are counted. Readable values (±8.95 m,
  local times) always show the stored text alongside when they differ.
- **Map:** dark basemap, recorded paths, dashed inferred segments across gaps,
  stays with durations, points coloured by time / speed / accuracy / battery,
  accuracy circles to scale. Hover for a preview, click to pin (touch: tap to
  preview, double-tap to pin). Esc unpins.
- **Inspector:** every column, readable + stored, plus a clearly separated
  "Derived by Trace" block (time and distance to neighbours, gaps, motion
  estimated from speed, stay membership). Copy row as JSON.
- **Table:** virtual scrolling over tens of thousands of rows, sort by any
  column (shift-click for a second sort), search every cell, Readable / As
  stored, gap marker rows, column profiles, export the current view as CSV.
- **Timeline:** histogram of rows; drag to choose a time window. Days list.
- **PWA:** installable, works offline after the first visit, Android
  "Share to Trace", desktop "Open with", remembers the last file on the device.

## Develop

```bash
npm install
npm run sample      # writes samples/generated/synthetic-colota-3d.csv (made-up places)
npm run dev         # http://localhost:5173
npm test            # unit tests (parsers, lossless round trip, gaps, stays, formatting)
npm run build
npm run smoke       # needs Playwright on the machine; loads the sample, saves screenshots/
```

Real exports are git-ignored (`*.csv`, `*.geojson`, `*.gpx`, `*.kml`,
`exports/`). Don't commit location data.

## Hosting (Cloudflare)

The site is a Cloudflare Worker that serves `dist/` as static assets
(`wrangler.jsonc`), at **https://trace.ghostyashes.com**. Cloudflare Workers
Builds deploys it on every push to `main`.

One-time setup in the Cloudflare dashboard:

1. **Workers & Pages → Create → Import a repository**, connect GitHub and pick
   `err404memory/trace`.
2. Project name **`trace`** (must match `name` in `wrangler.jsonc`).
   Build command **`npm run build`**, deploy command **`npx wrangler deploy`**
   (the default). Root directory: `/`.
3. Save and deploy. The `routes` entry in `wrangler.jsonc` creates the DNS
   record and HTTPS certificate for `trace.ghostyashes.com` automatically.

Manual deploy from a computer instead: `npx wrangler login`, then `npm run deploy`.

`public/_headers` keeps the service worker uncached (so updates arrive) and
caches the hashed build files for a year. Source maps are not published.

### Optional: Cloudflare Access

Access keeps the site itself private. (Your location files are never sent to
the server either way: they are read on the device.) In the Cloudflare
dashboard: **Zero Trust → Access → Applications → Add an application →
Self-hosted**:

- Domain: `trace.ghostyashes.com`
- Session duration: **1 month**, so the installed app rarely asks you to sign in
- Policy: **Allow**, Include → **Emails** → your address
- Login method: One-time PIN (on by default), or add GitHub/Google

The app is already set up for it: the manifest is fetched with credentials so
installing works, the service worker never caches the sign-in redirect, and
there are no `workers.dev` or preview URLs that would bypass it. When the
session expires the app opens the sign-in page once, then carries on; offline,
the cached copy keeps working.

## Install on Android

Open https://trace.ghostyashes.com in Chrome → menu → **Install app**. After
that, Trace appears in the share sheet for CSV, GeoJSON, GPX and KML files.

## Basemap

Tiles come from openstreetmap.org, darkened in the renderer. That's fine for
personal use under the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/);
a setting to use another tile server is planned.
