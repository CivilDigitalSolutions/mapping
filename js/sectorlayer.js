/* global L */
// Cell site sectors as map shapes. Used by the main map and by replay, so a
// sector looks the same wherever it is drawn. (The PDF and video exports then
// draw these same shapes; see drawOverlays in capture.js.)

import { MAX_SECTORS, cellSectors, sectorOutline } from './cellsites.js';

// SVG (not canvas) so a sector only catches clicks where it is drawn, and never blocks the lines above it
let renderer = null;

/** The look of a sector for a dataset. Exports read this too, so a hovered sector never exports bold. */
export function sectorStyle(ds) {
  return { pane: 'dmSectors', className: 'dm-sector', color: ds.style.color, weight: 1.5, opacity: 0.9, fillColor: ds.style.color, fillOpacity: 0.22 };
}

/**
 * Add a shape for each cell site row that has an azimuth to `group`.
 * `mask` leaves out points the filter hides. `onClick(pointIndex)` makes sectors clickable.
 * Returns { count, missing, capped }.
 */
export function addSectors(ds, group, mask, onClick = null) {
  renderer = renderer || L.svg({ pane: 'dmSectors', padding: 0.5 });
  const { sectors, missing } = cellSectors(ds, mask);
  const shown = sectors.slice(0, MAX_SECTORS);
  const base = sectorStyle(ds);
  for (const s of shown) {
    const poly = L.polygon(sectorOutline(s.lat, s.lon, s.az, s.beam, s.radius), { ...base, renderer, interactive: !!onClick, bubblingMouseEvents: false });
    poly.dmStyle = base;
    if (onClick) {
      poly.on('mouseover', () => poly.setStyle({ fillOpacity: 0.45, weight: 2.5 }));
      poly.on('mouseout', () => poly.setStyle(base));
      poly.on('click', () => onClick(s.i));
    }
    poly.addTo(group);
  }
  return { count: shown.length, missing, capped: sectors.length > shown.length };
}
