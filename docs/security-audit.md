# Data Mapper: security and quality audit

**Date:** November 2026  
**Scope:** the whole app: every module in `js/`, `index.html`, the service worker, the interactive map file viewer (`viewer/`), the bundled libraries in `vendor/`, and the GitHub Pages deployment.  
**Method:** a line-by-line review of everywhere the app turns data into page content, reads files or talks to the network; then scripted user testing in a real browser with awkward, broken and deliberately hostile files (about 40 scenarios); then fixes, each with an automated test so it stays fixed.

## Summary

The app's design is sound for security: it has no server, no accounts and no uploads, and people's data never leaves their browser. Data read from CSV, GPX, KML and GeoJSON files was already shown safely.

The weak point was **project files**. They're the one input that sets styles directly, and their values went into the page unchecked. A crafted project file could run code in the app, or freeze it. Both are fixed, along with four lower-risk issues and six data or logic bugs.

| # | Finding | Severity | Status |
|---|---|---|---|
| S1 | A project file's marker colour could run code in the app (script injection) | **High** | Fixed |
| S2 | A project file with a bad colour froze the app completely | **High** | Fixed |
| S3 | CSV exports passed spreadsheet formulas through (CSV / formula injection) | Medium | Fixed |
| S4 | The visitor counter loaded a script from another company's server | Medium | Fixed |
| S5 | No Content Security Policy (no second line of defence against injection) | Medium | Fixed |
| S6 | Bundled PDF library (jsPDF 2.5.1) had published security advisories | Low | Fixed (4.2.1) |
| S7 | Service worker could save an error page as the offline app; kept no-CORS tiles that count as several MB each | Low | Fixed |
| D1 | Routes crossing the 180° line were drawn right round the world | Medium | Fixed |
| D2 | "Who was here?" missed visits right next to the 180° line | Medium | Fixed |
| D3 | Excel dates came out a second early (08:00 read as 07:59:59) | Medium | Fixed |
| D4 | Time columns named `ts`, `epoch`, `unix_time` and similar weren't recognised | Low | Fixed |
| D5 | CSV exports wrote the name column twice | Low | Fixed |
| D6 | Video export was offered for data with only one time, then failed | Low | Fixed |

## Security findings

### S1. Script injection through project files (High, fixed)
**What:** project files (`.json`) set each dataset's style. The marker colour was written into the page's HTML as it was. A crafted file with a colour such as `#000"><img src=x onerror=...>` ran code as soon as it was opened. That code could read every dataset stored in the browser.  
**Who could exploit it:** anyone who could get a colleague to open a project file they had prepared, for example sent by email as a "backup".  
**Fix:** every style value from a project file, or from browser storage, is checked against the values the app understands (`cleanStyle` in `js/project.js`). Anything else is replaced with a default. As a second layer, the marker drawing code (`markerSvg`) refuses anything that isn't a plain colour code.  
**Tests:** `tests/project.test.mjs`, `tests/e2e/security.test.mjs`.

### S2. A bad colour froze the app (High, fixed)
**What:** if a marker picture failed to load, the map retried drawing it endlessly, so the tab stopped responding. A bad colour in a project file was one way to cause this. Reloading didn't help, because the bad dataset was saved.  
**Fix:** colours are now checked (S1). A marker picture that can't load is drawn as a plain dot instead of being retried. Project files are also cleaned of impossible times, unknown time zones, nested values and odd field types. A damaged file now gives a plain message.

### S3. Spreadsheet formula injection in CSV exports (Medium, fixed)
**What:** a cell such as `=HYPERLINK("http://…")` in an imported file was written unchanged into exported CSVs. Excel and Google Sheets run such cells as formulas when the file is opened.  
**Fix:** in exported cells, text starting with `=`, `+`, `-`, `@`, a tab or a return gets a leading apostrophe. Real numbers, such as `-0.1278`, are left alone. This applies to the dataset CSV export and the "Who was here?" results.

### S4. Third-party script for visitor counts (Medium, fixed)
**What:** GoatCounter's `count.js` was loaded from `gc.zgo.at` on every visit. That script ran with full access to the page and the data stored in it. If that server were ever compromised, so was the app.  
**Fix:** counts are now sent as plain image requests to GoatCounter. No outside code runs in the app. Only the page path, title, screen width and the referring site (never a full address) are sent, as before.

### S5. No Content Security Policy (Medium, fixed)
**What:** nothing told the browser which scripts were allowed, so any injection bug would have been fully exploitable.  
**Fix:** `index.html` now carries a policy. Only the app's own scripts may run. Images are allowed only from the app, the three map tile services and GoatCounter. Plugins, base-URL changes and form posts elsewhere are blocked. Saved interactive map files carry a stricter policy of their own, which also stops them sending data anywhere. The tests confirm an injected script is refused.  
**Note:** GitHub Pages can't send security headers, so protection against being framed by another site (`frame-ancestors`) can't be set. The risk is low, because the app has no logged-in actions to trick someone into. If you move to your own hosting, also send the policy and `X-Frame-Options: DENY` as headers.

### S6. Outdated PDF library (Low, fixed)
jsPDF 2.5.1 has published advisories (CVE-2025-29907 and CVE-2025-57810: slowdowns or crashes caused by crafted images). In this app the only images given to jsPDF are its own map picture and the user's own logo, so the real risk was small. It's now upgraded to **jsPDF 4.2.1** with **AutoTable 5.0.9**, and all PDF tests pass.

Other libraries: Leaflet 1.9.4 (current, no known advisories), PapaParse 5.4.1 (no known advisories), mp4-muxer 5.2.2 (no known advisories). All are bundled in `vendor/`, not loaded from outside servers.

### S7. Service worker caching (Low, fixed)
- The service worker saved *any* page it fetched as the offline copy of the app, so a 404 from a mistyped address could replace it. Now only a good copy of the app's own page is saved.
- Map tiles fetched without CORS ("opaque") were kept. Chrome counts each one as several MB of storage, which could crowd out saved datasets. These are no longer kept. The app requests tiles with CORS, so normal tiles are unaffected.
- Tile hosts are now matched exactly, not by the end of the name.

### Checked and found safe
- **Imported files** (CSV, GPX, KML, GeoJSON, pasted text): every name, column and value is escaped before being shown. Tested with markup and `<script>` in names, column headings and values.
- **Links in data:** only `http(s)://` values become links. They're escaped, and open in a new tab without access back to the app.
- **Interactive map file:** the data is stored as escaped JSON, so it can't break out of its `<script>` block. Its popups and tables are escaped, and its own security policy blocks outside requests.
- **XML files** are read with the browser's own parser, which doesn't fetch outside entities.
- **Filenames** for downloads are cleaned.
- **Prototype pollution:** a column named `__proto__` can't change how objects behave (tested).
- **Privacy:** no data is ever sent anywhere. The only outside requests are map tiles (which reveal the map area being viewed to the tile service) and the anonymous visit counter.

## Data and logic findings (from user testing)

- **D1. Date line:** a route from 179.9° to -179.9° (about 20 km) was drawn right round the world. It now crosses the line the short way, on the map, in replay and in saved map files.
- **D2. "Who was here?" at the date line:** places either side of 180° were treated as 360° apart. Fixed, with a unit test.
- **D3. Excel dates:** Excel stores times as fractions of a day, and rounding turned 08:00 into 07:59:59. Times are now rounded to the nearest second.
- **D4. Time column names:** Unix-time columns named `ts`, `epoch`, `epoch_ms`, `unix_time`, `posix_time` and similar are now recognised automatically. Before, people had to choose them by hand.
- **D5. Duplicate name column:** CSV exports wrote `name` twice when the name came from a column called "name". If a data column clashes with a built-in heading, it's now labelled "(original)".
- **D6. One-time data:** the Export dialog offered a video for data with only one time, then failed. It now explains that a video needs at least two different times.

### Behaviour checked and working as intended
- **Empty files and header-only files** give a clear message.
- **Points outside the world** (latitude 95) are skipped and listed.
- **0,0 GPS fixes** are flagged as GPS jumps.
- **Semicolon-separated files with decimal commas and a byte-order mark** (common European Excel exports) import correctly.
- **Unsorted and duplicate times** are handled.
- **A time that doesn't exist** (01:30 on the night the clocks go forward) is moved forward an hour, as is standard.
- **Editing in the table:** a point edited out of the filter's range disappears from the table, with Undo. Impossible coordinates are refused with a message.
- **Removing every dataset** with replay and "Who was here?" open leaves nothing broken.
- **Saving survives an immediate reload.**
- **50,000 points:** "Who was here?" takes 0.09 s, a table search 0.3 s and sorting 0.14 s. The interactive map file is 4.7 MB.

## Recommendations (not done)
1. **If you move off GitHub Pages**, send the Content-Security-Policy and `X-Frame-Options: DENY` as real headers.
2. **Keep the bundled libraries current.** Check `vendor/` for advisories about twice a year. The browser tests will show if an upgrade breaks anything.
3. **Treat project files from outside like email attachments.** They're now checked thoroughly, but anyone opening them should still trust who sent them.
4. **Very large exports:** an interactive map file grows by about 1 MB per 10,000 points. Above roughly 100,000 points, filter first.
