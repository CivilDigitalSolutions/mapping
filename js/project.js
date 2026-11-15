// Project files: everything in the app (datasets, styles and time zones) in one
// JSON file that people can keep as a backup or open on another computer.

export const PROJECT_FORMAT = 'data-mapper-project';
export const PROJECT_VERSION = 1;

/** True if parsed JSON looks like one of our project files. */
export function isProject(json) {
  return !!json && typeof json === 'object' && json.format === PROJECT_FORMAT && Array.isArray(json.datasets);
}

/** Quick check on raw text, without parsing the whole file twice. */
export function looksLikeProjectText(text) {
  return text.trimStart().startsWith('{') && text.slice(0, 400).includes(`"${PROJECT_FORMAT}"`);
}

export function buildProject(datasets, prefs) {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    app: 'Data Mapper',
    displayTimeZone: prefs.displayTz || '',
    datasets,
  };
}

/**
 * Validate and clean the datasets in a project file.
 * Returns { datasets, dropped } where dropped counts unusable points.
 * Throws with a readable message if the file can't be used at all.
 */
export function readProject(json, defaultStyle) {
  if (!isProject(json)) throw new Error("this isn't a Data Mapper project file");
  if (json.version > PROJECT_VERSION) throw new Error('this project was saved by a newer version of Data Mapper. Reload the app to update it, then try again');
  let dropped = 0;
  const datasets = json.datasets.map((d, n) => {
    if (!d || !Array.isArray(d.points)) throw new Error(`dataset ${n + 1} is damaged`);
    const points = [];
    for (const p of d.points) {
      const lat = Number(p?.lat), lon = Number(p?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { dropped++; continue; }
      const t = p.t === null || p.t === undefined || !Number.isFinite(Number(p.t)) ? null : Number(p.t);
      points.push({
        lat, lon, t,
        ...(p.tzx && t !== null ? { tzx: true } : {}),
        label: typeof p.label === 'string' ? p.label : String(p.label ?? ''),
        props: p.props && typeof p.props === 'object' ? Object.fromEntries(Object.entries(p.props).map(([k, v]) => [k, String(v)])) : {},
        src: p.src,
      });
    }
    const base = defaultStyle(n, points.some((p) => p.t !== null));
    return {
      id: '', // a fresh id is given when the dataset is added
      name: typeof d.name === 'string' && d.name.trim() ? d.name : `Dataset ${n + 1}`,
      visible: d.visible !== false,
      style: { ...base, ...(d.style && typeof d.style === 'object' ? d.style : {}) },
      points,
      skipped: Array.isArray(d.skipped) ? d.skipped : [],
      source: d.source || 'Project file',
      createdAt: Number(d.createdAt) || Date.now(),
      ...(typeof d.timeZone === 'string' ? { timeZone: d.timeZone } : {}),
    };
  });
  return { datasets, dropped, displayTimeZone: typeof json.displayTimeZone === 'string' ? json.displayTimeZone : null };
}
