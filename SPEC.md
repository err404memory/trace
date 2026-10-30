# Trace — build spec

Trace is an installable web app (PWA) that opens a location export and turns it
into a map, a table and a time-lapse, without losing any of the data and
without sending it anywhere.

Design canvas: the "Trace — Location Export Viewer" artifact (private to the owner).

## 1. Principles

1. **Lossless.** Every row and every field in the file can be seen as it was
   stored. Rows that can't be placed on the map (no usable coordinates) still
   appear in the table and are counted. Readable formatting is for display
   only; the stored text is always one tap away.
2. **On the device.** Files are read in the browser. Nothing is uploaded. The
   only network traffic is basemap tiles and, if the user turns it on, their
   own local model server.
3. **Recorded vs inferred.** Anything Trace works out itself (gaps, stays,
   motion, inferred paths, cleaned positions) is labelled as derived and never
   overwrites the recorded values.
4. **Quiet by default.** Dark, low-chroma basemap. Colour is used for data:
   time of day, speed, accuracy or battery.

## 2. Input formats

| Format | Read as rows from | Columns |
|---|---|---|
| CSV | each data line | header names, as written |
| GeoJSON | each `Point` feature (other geometries are counted and listed as skipped-from-map, still in the table) | `longitude`, `latitude`, `altitude` (from coordinates) + every property |
| GPX | `trkpt`, `rtept`, `wpt` | `lat`, `lon`, `ele`, `time`, any child element, and `extensions` children as `ext:<name>` |
| KML | `Placemark/Point`, `gx:Track` (`when` + `gx:coord`) | `longitude`, `latitude`, `altitude`, `when`, `name`, `description`, `ExtendedData` fields |

**Column roles** are detected from names (case-insensitive):
- latitude: `latitude`, `lat`
- longitude: `longitude`, `lon`, `lng`, `long`
- time: `iso_time`, `time`, `timestamp`, `datetime`, `date`, `recorded_at`, `when`; epoch numbers
  in seconds or milliseconds are recognised by size
- accuracy: `accuracy`, `horizontal_accuracy`, `hacc`
- speed (m/s), bearing (degrees), altitude (m), battery (0–1 or 0–100), plus the status columns

If latitude, longitude or time can't be detected, the user picks them in a
mapping dialog.

**Colota CSV** is recognised by its header
(`id,timestamp,iso_time,latitude,longitude,accuracy,altitude,speed,bearing,battery,battery_status,note`).
In this format, `bearing = 0` at speed under 0.3 m/s is treated as "unknown".

## 3. Data model

- `Dataset`: name, format, source (e.g. `Colota`), columns, rows (file order),
  issues (parse problems with line numbers), plus typed arrays indexed by row:
  `t` (epoch ms or NaN), `lat`, `lon`, `acc`, `spd`, `brg`, `alt`, `bat`.
- `Row`: index in file, source line, `values: string[]` — the exact text of
  each cell (JSON text for non-string GeoJSON values).
- `order`: row indices sorted by time; rows without a time are kept, last.

## 4. Derived values (all labelled "Derived by Trace")

- **Δ previous**: time and distance (haversine) to the previous row in time order.
- **Gap**: consecutive rows further apart in time than the gap threshold.
  Default: `max(60 s, 6 × median interval)`; adjustable from 10 s to 15 min.
  Across a gap the path is drawn dashed and labelled "inferred".
- **Stay**: a run of rows that stays within 50 m of its running centroid for
  at least 5 min. The centroid is weighted by `1/accuracy²`. Shown as a dashed
  circle with its duration. Defaults are adjustable.
- **Motion** (from speed): stationary < 0.3 m/s, walking < 2.5, running/cycling < 7,
  vehicle above that. Shown as an estimate, never as a recorded value.

## 5. Views

### Map (desktop: rail · map · inspector; phone: map + bottom sheet)
- Recorded paths are solid; inferred paths across gaps are dashed.
- Points are coloured by time (default), speed, accuracy or battery. Every point
  is drawn individually from street zoom (z14+); below that, paths and stays carry
  the picture.
- Accuracy circles drawn to scale in metres.
- **Hover** (mouse): tooltip with time, motion, speed, accuracy.
  **Click**: pin → inspector. **Touch**: tap previews, double-tap pins
  (double-tap on a point does not zoom). Esc or ✕ unpins.
- Inspector: local time, coordinates, a "Derived by Trace" block, and every
  column: readable value + "stored as" when they differ. Prev/next in time order.
  Copy row as JSON. "Show in table".
- Layers: points, recorded paths, inferred paths, accuracy, stays.
- Days in file (local dates) with checkboxes; timeline histogram with a
  draggable window.

### Table
- Virtual scrolling; all columns plus `#` (file order) and `Δ prev`.
- Click a header to sort; shift-click to add a secondary sort.
- Search across every cell; Readable / As stored toggle.
- When sorted by time, gap marker rows are inserted (labelled as Trace's, not data).
- Column profile for the selected column: min, max, median, mean, empty, distinct.
- Export the current view as CSV with the stored values.

## 6. Cleanup (phase 3)

- Stays collapse to their weighted centroid for drawing; rows are kept.
- Moving stretches: Kalman filter (constant velocity) with measurement noise from
  `accuracy`, using `speed`/`bearing` when valid, plus a backward
  (Rauch–Tung–Striebel) pass.
- Outliers (implied speed impossible given reported speed) are flagged, not removed.
- **Hard rule:** a cleaned point is never further from its raw position than that
  row's accuracy. If the smoother wants more, the point is flagged instead.
- Raw / cleaned / both views; per-point "moved X m · within ±Y m"; summary of
  median shift, max shift, flagged count.
- Optional: road matching for vehicle stretches via a self-hosted routing server.

## 7. Find a moment (phase 4)

- Phone-only: chrono-node parses times ("10:45am last Wednesday"). Trace always
  shows how it read the question. Nearest row by binary search; the answer
  says whether it is recorded (row within the gap threshold) or between rows.
- **Local AI (optional):** any OpenAI-compatible server (Ollama, LM Studio,
  llama.cpp). The model receives only: the question, today's date and time zone,
  column names, the file's date range and the user's place labels. It returns a
  query plan validated against a fixed schema; Trace runs it locally.

  ```json
  {"op": "at_time", "time": "2026-10-28T10:45:00-07:00"}
  {"op": "range", "from": "…", "to": "…"}
  {"op": "stays", "range": {…}, "sort": "duration_desc", "limit": 5}
  {"op": "rows_where", "where": [{"col": "speed", "gt": 22.2}], "range": {…}}
  {"op": "visits", "near": {"lat": 0, "lon": 0, "radius_m": 100}}
  ```
  Invalid plan → one retry → fall back to phone-only parsing.
  Connection test: HTTPS reachable, CORS, `/v1/models`, valid plan, round trip.

## 8. Time-lapse (phase 5)

- Pacing: each segment gets playback share
  `w = s · distance/Σdistance + (1 − s) · √duration/Σ√duration`, where `s` is the
  Clock-true ↔ Story slider.
- Encodings use real time, not playback time: tail = last 3 real minutes;
  line width ∝ time per metre; stay glow area ∝ time spent; daylight tint from
  sun position.
- The real clock and its current speed-up (×N) are always shown. Accordion
  timeline shows real vs playback time.
- Camera follows, zooming out with speed. Save as video (MediaRecorder).

## 9. PWA

- Manifest with icons, `share_target` (Android "Share to Trace") and
  `file_handlers` (desktop "Open with").
- Service worker caches the app shell; the last opened file is kept in
  IndexedDB on the device so it reopens without picking it again.

## 10. Phases and acceptance

1. **Open + see everything** — parsers, dataset, map, inspector, table, PWA shell.
   Accepted when: a Colota CSV opens; row count in the app equals data lines in
   the file; every cell's stored text is visible; sort and search work on 40k rows.
2. **Read the day** — time colouring, stays, gaps, inferred paths, timeline window, days.
3. **Cleanup** — §6, with its tests for the hard rule.
4. **Find a moment** — §7.
5. **Time-lapse** — §8.

## 11. Testing

- Unit tests (Vitest) for parsers, role detection, the lossless guarantee,
  gaps, stays and formatting.
- `npm run sample` generates a synthetic Colota-format file (made-up locations)
  for development. Real exports are git-ignored and never committed.
- `npm run smoke` loads the sample in headless Chromium and saves screenshots.
