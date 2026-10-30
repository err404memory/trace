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

## Install on Android

The app must be served over HTTPS to install. Any static host works (the
`dist/` folder after `npm run build`). Note: GitHub Pages from a private repo
needs a paid GitHub plan; Cloudflare Pages and Netlify host private repos on
their free tiers. Then open the site in Chrome → menu → **Install app**.

## Basemap

Tiles come from openstreetmap.org, darkened in the renderer. That's fine for
personal use under the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/);
a setting to use another tile server is planned.
