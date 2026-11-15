// SVG marker shapes. Each shape is drawn in a 32x32 viewBox.
// anchor: 'center' (point sits at the middle) or 'bottom' (tip of a pin / flag pole).

export const SHAPES = {
  circle:   { label: 'Circle',   anchor: 'center', svg: (f, s) => `<circle cx="16" cy="16" r="11" ${f} ${s}/>` },
  square:   { label: 'Square',   anchor: 'center', svg: (f, s) => `<rect x="6" y="6" width="20" height="20" rx="2" ${f} ${s}/>` },
  triangle: { label: 'Triangle', anchor: 'center', svg: (f, s) => `<path d="M16 4 L28 26 H4 Z" stroke-linejoin="round" ${f} ${s}/>` },
  diamond:  { label: 'Diamond',  anchor: 'center', svg: (f, s) => `<path d="M16 3 L29 16 L16 29 L3 16 Z" stroke-linejoin="round" ${f} ${s}/>` },
  star:     { label: 'Star',     anchor: 'center', svg: (f, s) => `<path d="M16 3 L19.5 11.8 L29 12.4 L21.7 18.5 L24 27.8 L16 22.7 L8 27.8 L10.3 18.5 L3 12.4 L12.5 11.8 Z" stroke-linejoin="round" ${f} ${s}/>` },
  hexagon:  { label: 'Hexagon',  anchor: 'center', svg: (f, s) => `<path d="M16 3 L27.3 9.5 V22.5 L16 29 L4.7 22.5 V9.5 Z" stroke-linejoin="round" ${f} ${s}/>` },
  cross:    { label: 'Cross',    anchor: 'center', svg: (f, s) => `<path d="M12 4 H20 V12 H28 V20 H20 V28 H12 V20 H4 V12 H12 Z" stroke-linejoin="round" ${f} ${s}/>` },
  pin:      { label: 'Waypoint pin', anchor: 'bottom', svg: (f, s, c) => `<path d="M16 31 C16 31 5 19.5 5 12 A11 11 0 0 1 27 12 C27 19.5 16 31 16 31 Z" ${f} ${s}/><circle cx="16" cy="12" r="4.2" fill="#fff" stroke="${c}" stroke-width="0"/>` },
  flag:     { label: 'Flag',     anchor: 'bottom', svg: (f, s) => `<path d="M7 31 V3" stroke="#222" stroke-width="2.5" stroke-linecap="round"/><path d="M8 4 H27 L22 10.5 L27 17 H8 Z" stroke-linejoin="round" ${f} ${s}/>` },
};

export const SHAPE_KEYS = Object.keys(SHAPES);

// Colour-blind friendly palette (Okabe–Ito + extras), all readable with a white outline.
export const PALETTE = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#7B3294', '#1B1B1B', '#C0392B', '#2E7D32'];

/** Pick black or white text for best contrast on a hex background. */
export function contrastText(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b);
  return L > 0.4 ? '#111' : '#fff';
}

/**
 * Build the SVG markup for a marker.
 * opts: { shape, color, size, label } — label is optional short text drawn inside.
 */
export function markerSvg({ shape = 'circle', color = '#0072B2', size = 28, label = '' } = {}) {
  const def = SHAPES[shape] || SHAPES.circle;
  const fill = `fill="${color}"`;
  const stroke = 'stroke="#fff" stroke-width="2.25"';
  let text = '';
  if (label !== '' && label !== null && label !== undefined) {
    const str = String(label);
    const { x, y, fs, color: tc } = labelSpec(shape, color, str);
    text = `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-family="system-ui,sans-serif" font-weight="700" font-size="${fs}" fill="${tc}">${escapeXml(str)}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" focusable="false" style="overflow:visible;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.45))">${def.svg(fill, stroke, color)}${text}</svg>`;
}

export function anchorFor(shape, size) {
  const def = SHAPES[shape] || SHAPES.circle;
  if (def.anchor === 'bottom') {
    return shape === 'flag' ? [size * (7 / 32), size * (31 / 32)] : [size / 2, size * (31 / 32)];
  }
  return [size / 2, size / 2];
}

/** Arrow marker used to show direction of travel along a line. */
export function arrowSvg(color, angleDeg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" style="transform:rotate(${angleDeg}deg)"><path d="M8 2 L14 13 L8 10 L2 13 Z" fill="${color}" stroke="#fff" stroke-width="1.25" stroke-linejoin="round"/></svg>`;
}

function escapeXml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

/**
 * Where the sequence number sits inside a marker, in the 32×32 marker grid.
 * Shared by the SVG markers and the canvas layer so both look the same.
 */
export function labelSpec(shape, color, str) {
  const fs = (str.length >= 4 ? 8 : str.length === 3 ? 9.5 : 12) - (shape === 'flag' ? 2 : 0);
  const y = shape === 'pin' ? 12 : shape === 'flag' ? 10.5 : shape === 'triangle' ? 20 : 16;
  const x = shape === 'flag' ? 17 : 16;
  return { x, y, fs, color: shape === 'pin' ? '#111' : contrastText(color) };
}

// ------------------------------------------------------------------ canvas sprites

const SPRITE_MARGIN = 4; // room for the drop shadow
const sprites = new Map();

/**
 * A pre-drawn marker image for the canvas layer, at `dpr` device pixels per CSS pixel.
 * Returns { canvas, ready, promise, w, h, ax, ay } — sizes and anchor are in CSS pixels.
 */
export function spriteFor(shape, color, size, dpr = 1) {
  const key = `${shape}|${color}|${size}|${dpr}`;
  if (sprites.has(key)) return sprites.get(key);
  const w = size + SPRITE_MARGIN * 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.ceil(w * dpr);
  const [ax, ay] = anchorFor(shape, size);
  const entry = { canvas, ready: false, w, h: w, ax: ax + SPRITE_MARGIN, ay: ay + SPRITE_MARGIN, size };
  entry.promise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      ctx.shadowColor = 'rgba(0,0,0,.45)';
      ctx.shadowBlur = 3 * dpr;
      ctx.shadowOffsetY = 1 * dpr;
      ctx.drawImage(img, SPRITE_MARGIN * dpr, SPRITE_MARGIN * dpr, size * dpr, size * dpr);
      entry.ready = true;
      resolve(entry);
    };
    img.onerror = () => resolve(entry);
    const svg = markerSvg({ shape, color, size: size * dpr }).replace(/style="[^"]*"/, '');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  sprites.set(key, entry);
  if (sprites.size > 400) sprites.delete(sprites.keys().next().value);
  return entry;
}

// ------------------------------------------------------------------ stop / gap / jump symbols
// Small, quiet symbols that don't hide the route: no pills or boxes. Text, where
// there is any, has a thin white outline so it reads on any map. All are SVG so
// the PDF and video exports can draw them too.

const LABEL_FONT = 'system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif';
const svgOpen = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" focusable="false">`;

/** Small bold text with a white outline instead of a box behind it. */
function haloText(x, y, text, anchor = 'middle') {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${LABEL_FONT}" font-size="10.5" font-weight="700" fill="#1f2937" stroke="#fff" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${escapeXml(String(text))}</text>`;
}

/** Rough width of haloText in pixels (bold 10.5px, any system font). */
const textWidth = (s) => Math.ceil(String(s).length * 6.4) + 6;

/**
 * Symbol for a stop, a gap in the recording or a GPS jump.
 * Returns { svg, w, h, anchor: [x, y] } in CSS pixels.
 *  - stop: small dark circle with a pause sign, with an optional short duration underneath
 *  - gap:  two short slanted bars that break the route line; `angle` is the line's
 *          bearing (0 = north) so the break sits across it
 *  - jump: small red warning triangle, just above the point
 */
export function eventIcon(kind, { label = '', angle = 0 } = {}) {
  if (kind === 'gap') {
    const s = 20, c = s / 2;
    // Drawn for a line running left to right, then turned to the line's direction
    const bars = `M${c - 5} ${c + 6} L${c - 1.5} ${c - 6} M${c + 1.5} ${c + 6} L${c + 5} ${c - 6}`;
    const g = `<g transform="rotate(${(angle - 90).toFixed(1)} ${c} ${c})">` +
      `<path d="M${c - 3.4} ${c + 4} L${c - 1} ${c - 4} L${c + 3.4} ${c - 4} L${c + 1} ${c + 4} Z" fill="#fff"/>` + // blank out the line between the bars
      `<path d="${bars}" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/>` +
      `<path d="${bars}" stroke="#374151" stroke-width="2" stroke-linecap="round"/></g>`;
    return { svg: `${svgOpen(s, s)}${g}</svg>`, w: s, h: s, anchor: [c, c] };
  }
  if (kind === 'jump') {
    const w = 18, h = 16;
    const svg = `${svgOpen(w, h)}<path d="M9 1.5 L17 14.5 H1 Z" fill="#b42318" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>` +
      `<path d="M9 5.8v4.2" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/><circle cx="9" cy="12.3" r="1.05" fill="#fff"/></svg>`;
    return { svg, w, h, anchor: [w / 2, h + 9] };
  }
  // stop
  const d = 18;
  const w = label ? Math.max(d, textWidth(label)) : d;
  const h = d + (label ? 13 : 0);
  const cx = w / 2;
  const svg = `${svgOpen(w, h)}<circle cx="${cx}" cy="9" r="8" fill="#1f2937" stroke="#fff" stroke-width="2"/>` +
    `<rect x="${cx - 3.3}" y="5.5" width="2.3" height="7" rx=".6" fill="#fff"/><rect x="${cx + 1}" y="5.5" width="2.3" height="7" rx=".6" fill="#fff"/>` +
    `${label ? haloText(cx, d + 10, label) : ''}</svg>`;
  return { svg, w, h, anchor: [cx, 9] };
}

/** A short text label with a white outline and no box, e.g. "Stopped 6m" during replay. */
export function textLabel(text) {
  const w = textWidth(text), h = 14;
  return { svg: `${svgOpen(w, h)}${haloText(2, 11, text, 'start')}</svg>`, w, h };
}
