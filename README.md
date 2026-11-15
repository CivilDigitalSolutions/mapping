# Data Mapper

A progressive web app (PWA) for putting coordinate data on a map. Upload CSV files or paste rows straight from a spreadsheet. Each dataset gets its own marker shape and colour. Points with dates and times are joined in time order so you can see the route that was taken.

**It costs nothing to run.** The map uses [Leaflet](https://leafletjs.com) (open source) with OpenStreetMap, OpenTopoMap and Esri imagery tiles. There's no API key, no account and no billing. Google Maps is not used.

## Features

- **Import:** CSV, TSV and TXT files, text pasted from Excel or Google Sheets, plus GeoJSON, GPX and KML. You can import several files at once, and each one becomes its own dataset. Files can be dragged onto the page, and you can paste anywhere on the map with Ctrl/Cmd+V.
- **Automatic column detection** with a review step that shows a live preview of what will be mapped and which rows will be skipped, with the reason for each.
- **Coordinate formats:** decimal degrees, N/S/E/W letters, degrees-minutes-seconds (`51°30'26"N`), degrees and decimal minutes (`51 30.43N`), separate latitude/longitude columns or one combined column (`"51.5, -0.12"`), and WKT `POINT(lon lat)`.
- **Date/time formats:** ISO 8601, `DD/MM/YYYY` or `MM/DD/YYYY` (detected automatically, and you can change it), month names, 12- or 24-hour times, separate date and time columns, Unix timestamps and Excel date numbers.
- **Per-dataset styling:** 9 marker shapes (circle, square, triangle, diamond, star, hexagon, cross, waypoint pin, flag), a colour-blind-friendly palette or any custom colour, and marker size.
- **Split one file into many datasets:** choose a column such as Vehicle or Device when importing. Columns like these are suggested automatically, and each group becomes its own dataset with its own colour (and shape, after 10). *Show all / Hide all* in the panel helps with many datasets.
- **Colour by value:** markers and route lines can be shaded by speed (worked out from times and distances, in mph, km/h or m/s), by time, or by any numeric column. The colour-blind-friendly scale (viridis) runs from the 2nd to the 98th percentile, so one bad reading can't flatten the colours. It appears on the dataset's card and in PDF and video legends, and popups show each point's speed. During replay the moving line uses the dataset's own colour, while the markers keep their value colours.
- **Filters:** one filter for the whole map, in the Datasets panel. It can limit the date and time range, the time of day every day (e.g. 08:00–12:00, or overnight 22:00–06:00), and a rule on a column, a point's name or its calculated speed (*is*, *is not*, *contains*, *is at least*, *is at most*). The filter applies everywhere: the map, numbering, Previous/Next, replay, the table, stops and problems, PDF and video, and GeoJSON/CSV exports. Cards show "*x* of *y* points shown", PDFs say what they were filtered to, and the filter is remembered between visits.
- **Stops, gaps and GPS jumps:** found automatically for each dataset that has times. A stop is staying within 50 m for 5+ minutes. A gap is nothing recorded for 10+ minutes while moving, and at least 3 times the dataset's usual interval, so data recorded every half hour on purpose isn't flagged. A jump is a move faster than 150 mph (240 km/h), which is usually a bad GPS reading. All of these settings can be changed. On the map they're small symbols, never labelled boxes: a pause sign with the stop's length in small text, a short "//" break across the line for a gap, and a small red triangle for a jump. You can click them or Tab to them. They're summarised on the dataset's card with a full list, and included in the PDF. A jump can be removed in one click, with Undo.
- **Time-ordered tracks:** points are joined by date/time (or file order) with solid, dashed or dotted lines, direction arrows and optional sequence numbers on the markers.
- **Point details:** date and time, coordinates (with a copy button), and the distance and time since the previous point, plus every other column from the row. *Previous* and *Next* buttons step along the track.
- **Route replay:** a time slider plays the routes back. You can scrub to any moment, step from point to point, pick the speed (whole route in 15 s to 2 min, real time, or 1 min/10 min/1 hour/1 day per second), keep the whole trail or only the last 15 minutes, hour or day, and have the map follow the moving markers. Space plays and pauses, and Esc closes the replay.
- **Video export:** saves the replay as an MP4 video (WebM in Firefox), in HD or Full HD and 15 seconds to 2 minutes long. The video shows a title, a running date/time clock, a legend and a progress bar. The camera can be **fixed** (fit all the data, or the current map view) or set to **follow the route**: it glides along with one dataset's moving marker, or with all moving datasets, at close-up, medium or wide zoom. Every setting is locked when recording starts. The video draws its own map, so moving the map on screen during a recording has no effect. Recording happens in the browser and takes as long as the video itself.
- **PDF report:** a landscape A4 or US Letter report for clients, with a title, "prepared for" line and notes, a full-page map with a legend, a summary table (points, first/last time, duration, route distance, average speed), and optional tables of every point.
- **Your branding on exports:** in the Export dialog, choose a logo (PNG, JPEG, SVG or WebP; it's converted to PNG and stored at most 800 × 400) and type an organisation name. They're remembered in this browser. The logo appears top-right of the PDF's first page and the name in every page footer. In videos, both appear in the top-right corner. A **scale bar** (metric and imperial) and **north arrow** are added to the PDF map and videos; this can be turned off.
- **Replay details:** when a dataset is coloured by value, the moving route line is coloured too, in replay and in videos. While a vehicle is parked in one of its stops, a "Stopped 6m" label counts up beside it.
- **Table view** for each dataset, as an accessible alternative to the map. **Export** each dataset as GeoJSON or CSV.
- **Private:** data stays in the browser (IndexedDB) and survives reloads. Nothing is uploaded to a server.
- **Project files:** *Save project file* writes every dataset, style and time zone to one `.json` file, for backups or for moving to another computer. *Open project file* adds its datasets to the map or replaces them. The panel shows when you last backed up, how much storage the app is using out of what the browser allows (split into your data and the offline copy, in Chrome and Edge), and warns if the browser can't save. The app asks the browser to keep its data permanently, and removing a dataset can be undone.
- **Time zones:** times that state their zone (`Z`, `+01:00`, Unix timestamps) are used exactly. For other times you choose the zone when importing, and it can be corrected later per dataset (daylight saving is handled). *Show times in* displays everything in your device's zone, UTC or any other zone, and every displayed time carries its zone label, including in PDFs and videos.
- **Large datasets:** markers are drawn on a canvas, so tens of thousands of points stay smooth. With 25,000 points, adding them takes about 0.25 s and the replay runs at about 40 frames per second. When 150 or fewer markers are in view, each one also gets an invisible focusable button, so keyboard and screen-reader users can Tab between them.
- **Works offline** once installed. Map tiles you've already viewed are cached.
- **Accessible:** keyboard operable (Tab between markers, Enter opens one), screen-reader labels and announcements, visible focus, shapes as well as colours to tell datasets apart, dark mode, reduced-motion support and a mobile layout.

## Running it

It's a static site with no build step. Any web server works.

```bash
npm start            # or: python3 -m http.server 8080
# open http://localhost:8080
```

> Opening `index.html` directly from disk (`file://`) won't work. Browsers only allow ES modules and service workers over http(s), or on `localhost`.

### Publishing on GitHub Pages

`.github/workflows/pages.yml` runs the tests and publishes the site on every push to `main` (or the development branch). You can also run it by hand from the **Actions** tab. To turn it on, do this once:

1. In the repository, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Go to **Actions → Deploy to GitHub Pages → Run workflow**, or push a commit.

The app will be at `https://<org>.github.io/<repo>/`.

> GitHub Pages for a **private** repository needs a paid GitHub plan (Team or Enterprise). On those plans the published site is still public unless you have Enterprise Cloud with private Pages. Your data is never part of the site, though, because it stays in each user's browser.

### Visitor counts (GoatCounter)

The app can count visits with [GoatCounter](https://www.goatcounter.com). It's free for non-commercial use, uses no cookies (so no cookie banner is needed) and doesn't identify people. To turn it on, set `GOATCOUNTER_CODE` in `js/config.js` to your GoatCounter code, e.g. `'datamapper'` for `datamapper.goatcounter.com`. Leave it as `''` to turn counting off. Nothing is counted when running on localhost.

Besides page views, it counts these feature uses, by name only: `import-file`, `import-paste`, `sample-data`, `replay`, `export-pdf`, `export-video` and `export-video-follow`. They appear under **Events** in the GoatCounter dashboard. No coordinates, file contents or dataset names are ever sent.

### Hosting for your organisation

Copy the folder to any static host: GitHub Pages, Netlify, Azure Static Web Apps, an S3 bucket, or an internal IIS or nginx server. It must be served over **HTTPS** for the app to be installable. Once it's open in Chrome or Edge, use *Install app* in the address bar. On iOS, use *Share → Add to Home Screen*.

When you change any app file, bump `VERSION` in `sw.js` so installed copies pick up the update.

### Map tiles

The background layers are set in `js/config.js`. They're free, but each provider has a fair-use policy. OpenStreetMap's tile servers are meant for light use. If your organisation will use the app heavily, point `BASEMAPS` at your own tile server or a provider you have an agreement with. Only that file needs to change.

## Tests

```bash
npm install          # once: installs Playwright and axe-core for the browser tests
npx playwright install chromium   # once: the browser the tests drive
npm test             # unit tests: coordinate and date parsing, how the files fit together
npm run test:e2e     # browser tests: the whole app in headless Chromium (about 30 s)
npm run test:all     # both
```

The browser tests (`tests/e2e/`) cover importing every file type, splitting files, time zones, filters, stops and GPS jumps, branding (logo upload), the map, popups and keyboard access, styles and colour by value, Undo, replay, PDF and video exports, project files and storage warnings, accessibility checks (axe-core) in light and dark mode, and speed with 25,000 points. They start their own web server and use stand-in map tiles, so they never touch the internet.

GitHub runs all of these on every push and pull request. The site is only deployed when they all pass.

## Project layout

```
index.html            App shell and dialogs
css/app.css           Styles (light/dark, mobile)
js/app.js             Start-up: connects the parts and loads saved data
js/state.js           Shared data (datasets, layers, preferences) and saving
js/util.js            Small shared helpers (lookup, escaping, toasts, downloads, dialogs)
js/mapview.js         The map: drawing datasets, popups, hover, keyboard targets
js/panel.js           Datasets panel, Undo, "Keep your work safe", "Show times in"
js/import-flow.js     Add data dialog: columns, time zones, splitting, samples
js/style-controls.js  Marker/line style controls and the time zone picker
js/settings.js        A dataset's Style dialog
js/table.js           Table view and GeoJSON / CSV export
js/project-ui.js      Saving and opening project files
js/export-ui.js       Export dialog (PDF / video)
js/importers.js       CSV/paste parsing, column detection, GeoJSON/GPX/KML
js/coords.js          Coordinate parsing (decimal, DMS, combined, WKT)
js/dates.js           Date/time parsing and formatting
js/icons.js           SVG marker shapes and palette
js/replay.js          Route replay / time slider
js/pointlayer.js      Canvas marker layer (fast drawing, hit-testing, keyboard targets)
js/project.js         Project file save / open
js/colour.js          Colour by value (speed, time, columns) and colour scale
js/filters.js         Filter logic: date range, time of day, column / speed rules
js/filter-ui.js       The Filter and "Stops and problems" boxes in the panel
js/analysis.js        Finding stops, gaps in the recording and GPS jumps
js/branding-ui.js     "Your branding": logo upload and organisation name
js/scalebar.js        Scale bar maths for exported maps
js/capture.js         Draws the map onto a canvas for exports
js/exporters.js       Video recording and PDF report
js/samples.js         Built-in sample datasets
js/store.js           IndexedDB persistence
js/config.js          Map tile providers
sw.js                 Service worker (offline + tile cache)
manifest.webmanifest  PWA manifest
vendor/               Leaflet 1.9.4, PapaParse 5.4.1, jsPDF 2.5.1 + AutoTable 3.8.2 (bundled for offline use)
tests/                Unit tests (*.test.mjs) and browser tests (e2e/)
```
