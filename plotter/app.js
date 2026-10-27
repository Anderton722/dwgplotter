import { openSet, attachXref, listItems, drawPreview, plotItem, mergePdfs, describeWarnings, listLayers, drawingUnits } from '/engine.js?v=25';
import { t, tn, applyStatic, LANG, LANGS } from '/plotter/i18n.js?v=1';

const $ = s => document.querySelector(s);
// the page text comes from i18n.js; paper-size options and the language picker are filled in here
applyStatic();
document.querySelectorAll('#paper option[data-size]').forEach(o => { o.textContent = t('paper.fit', { size: o.dataset.size }); });
{
  const sel = $('#lang'), home = { en: '/', es: '/es/', fr: '/fr/', de: '/de/', zh: '/zh/' };
  sel.replaceChildren(...Object.entries(LANGS).map(([k, name]) => Object.assign(document.createElement('option'), { value: home[k], textContent: name, selected: k === LANG })));
  sel.addEventListener('change', () => { location.href = sel.value; });
}
const sleep = (ms = 0) => new Promise(r => setTimeout(r, ms));
const views = { drop: $('#drop-view'), loading: $('#loading-view'), work: $('#work-view') };
const show = name => Object.entries(views).forEach(([k, v]) => { v.hidden = k !== name; });

let state = { P: null, name: '', items: [], token: 0, hidden: new Set() }; // hidden = layers the user switched off

// remembered choices (colour, paper); never required for the page to work
const PREF = 'sheetprint.prefs';
const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem(PREF, JSON.stringify(prefs)); } catch { /* private mode etc. */ } };
if (prefs.colour) $('#c-col').checked = true;
if (prefs.paper) $('#paper').value = prefs.paper;
if (prefs.fmt) $('#fmt').value = prefs.fmt;
if (prefs.output === 'many') $('#o-many').checked = true;
for (const id of ['#o-one', '#o-many']) $(id).addEventListener('change', () => { prefs.output = $('#o-many').checked ? 'many' : 'one'; savePrefs(); update(); });

/* ---------- choosing a file ---------- */
const drop = $('#drop'), input = $('#file');
input.addEventListener('change', () => { if (input.files.length) openFiles([...input.files]); });
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
for (const ev of ['dragenter', 'dragover']) addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) addEventListener(ev, e => { e.preventDefault(); if (ev === 'drop' || e.target === document.documentElement) drop.classList.remove('over'); });
addEventListener('drop', e => {
  const files = [...(e.dataTransfer?.files || [])]; if (!files.length) return;
  // while a drawing that links to others is open, dropped files are offered to it as linked drawings
  if (!views.work.hidden && state.P?.xrefs?.length) addXrefs(files); else openFiles(files);
});
$('#open-other').addEventListener('click', () => { state.token++; input.value = ''; show('drop'); });

const MESSAGES = { NOT_DWG: 'err.notdwg', UNREADABLE: 'err.unreadable' };
function showError(e) {
  const key = MESSAGES[e.message] || 'err.generic', box = $('#drop-error');
  box.replaceChildren(Object.assign(document.createElement('strong'), { textContent: t(key + '.t') + ' ' }), t(key + '.h'));
  const detail = e.cause?.message || (MESSAGES[e.message] ? '' : e.message);
  if (detail) { const d = document.createElement('details'), s = document.createElement('summary'); s.textContent = t('details'); d.append(s, detail); box.append(d); }
  box.hidden = false;
}

// One file, or a drawing together with the drawings it links to (xrefs): the one that links to the others is the main drawing.
async function openFiles(files) {
  const token = ++state.token; $('#drop-error').hidden = true;
  const mb = files.reduce((s, f) => s + f.size, 0) / 1048576; // the reader runs in this tab, so a big file can make the page pause for a few seconds: say so first
  show('loading'); $('#loading-text').textContent = t(files.length > 1 ? 'loading.many' : 'loading.one') + (mb > 3 ? t('loading.big', { mb: Math.round(mb) }) : ''); await sleep(60);
  try {
    if (files.some(f => !/\.(dwg|dxf)$/i.test(f.name))) throw new Error('NOT_DWG');
    const set = await openSet(await Promise.all(files.map(async f => ({ name: f.name, buf: await f.arrayBuffer() }))));
    $('#loading-text').textContent = t('loading.sheets'); await sleep(10);
    const items = listItems(set.P);
    if (token !== state.token) return;
    state = { P: set.P, name: set.mainName || files[0].name, items, token, hidden: new Set() };
    buildWork(); renderXrefs(ignoredMessage(set.ignored)); show('work'); renderThumbs(); promptXrefs();
  } catch (e) { console.error(e); if (token === state.token) { show('drop'); showError(e); } }
}
const ignoredMessage = names => (names.length ? tn('ign', names.length, { names: names.join(', ') }) : '');

/* ---------- linked drawings (xrefs): only used when the matching file is supplied ---------- */
function renderXrefs(msg = '') {
  const { P } = state, box = $('#xrefs'); box.hidden = !P.xrefs.length; if (box.hidden) return;
  const list = [...P.xrefs].sort((a, b) => !!a.file - !!b.file || b.uses - a.uses), missing = list.filter(x => !x.file).length;
  $('#xref-list').replaceChildren(...list.map(x => {
    const chip = Object.assign(document.createElement('span'), { className: 'chip ' + (x.file ? 'ok' : 'miss'), textContent: x.name });
    chip.title = x.file ? t('xref.chip.ok', { file: x.file }) : t('xref.chip.miss', { name: x.name }); return chip;
  }));
  $('#xref-help').textContent = missing ? t('xref.help.missing', { n: missing }) : t('xref.help.ok');
  const m = $('#xref-msg'); m.hidden = !msg; m.textContent = msg;
}
async function addXrefs(files) {
  const { P } = state, msgs = [], btn = $('#xref-add'); btn.disabled = true; setStatus(t('status.adding'));
  for (const f of files) {
    if (!/\.(dwg|dxf)$/i.test(f.name)) { msgs.push(t('x.notdwg', { f: f.name })); continue; }
    try { if (!(await attachXref(P, f.name, await f.arrayBuffer()))) msgs.push(t('x.ignored', { f: f.name })); }
    catch (e) { console.error(e); msgs.push(t('x.unreadable', { f: f.name })); }
  }
  state.items = listItems(P); buildWork(); renderXrefs(msgs.join(' ')); renderThumbs(); btn.disabled = false; setStatus('');
  if (xdlg.open) { if (P.xrefs.some(x => !x.file)) fillPrompt(msgs.join(' ')); else xdlg.close(); } // keep asking until nothing is missing, or the user skips
}

/* the prompt: tell the user straight away that linked drawings are missing and ask for them by file name */
const xdlg = $('#xref-dialog');
function fillPrompt(msg = '') {
  const missing = state.P.xrefs.filter(x => !x.file);
  $('#xd-list').replaceChildren(...missing.slice(0, 12).map(x => Object.assign(document.createElement('li'), { textContent: `${x.name}.dwg` })));
  if (missing.length > 12) $('#xd-list').append(Object.assign(document.createElement('li'), { textContent: t('xd.more', { n: missing.length - 12 }) }));
  const m = $('#xd-msg'); m.hidden = !msg; m.textContent = msg;
}
function promptXrefs() {
  if (!state.P.xrefs.some(x => !x.file)) return;
  fillPrompt(); if (!xdlg.open) xdlg.showModal();
}
$('#xd-add').addEventListener('click', () => $('#xref-file').click());
$('#xd-skip').addEventListener('click', () => xdlg.close());
$('#xref-add').addEventListener('click', () => $('#xref-file').click());
$('#xref-file').addEventListener('change', e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) addXrefs(fs); });

/* ---------- the list of sheets ---------- */
const title = it => (it.kind === 'layout' ? it.name : it.name); // layouts keep their own name; model areas are "Drawing N"
const subtitle = it => (it.empty ? t('card.empty') : it.kind === 'model' ? t('card.model') : it.kind === 'area' ? t(it.important ? 'card.smart' : 'card.small') : it.label.replace(/ (landscape|portrait)$/, (m, o) => ' ' + t(o))); // the engine's sheet label ends in the English orientation word

function buildWork() {
  const { items, name, P } = state;
  $('#file-name').textContent = name;
  const note = $('#file-notice');
const dxf = P.version === 'DXF';
  note.hidden = P.version === 'AC1032' && !dxf;
  note.textContent = dxf ? t('notice.dxf') : P.version === 'AC1032' ? '' : t('notice.old', { ver: P.versionName });

  const anyLayout = items.some(i => i.kind === 'layout' && !i.empty);
  // sheets win; otherwise the important Smart plot areas (or the whole drawing) are ticked
  items.forEach(it => { it.on = !it.empty && (it.kind === 'layout' || (!anyLayout && (it.kind === 'model' || it.important))); });
  const areas = items.filter(i => i.kind === 'area'), smart = $('#smart-note');
  smart.hidden = areas.length < 2 && !(areas.length && anyLayout);
  if (!smart.hidden) $('#smart-text').textContent = areas.length > 1 ? t('smart.many', { n: areas.length }) : t('smart.one');

  updateLayerNote();
  $('#items').replaceChildren(...items.map(it => {
    const card = document.createElement('div'); card.className = 'card' + (it.empty ? ' empty' : '') + (it.on ? ' on' : '');
    const thumb = Object.assign(document.createElement('button'), { type: 'button', className: 'thumb loading' });
    thumb.setAttribute('aria-label', t('card.preview', { name: title(it) }));
    const canvas = Object.assign(document.createElement('canvas'), { width: 600, height: 430 }); thumb.append(canvas);
    thumb.addEventListener('click', () => openPreview(it));
    const pick = document.createElement('label'); pick.className = 'pick';
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: it.on, disabled: it.empty });
    box.addEventListener('change', () => { it.on = box.checked; card.classList.toggle('on', it.on); update(); });
    const text = document.createElement('span'); text.innerHTML = '<span class="t"></span><span class="m"></span>';
    text.firstChild.textContent = title(it); text.lastChild.textContent = subtitle(it);
    pick.append(box, text); card.append(thumb, pick);
    Object.assign(it, { card, thumb, canvas, box });
    return card;
  }));
  update();
}

$('#sel-all').addEventListener('click', () => {
  const usable = state.items.filter(i => !i.empty), all = usable.every(i => i.on);
  usable.forEach(i => { i.on = !all; i.box.checked = i.on; i.card.classList.toggle('on', i.on); });
  update();
});

function update() {
  const n = state.items.filter(i => i.on).length, btn = $('#download');
  const usable = state.items.filter(i => !i.empty); $('#sel-all').textContent = t(usable.length && usable.every(i => i.on) ? 'select.none' : 'select.all');
  const png = $('#fmt').value === 'png';
  $('#out-seg').hidden = n < 2 || png; // combined or separate only matters with 2+ PDF sheets (pictures always come as separate files)
  btn.disabled = n === 0;
  btn.textContent = png ? (n > 1 ? t('dl.imgs', { n }) : t('dl.img')) : n > 1 ? ($('#o-many').checked ? t('dl.pdfzip', { n }) : t('dl.pdfpages', { n })) : t('dl.pdf');
  setStatus(n === 0 ? t('status.tick') : '');
}

async function renderThumbs() {
  const { token, items, P } = state, colour = $('#c-col').checked;
  let done = 0, progress = false;
  for (const it of items) {
    if (token !== state.token) return;
    if (items.length > 1) { setStatus(t('status.prep', { i: ++done, n: items.length })); progress = true; }
    it.thumb.classList.add('loading');
    try { const r = await drawPreview(P, it, it.canvas, { colour, hidden: [...state.hidden] }); it.aspect = parseFloat(r.extentsSize[0]) / parseFloat(r.extentsSize[1]); }
    catch (e) { console.error(e); }
    it.thumb.classList.remove('loading'); await sleep(0);
  }
  if (token === state.token && progress) update(); // clear our progress line (update() sets the normal message)
}
for (const id of ['#c-bw', '#c-col']) $(id).addEventListener('change', () => { prefs.colour = $('#c-col').checked; savePrefs(); if (state.P) renderThumbs(); });
$('#paper').addEventListener('change', () => { prefs.paper = $('#paper').value; savePrefs(); });
$('#fmt').addEventListener('change', () => { prefs.fmt = $('#fmt').value; savePrefs(); update(); });

/* ---------- big preview with drag + wheel zoom ---------- */
const dlg = $('#preview'), view = $('#pv-view'), pv = $('#pv-canvas'), over = $('#pv-over');
let tf = { s: 1, x: 0, y: 0 }, pvItem = null, pvMap = null, pvViews = [], measure = null, layersChanged = false;
const apply = () => { const t = `translate(${tf.x}px, ${tf.y}px) scale(${tf.s})`; pv.style.transform = over.style.transform = t; drawMeasure(); };
function fit() { const k = Math.min(view.clientWidth / pv.width, view.clientHeight / pv.height) * 0.96; tf = { s: k, x: (view.clientWidth - pv.width * k) / 2, y: (view.clientHeight - pv.height * k) / 2 }; apply(); }
async function paintPreview() {
  if (!pvItem) return;
  try { const r = await drawPreview(state.P, pvItem, pv, { colour: $('#c-col').checked, hidden: [...state.hidden], snap: [] }); pvMap = r.map; pvViews = r.viewports || []; indexSnap(r.map.snap); } catch (e) { console.error(e); }
}
let paintTimer = 0; const schedulePaint = () => { clearTimeout(paintTimer); paintTimer = setTimeout(paintPreview, 160); };
async function openPreview(it) {
  pvItem = it; $('#pv-title').textContent = title(it); clearMeasure(); setTool('measure', false);
  const aspect = it.kind === 'layout' ? it.sheet[0] / it.sheet[1] : it.aspect || 1.4, long = 2400;
  [pv.width, pv.height] = [over.width, over.height] = aspect >= 1 ? [long, Math.round(long / aspect)] : [Math.round(long * aspect), long];
  buildLayers(); dlg.showModal(); fit(); await paintPreview();
}
dlg.addEventListener('close', () => { pvItem = null; if (layersChanged) { layersChanged = false; renderThumbs(); } });
$('#pv-close').addEventListener('click', () => dlg.close());
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
view.addEventListener('dblclick', fit);
view.addEventListener('wheel', e => {
  e.preventDefault(); const r = view.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, k = Math.exp(-e.deltaY * 0.0015);
  const s = Math.min(Math.max(tf.s * k, 0.05), 6), f = s / tf.s; tf = { s, x: px - (px - tf.x) * f, y: py - (py - tf.y) * f }; apply();
}, { passive: false });
let drag = null, pinch = null; const touches = new Map(); // touches: active pointers by id, for two-finger pinch zoom
const pinchState = () => { const [a, b] = [...touches.values()], r = view.getBoundingClientRect(); return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top }; };
view.addEventListener('pointerdown', e => {
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { view.setPointerCapture(e.pointerId); } catch { /* a pointer that has already ended */ }
  if (touches.size === 2) { drag = null; pinch = { ...pinchState(), s: tf.s, tx: tf.x, ty: tf.y }; return; }
  drag = { x: e.clientX - tf.x, y: e.clientY - tf.y, sx: e.clientX, sy: e.clientY }; view.classList.add('drag');
});
view.addEventListener('pointermove', e => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && touches.size >= 2) { // two fingers: zoom around the point between them, and follow it as it moves
    const n = pinchState(), s = Math.min(Math.max(pinch.s * n.d / pinch.d, 0.05), 6), f = s / pinch.s;
    tf = { s, x: n.cx - (pinch.cx - pinch.tx) * f, y: n.cy - (pinch.cy - pinch.ty) * f }; apply(); return;
  }
  if (drag) { tf.x = e.clientX - drag.x; tf.y = e.clientY - drag.y; apply(); }
});
const endPointer = e => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; };
view.addEventListener('pointercancel', e => { endPointer(e); drag = null; view.classList.remove('drag'); });
view.addEventListener('pointerup', e => {
  const click = drag && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5; drag = null; view.classList.remove('drag'); endPointer(e);
  if (click && view.classList.contains('measuring')) measureClick(e);
});
addEventListener('resize', () => { if (dlg.open) fit(); });

/* ---------- layers: switch them off to hide clutter; the choice applies to the preview, thumbnails and the PDF ---------- */
let layerList = [];
const hiddenCount = () => layerList.filter(l => state.hidden.has(l.name)).length;
function buildLayers() { layerList = listLayers(state.P); $('#l-search').value = ''; renderLayerRows(); }
function renderLayerRows() {
  const q = $('#l-search').value.trim().toLowerCase(), rows = layerList.filter(l => !q || l.name.toLowerCase().includes(q));
  $('#l-list').replaceChildren(...rows.map(l => {
    const li = document.createElement('li'); if (l.off) li.className = 'off';
    const lab = document.createElement('label'), box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !l.off && !state.hidden.has(l.name), disabled: l.off });
    box.addEventListener('change', () => { box.checked ? state.hidden.delete(l.name) : state.hidden.add(l.name); layerChanged(); });
    const sw = Object.assign(document.createElement('span'), { className: 'sw' }); sw.style.background = l.color;
    const nm = Object.assign(document.createElement('span'), { className: 'nm', textContent: l.name, title: l.off ? t('l.hidden', { name: l.name }) : l.name });
    lab.append(box, sw, nm, Object.assign(document.createElement('span'), { className: 'ct', textContent: l.count })); li.append(lab); return li;
  }));
  renderLayerCount();
}
function layerChanged() { layersChanged = true; renderLayerCount(); schedulePaint(); updateLayerNote(); }
const renderLayerCount = () => { const shown = layerList.filter(l => !l.off && !state.hidden.has(l.name)).length; $('#l-count').textContent = t('l.count', { shown, total: layerList.length }); };
$('#l-search').addEventListener('input', renderLayerRows);
$('#l-all').addEventListener('click', () => { state.hidden.clear(); renderLayerRows(); layerChanged(); });
$('#l-none').addEventListener('click', () => { layerList.forEach(l => { if (!l.off) state.hidden.add(l.name); }); renderLayerRows(); layerChanged(); });
function updateLayerNote() {
  const n = state.hidden.size, note = $('#layer-note'); note.hidden = n === 0;
  if (n) $('#layer-text').textContent = tn('layers.text', n);
}
$('#layer-reset').addEventListener('click', () => { state.hidden.clear(); updateLayerNote(); renderThumbs(); });

/* ---------- toolbar: Layers panel and Measure tool ---------- */
function setTool(which, on) {
  const btn = $(which === 'layers' ? '#pv-layers-btn' : '#pv-measure-btn'); btn.setAttribute('aria-pressed', String(on));
  if (which === 'layers') $('#pv-layers').hidden = !on; else { view.classList.toggle('measuring', on); if (!on) clearMeasure(); }
  if (dlg.open) requestAnimationFrame(fit);
}
$('#pv-layers-btn').addEventListener('click', () => setTool('layers', $('#pv-layers-btn').getAttribute('aria-pressed') !== 'true'));
$('#pv-measure-btn').addEventListener('click', () => setTool('measure', $('#pv-measure-btn').getAttribute('aria-pressed') !== 'true'));
dlg.addEventListener('cancel', e => { if (measure) { e.preventDefault(); clearMeasure(); } }); // Esc clears a measurement before it closes the window

/* ---------- measure: click two points; distance comes out in the drawing's own units ---------- */
const fmt = n => (n >= 100 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n.toFixed(3)).replace(/\.?0+$/, '');
function canvasPoint(e) { const r = view.getBoundingClientRect(); return { x: (e.clientX - r.left - tf.x) / tf.s, y: (e.clientY - r.top - tf.y) / tf.s }; }
function toDrawing(c) { return { x: pvMap.x0 + (c.x - 10) / pvMap.k, y: pvMap.y0 + (pvMap.H - 10 - c.y) / pvMap.k }; }
// snap points (line ends and corners) are bucketed in 32 px cells so the nearest one is found without scanning them all
let snapPts = [], snapGrid = new Map(), hover = null;
function indexSnap(pts = []) {
  snapPts = pts; snapGrid = new Map();
  for (let i = 0; i < pts.length; i += 2) { const key = (pts[i] >> 5) * 8192 + (pts[i + 1] >> 5); (snapGrid.get(key) || snapGrid.set(key, []).get(key)).push(i); }
}
function snapTo(c) {
  const r = 14 / tf.s, gx = Math.floor(c.x) >> 5, gy = Math.floor(c.y) >> 5, span = Math.ceil(r / 32); let best = null, bd = r;
  for (let dx = -span; dx <= span; dx++) for (let dy = -span; dy <= span; dy++) for (const i of snapGrid.get((gx + dx) * 8192 + gy + dy) || []) { const d = Math.hypot(snapPts[i] - c.x, snapPts[i + 1] - c.y); if (d < bd) { bd = d; best = { x: snapPts[i], y: snapPts[i + 1] }; } }
  return best;
}
view.addEventListener('pointermove', e => {
  if (!view.classList.contains('measuring') || drag) return;
  const c = canvasPoint(e), s = snapTo(c); if ((s && s.x) !== (hover && hover.x) || (s && s.y) !== (hover && hover.y)) { hover = s; drawMeasure(); }
});
view.addEventListener('pointerleave', () => { if (hover) { hover = null; drawMeasure(); } });
function measureClick(e) {
  if (!pvMap) return; const c = snapTo(canvasPoint(e)) || canvasPoint(e);
  if (!measure || measure.b) measure = { a: c }; else measure.b = c;
  drawMeasure(); readout();
}
function clearMeasure() { measure = null; $('#pv-readout').hidden = true; if (over.getContext) over.getContext('2d').clearRect(0, 0, over.width, over.height); }
function drawMeasure() {
  const g = over.getContext('2d'); g.clearRect(0, 0, over.width, over.height);
  if (hover && view.classList.contains('measuring')) { g.lineWidth = 2 / tf.s; g.strokeStyle = '#16a34a'; g.beginPath(); g.arc(hover.x, hover.y, 8 / tf.s, 0, 7); g.stroke(); }
  if (!measure) return;
  const w = 2.5 / tf.s, dot = 5 / tf.s, pts = [measure.a, measure.b].filter(Boolean);
  g.lineWidth = w; g.strokeStyle = '#e11d48'; g.fillStyle = '#e11d48';
  if (measure.b) { g.beginPath(); g.moveTo(measure.a.x, measure.a.y); g.lineTo(measure.b.x, measure.b.y); g.stroke(); }
  for (const p of pts) { g.beginPath(); g.arc(p.x, p.y, dot, 0, 7); g.fill(); }
}
function readout() {
  const box = $('#pv-readout'); if (!measure?.b) { box.hidden = false; box.textContent = t('m.second'); return; }
  const A = toDrawing(measure.a), B = toDrawing(measure.b), d = Math.hypot(B.x - A.x, B.y - A.y), U = drawingUnits(state.P);
  let value = d, label = U.label, note = '';
  if (pvMap.paper) { // a sheet is in millimetres of paper; inside a viewport the real distance is paper distance / viewport scale
    const inVp = pvViews.find(v => [A, B].every(p => p.x >= v.rect[0] && p.x <= v.rect[2] && p.y >= v.rect[1] && p.y <= v.rect[3]));
    if (inVp) { value = d / inVp.s; note = t('m.real', { mm: fmt(d * pvMap.u) }) + (U.mm ? '' : t('m.nounits')); } else { value = d * pvMap.u; label = 'mm'; note = t('m.sheet'); }
  } else if (!U.mm) note = t('m.nounit2');
  const mm = label === 'mm' ? value : U.mm && label === U.label ? value * U.mm : 0;
  box.replaceChildren(`${fmt(value)} ${label}`); if (mm >= 1000) box.append(Object.assign(document.createElement('small'), { textContent: `${fmt(mm / 1000)} m` }));
  if (note) box.append(Object.assign(document.createElement('small'), { textContent: note }));
  box.hidden = false;
}

/* ---------- saving the PDF ---------- */
const FIT = { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841] };
// A picture of one sheet (about 4000 px on its long side), white background, honouring colour and switched-off layers
async function makePng(P, it, colour) {
  const aspect = it.kind === 'layout' ? it.sheet[0] / it.sheet[1] : it.aspect || 1.4, long = 4000, c = document.createElement('canvas');
  [c.width, c.height] = aspect >= 1 ? [long, Math.round(long / aspect)] : [Math.round(long * aspect), long];
  await drawPreview(P, it, c, { colour, hidden: [...state.hidden] });
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('png'))), 'image/png'));
}
const status = $('#status');
function setStatus(msg, kind = '') { status.textContent = msg; status.className = 'status ' + kind; }

$('#download').addEventListener('click', async () => {
  const { P, items, name } = state, chosen = items.filter(i => i.on); if (!chosen.length) return;
  const btn = $('#download'), notes = $('#notes'); btn.disabled = true; notes.hidden = true;
  const colour = $('#c-col').checked, paper = $('#paper').value, parts = [], warnings = {}, png = $('#fmt').value === 'png';
  try {
    for (const [i, it] of chosen.entries()) {
      setStatus(chosen.length > 1 ? t(png ? 'status.imgn' : 'status.page', { i: i + 1, n: chosen.length }) : t(png ? 'status.img' : 'status.pdf')); await sleep(30);
      if (png) { parts.push(await makePng(P, it, colour)); continue; }
      const opts = { colour, hidden: [...state.hidden] };
      if (it.kind !== 'layout') Object.assign(opts, paper === 'asdrawn' ? { paper: [420, 297], orient: 'landscape' } : { paper: [FIT[paper][1], FIT[paper][0]], orient: 'auto' });
      else if (paper !== 'asdrawn') opts.fit = FIT[paper];
      const r = await plotItem(P, it, opts); parts.push(r.bytes);
      for (const [k, v] of Object.entries(r.warnings || {})) warnings[k] = (warnings[k] || 0) + v;
    }
    const safe = s => s.replace(/[\\/:*?"<>|]+/g, '_'), base = safe(name.replace(/\.(dwg|dxf)$/i, ''));
    const ext = png ? 'png' : 'pdf', separate = chosen.length > 1 && (png || $('#o-many').checked); // one file per sheet, bundled in a .zip so the browser saves them reliably
    let bytes, file, mime = 'application/pdf';
    if (separate) {
      setStatus(t('status.pack')); await sleep(20);
      const zip = new JSZip(); parts.forEach((b, i) => zip.file(`${base} - ${safe(title(chosen[i]))}.${ext}`, b));
      bytes = await zip.generateAsync({ type: 'uint8array' }); file = `${base}.zip`; mime = 'application/zip';
    } else if (png) {
      bytes = parts[0]; mime = 'image/png'; file = `${base} - ${safe(title(chosen[0]))}.png`;
    } else {
      bytes = parts.length === 1 ? parts[0] : await mergePdfs(parts);
      file = `${base}${chosen.length === 1 ? ' - ' + safe(title(chosen[0])) : ''}.pdf`;
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    Object.assign(document.createElement('a'), { href: url, download: file }).click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    setStatus(t('status.saved', { file }), 'ok');
    const list = describeWarnings(warnings, (k, n, v) => (n === undefined ? t(k, v) : tn(k, n, v)));
    if (list.length) { notes.replaceChildren(...list.map(text => Object.assign(document.createElement('li'), { textContent: text }))); notes.hidden = false; }
  } catch (e) { console.error(e); setStatus(t('status.fail'), 'err'); }
  btn.disabled = false;
});

show('drop');
