/* global L */
// Time slider / route replay.
//
// While replay is on, each visible dataset that has dates and times is drawn
// "as of" the slider time: the points reached so far, the route up to that
// moment and a pulsing head marker interpolated between points. Datasets with
// no dates stay on the map as normal.

import { markerSvg, anchorFor } from './icons.js';
import { formatDateTime } from './dates.js';

const SLIDER_STEPS = 1000;

/**
 * @param {object} ctx
 * @param {L.Map} ctx.map
 * @param {() => Array} ctx.getDatasets
 * @param {Map} ctx.layers  dataset id -> { group, markers }
 * @param {(msg: string) => void} ctx.announce
 */
export function createReplay({ map, getDatasets, layers, announce }) {
  const bar = document.getElementById('replay-bar');
  const btn = document.getElementById('btn-replay');
  const playBtn = document.getElementById('rp-play');
  const slider = document.getElementById('rp-slider');
  const timeOut = document.getElementById('rp-time');
  const speedSel = document.getElementById('rp-speed');
  const trailSel = document.getElementById('rp-trail');
  const followChk = document.getElementById('rp-follow');
  const prevBtn = document.getElementById('rp-prev');
  const nextBtn = document.getElementById('rp-next');
  const startOut = document.getElementById('rp-start');
  const endOut = document.getElementById('rp-end');

  const state = {
    active: false,
    playing: false,
    t: 0,
    min: 0,
    max: 0,
    tracks: [],      // [{ ds, pts: [{i, lat, lon, t}], shown: Set, line, casing, head, group }]
    events: [],      // sorted unique times across all tracks, for step buttons
    raf: 0,
    lastFrame: 0,
    lastFollow: 0,
  };

  // ------------------------------------------------------------- building

  function timedTracks() {
    return getDatasets()
      .filter((ds) => ds.visible)
      .map((ds) => ({
        ds,
        pts: ds.points
          .map((p, i) => ({ i, lat: p.lat, lon: p.lon, t: p.t }))
          .filter((p) => p.t !== null && p.t !== undefined)
          .sort((a, b) => a.t - b.t || a.i - b.i),
      }))
      .filter((tr) => tr.pts.length > 0);
  }

  function hasTimedData() {
    return getDatasets().some((ds) => ds.points.some((p) => p.t !== null && p.t !== undefined));
  }

  function clearTracks() {
    for (const tr of state.tracks) {
      map.removeLayer(tr.group);
      for (const m of tr.shown.values()) map.removeLayer(m);
    }
    state.tracks = [];
  }

  function build() {
    clearTracks();
    const tracks = timedTracks();
    const replayIds = new Set(tracks.map((t) => t.ds.id));

    // Normal layers: hide those being replayed, show the rest as usual
    for (const ds of getDatasets()) {
      const l = layers.get(ds.id);
      if (!l) continue;
      if (replayIds.has(ds.id) || !ds.visible) map.removeLayer(l.group);
      else l.group.addTo(map);
    }

    state.tracks = tracks.map((tr) => {
      const st = tr.ds.style;
      const group = L.layerGroup().addTo(map);
      const dash = st.lineStyle === 'dashed' ? '10 8' : st.lineStyle === 'dotted' ? '2 7' : null;
      const casing = L.polyline([], { pane: 'tracks', color: '#fff', weight: 7, opacity: 0.8, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(group);
      const line = L.polyline([], { pane: 'tracks', color: st.color, weight: 4, opacity: 1, dashArray: dash, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(group);
      const size = Math.round(st.size * 1.35);
      const head = L.marker([tr.pts[0].lat, tr.pts[0].lon], {
        icon: L.divIcon({
          className: 'dm-head',
          html: `<span class="dm-head-ring" style="--c:${st.color}"></span>${markerSvg({ shape: st.shape, color: st.color, size })}`,
          iconSize: [size, size],
          iconAnchor: anchorFor(st.shape, size),
        }),
        keyboard: false,
        interactive: false,
        zIndexOffset: 1000,
      }).addTo(group);
      return { ...tr, group, line, casing, head, shown: new Map() };
    });

    const times = tracks.flatMap((t) => t.pts.map((p) => p.t));
    state.min = times.length ? Math.min(...times) : 0;
    state.max = times.length ? Math.max(...times) : 0;
    state.events = [...new Set(times)].sort((a, b) => a - b);
    state.t = Math.min(Math.max(state.t, state.min), state.max);
    startOut.textContent = times.length ? formatDateTime(state.min) : '';
    endOut.textContent = times.length ? formatDateTime(state.max) : '';
    slider.disabled = !times.length || state.min === state.max;
    playBtn.disabled = slider.disabled;
    draw();
  }

  // ------------------------------------------------------------- drawing

  function trailWindow() {
    const v = trailSel.value;
    return v === 'all' ? Infinity : Number(v) * 60000;
  }

  function draw() {
    const t = state.t;
    const from = t - trailWindow();
    const followPts = [];

    for (const tr of state.tracks) {
      const { pts } = tr;
      const l = layers.get(tr.ds.id);
      // Index of the last point at or before t
      let k = upperBound(pts, t) - 1;
      const path = [];
      const want = new Set();
      for (let j = 0; j <= k; j++) {
        if (pts[j].t >= from) { path.push([pts[j].lat, pts[j].lon]); want.add(pts[j].i); }
      }

      // Interpolated head position
      let head = null;
      if (k >= 0 && k < pts.length - 1) {
        const a = pts[k], b = pts[k + 1];
        const f = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
        head = [a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f];
        if (path.length) path.push(head);
        else if (from > a.t) {
          // Trail window starts part-way along this segment
          const g = Math.max(0, (from - a.t) / (b.t - a.t));
          path.push([a.lat + (b.lat - a.lat) * g, a.lon + (b.lon - a.lon) * g], head);
        }
      } else if (k === pts.length - 1) {
        head = [pts[k].lat, pts[k].lon];
      }

      tr.line.setLatLngs(path);
      tr.casing.setLatLngs(path);
      if (head) {
        tr.head.setLatLng(head);
        if (!tr.group.hasLayer(tr.head)) tr.group.addLayer(tr.head);
        followPts.push(head);
      } else if (tr.group.hasLayer(tr.head)) {
        tr.group.removeLayer(tr.head); // not started yet
      }

      // Show reached point markers (these keep their normal popups)
      if (l) {
        for (const [i, m] of tr.shown) if (!want.has(i)) { map.removeLayer(m); tr.shown.delete(i); }
        for (const i of want) {
          const m = l.markers.get(i);
          if (m && !tr.shown.has(i)) { map.addLayer(m); tr.shown.set(i, m); }
        }
      }
    }

    // Slider + readout
    const span = state.max - state.min;
    slider.value = span ? Math.round(((t - state.min) / span) * SLIDER_STEPS) : 0;
    const label = state.tracks.length ? formatDateTime(t) : 'No dated points to replay';
    timeOut.textContent = label;
    slider.setAttribute('aria-valuetext', label);
    bar.style.setProperty('--progress', `${span ? ((t - state.min) / span) * 100 : 0}%`);

    if (followChk.checked && followPts.length && state.playing) {
      const now = performance.now();
      if (now - state.lastFollow > 400) {
        state.lastFollow = now;
        const b = L.latLngBounds(followPts);
        const view = map.getBounds().pad(-0.15);
        if (!view.contains(b)) {
          if (followPts.length === 1) map.panTo(followPts[0], { animate: true, duration: 0.4 });
          else map.fitBounds(b, { padding: [80, 80], maxZoom: map.getZoom(), animate: true });
        }
      }
    }
  }

  function upperBound(pts, t) {
    let lo = 0, hi = pts.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid].t <= t) lo = mid + 1; else hi = mid; }
    return lo;
  }

  // ------------------------------------------------------------- playback

  /** Data milliseconds per real second. */
  function speed() {
    const v = speedSel.value;
    if (v.startsWith('auto')) {
      const seconds = Number(v.split(':')[1]);
      return Math.max(1, (state.max - state.min) / seconds);
    }
    return Number(v);
  }

  function frame(now) {
    if (!state.playing) return;
    const dt = Math.min(now - state.lastFrame, 100) / 1000;
    state.lastFrame = now;
    state.t = Math.min(state.max, state.t + dt * speed());
    draw();
    if (state.t >= state.max) { pause(); announce('Replay finished'); return; }
    state.raf = requestAnimationFrame(frame);
  }

  function play() {
    if (!state.tracks.length || state.min === state.max) return;
    if (state.t >= state.max) state.t = state.min;
    state.playing = true;
    state.lastFrame = performance.now();
    setPlayButton();
    state.raf = requestAnimationFrame(frame);
  }

  function pause() {
    state.playing = false;
    cancelAnimationFrame(state.raf);
    setPlayButton();
  }

  function setPlayButton() {
    playBtn.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
    playBtn.querySelector('.rp-icon-play').hidden = state.playing;
    playBtn.querySelector('.rp-icon-pause').hidden = !state.playing;
  }

  function seek(t) {
    state.t = Math.min(Math.max(t, state.min), state.max);
    draw();
  }

  function step(dir) {
    pause();
    const ev = state.events;
    if (!ev.length) return;
    let target;
    if (dir > 0) target = ev.find((x) => x > state.t + 0.5) ?? state.max;
    else target = [...ev].reverse().find((x) => x < state.t - 0.5) ?? state.min;
    seek(target);
    announce(formatDateTime(state.t));
  }

  // ------------------------------------------------------------- open / close

  function open() {
    if (!hasTimedData()) { announce('None of the datasets have dates and times to replay.'); return false; }
    state.active = true;
    bar.hidden = false;
    btn.setAttribute('aria-pressed', 'true');
    document.body.classList.add('is-replaying');
    map.closePopup();
    state.t = -Infinity;
    build();
    seek(state.min);
    playBtn.focus();
    announce('Replay mode. Press play, or use the slider to move through time.');
    return true;
  }

  function close() {
    pause();
    clearTracks();
    state.active = false;
    bar.hidden = true;
    btn.setAttribute('aria-pressed', 'false');
    document.body.classList.remove('is-replaying');
    for (const ds of getDatasets()) {
      const l = layers.get(ds.id);
      if (l && ds.visible) l.group.addTo(map);
    }
    announce('Replay closed. All points shown.');
    btn.focus();
  }

  /** Call whenever datasets are added, removed, restyled or toggled. */
  function refresh() {
    btn.disabled = !hasTimedData();
    if (!state.active) return;
    if (!hasTimedData()) { close(); return; }
    const wasPlaying = state.playing;
    pause();
    build();
    if (wasPlaying) play();
  }

  // ------------------------------------------------------------- events

  btn.addEventListener('click', () => (state.active ? close() : open()));
  document.getElementById('rp-close').addEventListener('click', close);
  playBtn.addEventListener('click', () => (state.playing ? pause() : play()));
  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
  slider.addEventListener('input', () => {
    pause();
    seek(state.min + (Number(slider.value) / SLIDER_STEPS) * (state.max - state.min));
  });
  trailSel.addEventListener('change', draw);
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    // Space on the slider toggles play, like a media player
    if (e.key === ' ' && e.target === slider) { e.preventDefault(); state.playing ? pause() : play(); }
  });

  return {
    open, close, refresh, pause, seek,
    get active() { return state.active; },
    get range() { return { min: state.min, max: state.max }; },
    /** Datasets currently being replayed (visible ones with dates). */
    get datasets() { return state.tracks.map((t) => t.ds); },
    hasTimedData,
    /** Current positions of the moving markers: [{ ds, latlng }]. */
    heads() {
      return state.tracks.filter((tr) => tr.group.hasLayer(tr.head)).map((tr) => ({
        ds: tr.ds,
        latlng: tr.head.getLatLng(),
        done: state.t >= tr.pts[tr.pts.length - 1].t, // reached its last point
      }));
    },
    setTrail(v) { trailSel.value = v; draw(); },
    get trail() { return trailSel.value; },
  };
}
