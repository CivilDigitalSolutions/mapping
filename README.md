# Data Mapper

A progressive web app (PWA) for putting coordinate data on a map. Upload CSV files or paste rows straight from a spreadsheet. Each dataset gets its own marker shape and colour. Points with dates and times are joined in time order so you can see the route that was taken.

**It costs nothing to run.** The map uses [Leaflet](https://leafletjs.com) (open source) with OpenStreetMap, OpenTopoMap and Esri imagery tiles. There's no API key, no account and no billing. Google Maps is not used.

## Features

- **Import:** CSV, TSV and TXT files, text pasted from Excel or Google Sheets, plus GeoJSON, GPX and KML. You can import several files at once, and each one becomes its own dataset. Files can be dragged onto the page, and you can paste anywhere on the map with Ctrl/Cmd+V.
- **Automatic column detection** with a review step that shows a live preview of what will be mapped and which rows will be skipped, with the reason for each.
- **Coordinate formats:** decimal degrees, N/S/E/W letters, degrees-minutes-seconds (`51°30'26"N`), degrees and decimal minutes (`51 30.43N`), separate latitude/longitude columns or one combined column (`"51.5, -0.12"`), and WKT `POINT(lon lat)`.
- **Date/time formats:** ISO 8601, `DD/MM/YYYY` or `MM/DD/YYYY` (detected automatically, and you can change it), month names, 12- or 24-hour times, separate date and time columns, Unix timestamps and Excel date numbers.
- **Per-dataset styling:** 9 marker shapes (circle, square, triangle, diamond, star, hexagon, cross, waypoint pin, flag), a colour-blind-friendly palette or any custom colour, and marker size.
- **Time-ordered tracks:** points are joined by date/time (or file order) with solid, dashed or dotted lines, direction arrows and optional sequence numbers on the markers.
- **Point details:** date and time, coordinates (with a copy button), and the distance and time since the previous point, plus every other column from the row. *Previous* and *Next* buttons step along the track.
- **Table view** for each dataset, as an accessible alternative to the map. **Export** each dataset as GeoJSON or CSV.
- **Private:** data stays in the browser (IndexedDB) and survives reloads. Nothing is uploaded to a server.
- **Works offline** once installed. Map tiles you've already viewed are cached.
- **Accessible:** keyboard operable (Tab between markers, Enter opens one), screen-reader labels and announcements, visible focus, shapes as well as colours to tell datasets apart, dark mode, reduced-motion support and a mobile layout.

## Running it

It's a static site with no build step. Any web server works.

```bash
npm start            # or: python3 -m http.server 8080
# open http://localhost:8080
```

> Opening `index.html` directly from disk (`file://`) won't work. Browsers only allow ES modules and service workers over http(s), or on `localhost`.

### Hosting for your organisation

Copy the folder to any static host: GitHub Pages, Netlify, Azure Static Web Apps, an S3 bucket, or an internal IIS or nginx server. It must be served over **HTTPS** for the app to be installable. Once it's open in Chrome or Edge, use *Install app* in the address bar. On iOS, use *Share → Add to Home Screen*.

When you change any app file, bump `VERSION` in `sw.js` so installed copies pick up the update.

### Map tiles

The background layers are set in `js/config.js`. They're free, but each provider has a fair-use policy. OpenStreetMap's tile servers are meant for light use. If your organisation will use the app heavily, point `BASEMAPS` at your own tile server or a provider you have an agreement with. Only that file needs to change.

## Tests

```bash
npm test
```

These run unit tests for the coordinate and date parsers (Node 18+).

## Project layout

```
index.html            App shell and dialogs
css/app.css           Styles (light/dark, mobile)
js/app.js             Map, panel, import flow, popups, export
js/importers.js       CSV/paste parsing, column detection, GeoJSON/GPX/KML
js/coords.js          Coordinate parsing (decimal, DMS, combined, WKT)
js/dates.js           Date/time parsing and formatting
js/icons.js           SVG marker shapes and palette
js/samples.js         Built-in sample datasets
js/store.js           IndexedDB persistence
js/config.js          Map tile providers
sw.js                 Service worker (offline + tile cache)
manifest.webmanifest  PWA manifest
vendor/               Leaflet 1.9.4 and PapaParse 5.4.1 (bundled for offline use)
```
