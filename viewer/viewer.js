/* global L */
// The viewer inside an interactive map file saved from Data Mapper.
// Everything it needs is in the file: Leaflet, this script and the data.
// Only the map background is fetched from the internet.
(function () {
  'use strict';

  const D = JSON.parse(document.getElementById('dm-data').textContent);
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------------------------------------------------------- times
  const fmt = (o) => { try { return new Intl.DateTimeFormat(undefined, { ...o, timeZone: D.tz }); } catch { return new Intl.DateTimeFormat(undefined, o); } };
  const dtf = fmt({ dateStyle: 'medium', timeStyle: 'long' });
  const fmtTime = (t) => (t == null ? '' : dtf.format(new Date(t)));

  // ---------------------------------------------------------------- map
  const map = L.map('map', { zoomControl: true, keyboard: true, worldCopyJump: true, preferCanvas: false });
  const bases = {};
  D.basemaps.forEach((b) => { bases[b.id] = L.tileLayer(b.url, b.options); });
  let base = bases[D.basemap] || bases[D.basemaps[0].id];
  base.addTo(map);
  L.control.scale({ imperial: true, metric: true }).addTo(map);

  const canvas = L.canvas({ padding: 0.3 });
  map.createPane('dmLines').style.zIndex = 410;

  const iconCache = new Map();
  function iconFor(ds, colour, n) {
    const len = n == null ? 0 : String(n).length;
    const key = `${ds.k}|${colour}|${n ?? ''}`;
    let ic = iconCache.get(key);
    if (!ic) {
      const tpl = ds.icons[colour] && ds.icons[colour][len];
      const html = len ? tpl.replace(`>${'0'.repeat(len)}</text>`, `>${n}</text>`) : tpl;
      ic = L.divIcon({ className: 'v-marker', html, iconSize: [ds.size, ds.size], iconAnchor: ds.anchor, popupAnchor: [0, -ds.anchor[1] + 2] });
      iconCache.set(key, ic);
    }
    return ic;
  }

  function popupHtml(ds, i) {
    const p = ds.pts[i];
    const pos = ds.pos.get(i);
    const rows = [];
    if (p[2] != null) rows.push(['Date &amp; time', esc(fmtTime(p[2]))]);
    rows.push(['Coordinates', `<span class="v-mono">${p[0].toFixed(6)}, ${p[1].toFixed(6)}</span>`]);
    const vals = ds.vals[i] || [];
    ds.fields.forEach((f, k) => { if (vals[k] !== '' && vals[k] != null) rows.push([esc(f), esc(vals[k])]); });
    const title = p[3] || (pos != null ? `Point ${pos + 1}` : 'Point');
    return `<div class="v-pop"><h3>${esc(title)}</h3><p class="v-sub">${esc(ds.name)}${pos != null ? ` · ${pos + 1} of ${ds.order.length}` : ''}</p><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></div>`;
  }

  // ---------------------------------------------------------------- datasets
  const MANY = 3000; // above this, markers are drawn as simple dots on a canvas for speed
  D.datasets.forEach((ds, k) => {
    ds.k = k;
    ds.pos = new Map(ds.order.map((i, n) => [i, n]));
    const group = L.featureGroup();
    const colourOf = (i) => (ds.colours ? ds.colours[ds.pts[i][4]] : ds.color);
    const ll = (i) => [ds.pts[i][0], ds.pts[i][1]];
    if (ds.showLine && ds.order.length > 1) {
      const pts = ds.order.map(ll);
      L.polyline(pts, { pane: 'dmLines', color: '#fff', weight: 6, opacity: 0.75, interactive: false }).addTo(group);
      if (!ds.colours) {
        L.polyline(pts, { pane: 'dmLines', color: ds.color, weight: 3, opacity: 0.95, dashArray: ds.dash, interactive: false }).addTo(group);
      } else {
        // One line per run of legs with the same colour (a leg takes the colour of the point it arrives at)
        let run = [pts[0]], c = colourOf(ds.order[1]);
        const flush = () => L.polyline(run, { pane: 'dmLines', color: c, weight: 3.5, opacity: 1, dashArray: ds.dash, interactive: false }).addTo(group);
        for (let n = 1; n < pts.length; n++) {
          const cn = colourOf(ds.order[n]);
          if (cn !== c) { flush(); run = [pts[n - 1]]; c = cn; }
          run.push(pts[n]);
        }
        flush();
      }
    }
    const many = ds.pts.length > MANY;
    ds.pts.forEach((p, i) => {
      const pos = ds.pos.get(i);
      const title = `${ds.name}: ${p[3] || (pos != null ? `point ${pos + 1}` : 'point')}${p[2] != null ? `, ${fmtTime(p[2])}` : ''}`;
      const m = many
        ? L.circleMarker(ll(i), { renderer: canvas, radius: 4, color: '#fff', weight: 1, fillColor: colourOf(i), fillOpacity: 1 })
        : L.marker(ll(i), { icon: iconFor(ds, colourOf(i), ds.numbered && pos != null ? pos + 1 : null), title, alt: title, keyboard: ds.pts.length <= 300, riseOnHover: true });
      m.bindPopup(() => popupHtml(ds, i), { maxWidth: 320 });
      m.addTo(group);
    });
    ds.group = group;
    ds.visible = true;
    group.addTo(map);
  });

  function fitAll() {
    const b = L.latLngBounds([]);
    D.datasets.forEach((ds) => { if (ds.visible) ds.pts.forEach((p) => b.extend([p[0], p[1]])); });
    if (b.isValid()) map.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
  }
  if (D.view) map.setView(D.view.center, D.view.zoom); else fitAll();
  if (!map._loaded) map.setView([20, 0], 2);

  // ---------------------------------------------------------------- side panel
  $('#v-title').textContent = D.title || 'Map';
  document.title = D.title || 'Map';
  $('#v-meta').textContent = `Saved ${fmtTime(D.saved)}. Times are shown in ${D.tz.replace(/_/g, ' ')} time.${D.filterText ? ` Filtered to: ${D.filterText}.` : ''}`;
  if (D.logo) $('#v-brand').innerHTML = `<img src="${esc(D.logo)}" alt="${esc(D.org || 'Logo')}">`;
  if (D.org) $('#v-org').textContent = D.org;
  const sel = $('#v-base');
  sel.innerHTML = D.basemaps.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');
  sel.value = D.basemap;
  sel.addEventListener('change', () => { map.removeLayer(base); base = bases[sel.value]; base.addTo(map); });

  $('#v-list').innerHTML = D.datasets.map((ds, k) => {
    const icon = ds.icons[ds.color] ? ds.icons[ds.color][0] : Object.values(ds.icons)[0][0];
    const scale = ds.scale ? `<div class="v-scale"><span class="v-scale-title">${esc(ds.scale.title)}</span><span class="v-scale-bar" style="background:${ds.scale.css}"></span><span class="v-scale-ends"><span>${esc(ds.scale.min)}</span><span>${esc(ds.scale.max)}</span></span></div>` : '';
    return `<li class="v-ds">
      <label class="v-ds-row"><input type="checkbox" checked data-ds="${k}"><span class="v-ds-icon" aria-hidden="true">${icon.replace(/width="\d+" height="\d+"/, 'width="20" height="20"')}</span><span class="v-ds-name">${esc(ds.name)}</span></label>
      <div class="v-ds-meta">${ds.pts.length.toLocaleString()} point${ds.pts.length === 1 ? '' : 's'}${ds.range ? ` · ${esc(fmtTime(ds.range[0]))} – ${esc(fmtTime(ds.range[1]))}` : ''}</div>
      ${scale}
      <div class="v-ds-actions"><button type="button" class="v-btn v-btn-sm" data-zoom="${k}">Zoom to</button><button type="button" class="v-btn v-btn-sm" data-table="${k}">Table</button></div>
    </li>`;
  }).join('');
  $('#v-list').addEventListener('change', (e) => {
    const ds = D.datasets[Number(e.target.dataset.ds)];
    if (!ds) return;
    ds.visible = e.target.checked;
    if (replayOn && timed.includes(ds)) drawReplay(); else if (ds.visible) ds.group.addTo(map); else map.removeLayer(ds.group);
  });
  $('#v-list').addEventListener('click', (e) => {
    const z = e.target.closest('[data-zoom]');
    if (z) {
      const ds = D.datasets[Number(z.dataset.zoom)];
      const b = L.latLngBounds(ds.pts.map((p) => [p[0], p[1]]));
      if (b.isValid()) map.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
      closePanelOnSmall();
    }
    const t = e.target.closest('[data-table]');
    if (t) openTable(D.datasets[Number(t.dataset.table)]);
  });
  $('#v-fit').addEventListener('click', fitAll);
  const panel = $('#v-panel');
  $('#v-toggle').addEventListener('click', () => {
    const open = panel.classList.toggle('is-open');
    $('#v-toggle').setAttribute('aria-expanded', String(open));
  });
  $('#v-close').addEventListener('click', () => { panel.classList.remove('is-open'); $('#v-toggle').setAttribute('aria-expanded', 'false'); $('#v-toggle').focus(); });
  function closePanelOnSmall() {
    if (matchMedia('(max-width: 720px)').matches) { panel.classList.remove('is-open'); $('#v-toggle').setAttribute('aria-expanded', 'false'); }
  }

  // ---------------------------------------------------------------- table
  const TABLE_LIMIT = 2000;
  function openTable(ds) {
    const dlg = $('#v-table-dlg');
    $('#v-table-title').textContent = `${ds.name}: ${ds.pts.length.toLocaleString()} points`;
    const idx = [...ds.order, ...ds.untimed];
    const rows = idx.slice(0, TABLE_LIMIT).map((i) => {
      const p = ds.pts[i];
      const pos = ds.pos.get(i);
      return `<tr><td>${pos != null ? pos + 1 : '–'}</td><td>${esc(p[3])}</td><td>${esc(fmtTime(p[2]))}</td><td class="v-mono">${p[0].toFixed(6)}</td><td class="v-mono">${p[1].toFixed(6)}</td>${ds.fields.map((f, k) => `<td>${esc((ds.vals[i] || [])[k])}</td>`).join('')}<td><button type="button" class="v-btn v-btn-sm" data-show="${i}">Show</button></td></tr>`;
    }).join('');
    const table = $('#v-table');
    table.innerHTML = `<caption class="v-sr">Points in ${esc(ds.name)}</caption><thead><tr><th scope="col">#</th><th scope="col">Name</th><th scope="col">Date &amp; time</th><th scope="col">Latitude</th><th scope="col">Longitude</th>${ds.fields.map((f) => `<th scope="col">${esc(f)}</th>`).join('')}<th scope="col"><span class="v-sr">Actions</span></th></tr></thead><tbody>${rows}</tbody>${idx.length > TABLE_LIMIT ? `<tfoot><tr><td colspan="${ds.fields.length + 6}">Showing the first ${TABLE_LIMIT.toLocaleString()} points.</td></tr></tfoot>` : ''}`;
    table.onclick = (e) => {
      const b = e.target.closest('[data-show]');
      if (!b) return;
      const i = Number(b.dataset.show);
      dlg.close();
      if (replayOn) stopReplay();
      if (!ds.visible) { ds.visible = true; $(`[data-ds="${ds.k}"]`).checked = true; ds.group.addTo(map); }
      const p = ds.pts[i];
      map.setView([p[0], p[1]], Math.max(map.getZoom(), 15));
      L.popup({ maxWidth: 320 }).setLatLng([p[0], p[1]]).setContent(popupHtml(ds, i)).openOn(map);
      closePanelOnSmall();
    };
    dlg.showModal();
  }
  $('#v-table-close').addEventListener('click', () => $('#v-table-dlg').close());

  // ---------------------------------------------------------------- replay
  const timed = D.datasets.filter((ds) => ds.track.length > 1);
  let replayOn = false, playing = false, t = 0, last = 0, raf = 0;
  const tMin = Math.min(...timed.map((ds) => ds.pts[ds.track[0]][2]));
  const tMax = Math.max(...timed.map((ds) => ds.pts[ds.track[ds.track.length - 1]][2]));
  const replayLayer = L.layerGroup();
  if (!timed.length || !(tMax > tMin)) {
    $('#v-replay-open').hidden = true;
  }

  function positionAt(ds, time) {
    const tr = ds.track, P = ds.pts;
    if (time < P[tr[0]][2]) return null;
    let lo = 0, hi = tr.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (P[tr[mid]][2] <= time) lo = mid; else hi = mid - 1; }
    const a = P[tr[lo]];
    if (lo === tr.length - 1) return { k: lo, ll: [a[0], a[1]] };
    const b = P[tr[lo + 1]];
    const s = b[2] > a[2] ? (time - a[2]) / (b[2] - a[2]) : 0;
    return { k: lo, ll: [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s] };
  }

  function drawReplay() {
    replayLayer.clearLayers();
    timed.forEach((ds) => {
      if (!ds.visible) return;
      const at = positionAt(ds, t);
      if (!at) return;
      const pts = ds.track.slice(0, at.k + 1).map((i) => [ds.pts[i][0], ds.pts[i][1]]);
      pts.push(at.ll);
      L.polyline(pts, { pane: 'dmLines', color: '#fff', weight: 6, opacity: 0.75, interactive: false }).addTo(replayLayer);
      L.polyline(pts, { pane: 'dmLines', color: ds.color, weight: 3.5, interactive: false }).addTo(replayLayer);
      L.marker(at.ll, { icon: iconFor(ds, ds.color, null), interactive: false, keyboard: false }).addTo(replayLayer);
    });
    $('#v-clock').textContent = fmtTime(t);
    $('#v-slider').value = String(Math.round(((t - tMin) / (tMax - tMin)) * 1000));
    $('#v-slider').setAttribute('aria-valuetext', fmtTime(t));
  }

  function startReplay() {
    replayOn = true;
    // Moving datasets are replayed; ones without times stay on the map as they are
    timed.forEach((ds) => map.removeLayer(ds.group));
    map.closePopup();
    replayLayer.addTo(map);
    $('#v-replay').hidden = false;
    $('#v-replay-open').setAttribute('aria-pressed', 'true');
    t = tMin;
    drawReplay();
    $('#v-play').focus();
  }
  function stopReplay() {
    pause();
    replayOn = false;
    map.removeLayer(replayLayer);
    D.datasets.forEach((ds) => { if (ds.visible) ds.group.addTo(map); });
    $('#v-replay').hidden = true;
    $('#v-replay-open').setAttribute('aria-pressed', 'false');
  }
  function tick(now) {
    const dur = Number($('#v-speed').value) * 1000; // whole span in this many ms
    t = Math.min(tMax, t + ((now - last) / dur) * (tMax - tMin));
    last = now;
    drawReplay();
    if (t >= tMax) { pause(); return; }
    raf = requestAnimationFrame(tick);
  }
  function play() {
    if (t >= tMax) t = tMin;
    playing = true;
    last = performance.now();
    $('#v-play').textContent = 'Pause';
    $('#v-play').setAttribute('aria-label', 'Pause');
    raf = requestAnimationFrame(tick);
  }
  function pause() {
    playing = false;
    cancelAnimationFrame(raf);
    $('#v-play').textContent = 'Play';
    $('#v-play').setAttribute('aria-label', 'Play');
  }
  $('#v-replay-open').addEventListener('click', () => (replayOn ? stopReplay() : startReplay()));
  $('#v-replay-close').addEventListener('click', () => { stopReplay(); $('#v-replay-open').focus(); });
  $('#v-play').addEventListener('click', () => (playing ? pause() : play()));
  $('#v-slider').addEventListener('input', (e) => { pause(); t = tMin + (Number(e.target.value) / 1000) * (tMax - tMin); drawReplay(); });
  document.addEventListener('keydown', (e) => {
    if (!replayOn) return;
    if (e.key === 'Escape' && !$('#v-table-dlg').open) { stopReplay(); $('#v-replay-open').focus(); }
    if (e.key === ' ' && e.target === document.body) { e.preventDefault(); playing ? pause() : play(); }
  });

  window.dmViewer = { map, data: D, startReplay, stopReplay };
}());
