// Saving and opening project files (all datasets, styles and time zones in one file).

import { trackEvent } from './analytics.js';
import { deviceTimeZone, isValidTimeZone, setDisplayTimeZone } from './dates.js';
import { buildProject, readProject } from './project.js';
import { fitAll, removeLayers, renderAll, replay } from './mapview.js';
import { changed, datasets, defaultStyle, prefs, save, savePrefs } from './state.js';
import { fillZoneSelect } from './style-controls.js';
import { $, announce, choiceDialog, download, toast, uid } from './util.js';

export function saveProjectFile() {
  if (!datasets.length) { toast('There is nothing to save yet.'); return; }
  const stamp = new Date().toISOString().slice(0, 10);
  download(`Data_Mapper_project_${stamp}.json`, JSON.stringify(buildProject(datasets, prefs)), 'application/json');
  prefs.lastBackup = Date.now();
  savePrefs();
  changed();
  toast('Project file saved to your downloads. Open it with "Open project file" on any computer.');
  trackEvent('project-save');
}

/** Load a project file's text. Asks whether to add to or replace what's already loaded. */
export async function openProjectText(text, fileName = 'project file') {
  let project;
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    toast(`Couldn't open ${fileName}: the file is damaged or isn't a Data Mapper project file.`, 'error');
    return;
  }
  try {
    project = readProject(json, defaultStyle);
  } catch (err) {
    toast(`Couldn't open ${fileName}: ${err.message}.`, 'error');
    return;
  }
  if (!project.datasets.length) { toast(`${fileName} has no datasets in it.`, 'error'); return; }
  let mode = 'add';
  if (datasets.length) {
    const n = project.datasets.length;
    mode = await choiceDialog('Open project file', `This project has ${n} dataset${n === 1 ? '' : 's'}. Add ${n === 1 ? 'it' : 'them'} to what's on the map now, or replace everything on the map with ${n === 1 ? 'it' : 'them'}?`, [
      { value: 'add', label: 'Add to the map', kind: 'primary' },
      { value: 'replace', label: 'Replace everything', kind: 'danger' },
      { value: '', label: 'Cancel' },
    ]);
    if (!mode) return;
  }
  if (mode === 'replace') {
    if (replay.active) replay.close();
    datasets.forEach((d) => removeLayers(d.id));
    datasets.length = 0;
  }
  for (const ds of project.datasets) {
    ds.id = uid();
    datasets.push(ds);
  }
  renderAll();
  if (project.displayTimeZone !== null && mode === 'replace') {
    prefs.displayTz = isValidTimeZone(project.displayTimeZone) ? project.displayTimeZone : '';
    setDisplayTimeZone(prefs.displayTz);
    fillZoneSelect($('#display-tz'), prefs.displayTz || deviceTimeZone(), '');
  }
  changed();
  save();
  fitAll();
  prefs.lastBackup = Date.now(); // what's loaded now matches a file the user has
  savePrefs();
  const pts = project.datasets.reduce((n, d) => n + d.points.length, 0);
  toast(`Opened ${project.datasets.length} dataset${project.datasets.length === 1 ? '' : 's'} (${pts.toLocaleString()} points)${project.dropped ? `. ${project.dropped} damaged points were left out` : ''}.`);
  announce('Project opened');
  trackEvent('project-open');
}
