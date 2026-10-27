import * as E from './engine.js?v=23';
const { getLib, parse, prepare, renderItem, plotLayoutPdf, plotModelExtents, drawText, faceFor, ACI_RGB, SHX, SUPPORTED, IGNORED, layoutRecord, entityList, findAreas, listItems } = E;

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const $ = id => document.getElementById(id);

async function renderPdf(name, canvas) {
  const url = `DWGs/${name}`; const r = await fetch(url);
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!r.ok) { ctx.fillStyle = '#888'; ctx.fillText('no reference PDF', 20, 30); return; }
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await r.arrayBuffer()) }).promise;
  const pg = await doc.getPage(1), vp0 = pg.getViewport({ scale: 1 }), k = Math.min(canvas.width / vp0.width, canvas.height / vp0.height);
  await pg.render({ canvasContext: ctx, viewport: pg.getViewport({ scale: k }) }).promise;
}

const dwgs = ['MASTER FILE.dwg'];
const sel = $('file');
fetch('DWGs/').then(r => r.text()).then(t => {
  const names = [...t.matchAll(/href="([^"]+\.dwg)"/gi)].map(m => decodeURIComponent(m[1]));
  sel.replaceChildren(...names.map(n => Object.assign(document.createElement('option'), { value: n, textContent: n })));
  load();
});
let P;
async function load() {
  $('msg').textContent = 'Parsing…'; await getLib();
  const name = sel.value, buf = await (await fetch('DWGs/' + encodeURIComponent(name))).arrayBuffer();
  const t0 = performance.now(); P = parse(buf); await prepare(P);
  const items = ['Model', ...P.db.objects.LAYOUT.filter(l => l.layoutName !== 'Model').map(l => l.layoutName)];
  $('item').replaceChildren(...items.map(n => Object.assign(document.createElement('option'), { textContent: n })));
  $('msg').textContent = `Parsed in ${Math.round(performance.now() - t0)} ms`;
  window.__P = P; go();
}
async function go() {
  const item = $('item').value || 'Model'; const info = await renderItem(P, item === 'Model' ? 'Model' : 'Paper', $('ours'), item);
  const m = sel.value.match(/(\d{4})_P1/); await renderPdf(m ? `J865-JB-COCKU1ZZ-SVR-DR-E-${m[1]}_S3_P1.pdf` : 'none', $('ref'));
  $('info').textContent = JSON.stringify(info, null, 1);
}
window.__plot = plotLayoutPdf;
// Plot a file's layout and compare it with the matching reference PDF (text report + fitted alignment).
window.__eval = async idx => {
  sel.selectedIndex = idx; await load();
  const m = sel.value.match(/(\d{4})_P1/); if (!m) return { error: 'no reference for ' + sel.value };
  window.__textLog = [];
  const ours = await plotLayoutPdf(P, P.db.objects.LAYOUT.find(l => l.layoutName !== 'Model').layoutName);
  const refRes = await fetch(`DWGs/J865-JB-COCKU1ZZ-SVR-DR-E-${m[1]}_S3_P1.pdf`);
  if (!refRes.ok) return { error: 'no reference PDF for ' + m[1] };
  const ref = new Uint8Array(await refRes.arrayBuffer());
  const A = await extractPdf(ours.bytes), B = await extractPdf(ref), fit = frameFit(A, B);
  Object.assign(window, { __A: A, __B: B, __fit: fit, __ours: ours.bytes, __ref: ref });
  return { file: m[1], fit: { s: +fit.s.toFixed(4), sx: +fit.sx.toFixed(4), sy: +fit.sy.toFixed(4), ex: +fit.ex.toFixed(1), ey: +fit.ey.toFixed(1) }, text: textReport(A, B, fit) };
};
window.__plotModel = opts => plotModelExtents(P, opts);

// Per-face calibration: for strings present in both plots, ratio of our text size/width to the reference's.
window.__faceStats = () => {
  const key = s => s.trim().replace(/\s+/g, ' '), f = window.__fit, ref = window.__B.texts, ours = window.__A.texts, st = {};
  for (const l of window.__textLog) {
    if (l.face === 'stroke' || l.s.length < 6) continue;
    const o = ours.find(t => key(t.s) === key(l.s)), r = ref.find(t => key(t.s) === key(l.s) && o && Math.hypot(f.s * o.x + f.ex - t.x, f.s * o.y + f.ey - t.y) < 60);
    if (!o || !r) continue;
    const k = l.face + (l.mtext ? '/mtext' : '/text'); (st[k] ||= { h: [], w: [], n: 0 }); st[k].n++;
    st[k].h.push(o.h * f.s / r.h); st[k].w.push(o.w * f.s / r.w);
  }
  const med = a => a.sort((p, q) => p - q)[a.length >> 1];
  return Object.fromEntries(Object.entries(st).map(([k, v]) => [k, { n: v.n, height: +med(v.h).toFixed(3), width: +med(v.w).toFixed(3) }]));
};
// Summary across every file that has a reference PDF.
window.__evalAll = async () => {
  const rows = [];
  for (let i = 0; i < sel.options.length; i++) {
    const r = await window.__eval(i); if (r.error) continue;
    const d = await pixelDiff(window.__ours, window.__ref, window.__fit, 1, 2);
    const B2 = { ...window.__B, segs: window.__B.segs.filter(g => g[4] > 0) }, m = segMatch(window.__A, B2, window.__fit, 8, 1.2);
    rows.push({ file: r.file, textExact: `${r.text.exact}/${r.text.refTexts}`, inkRecall: d.recall, inkPrecision: d.precision, strokedSegMatch: m.rate });
  }
  return rows;
};
// Batch health check on a corpus: parse, list printables, plot each, and count every object type (flagging the unsupported).
window.__corpus = async (manifest, from = 0, to = 1e9) => {
  const out = [];
  for (const [i, m] of manifest.entries()) {
    if (i < from || i >= to) continue;
    const row = { i, file: m.path, mb: +(m.size / 1048576).toFixed(2) };
    try {
      const t0 = performance.now(), buf = await (await fetch('samples/CAD/' + m.path.split('/').map(encodeURIComponent).join('/'))).arrayBuffer();
      const PP = parse(buf); await prepare(PP);
      row.parseMs = Math.round(performance.now() - t0); row.ver = new TextDecoder().decode(new Uint8Array(buf, 0, 6));
      const types = {}, count = (list, w) => list.forEach(e => { const k = e.type; (types[k] ||= { n: 0, where: new Set() }); types[k].n++; types[k].where.add(w); });
      count(PP.db.entities, 'space'); for (const b of PP.db.tables.BLOCK_RECORD.entries) if (!b.name.startsWith('*')) count(b.entities || [], 'blk');
      row.unsupported = Object.entries(types).filter(([k]) => !SUPPORTED.has(k) && !IGNORED.has(k)).map(([k, v]) => `${k}:${v.n}`);
      row.entities = Object.values(types).reduce((s, v) => s + v.n, 0);
      row.layouts = PP.db.objects.LAYOUT.map(l => l.layoutName).filter(n => n !== 'Model');
      row.shx = [...new Set(Object.values(PP.styleFonts).map(f => String(f).toLowerCase()).filter(f => /shx$|^txt$/.test(f) || !/\./.test(f)))].filter(f => f).map(f => f.replace(/\.shx$/, '')).filter(f => SHX[f] === null).join(',');
      // plot every layout and the model, catching failures
      const t1 = performance.now(); let plotted = 0, fails = [];
      const warns = {}, sheets = [];
      for (const n of row.layouts) { try { const r = await plotLayoutPdf(PP, n); plotted++; sheets.push(r.size.join('x')); Object.entries(r.warnings).forEach(([k, v]) => warns[k] = (warns[k] || 0) + v); } catch (e) { fails.push(n + ': ' + e.message); } }
      try { const r = await plotModelExtents(PP); plotted++; Object.entries(r.warnings).forEach(([k, v]) => warns['model ' + k] = v); } catch (e) { fails.push('Model: ' + e.message); }
      row.warnings = warns; row.sheets = sheets;
      row.plotMs = Math.round(performance.now() - t1); row.plotted = plotted; row.fails = fails;
    } catch (e) { row.error = String(e.message || e).slice(0, 120); }
    out.push(row);
  }
  return out;
};
window.__loadCorpus = async path => { const buf = await (await fetch('samples/CAD/' + path.split('/').map(encodeURIComponent).join('/'))).arrayBuffer(); P = parse(buf); await prepare(P); window.__P = P; return P; };
window.__plot = plotLayoutPdf; window.__ACI = ACI_RGB;
window.__drawText = drawText; window.__faceFor = faceFor;
$('pdf').onclick = async () => {
  const item = $('item').value; if (item === 'Model') { $('msg').textContent = 'Pick a layout to plot'; return; }
  const r = await plotLayoutPdf(P, item, { colour: $('colour').checked }), url = URL.createObjectURL(new Blob([r.bytes], { type: 'application/pdf' }));
  Object.assign(document.createElement('a'), { href: url, download: sel.value.replace(/\.dwg$/i, '') + '-' + item + '.pdf' }).click();
  $('msg').textContent = `PDF ${r.size.join('×')} mm, ${(r.bytes.length / 1024) | 0} KB`;
};
sel.onchange = load; $('go').onclick = go; $('item').onchange = go;

// Area detection over the corpus: how many real drawings does each file's model space contain, and how long does it take?
window.__areasCorpus = async (manifest, from = 0, to = 1e9) => {
  const out = [];
  for (const [i, m] of manifest.entries()) {
    if (i < from || i >= to) continue;
    try {
      const PP = await window.__loadCorpus(m.path), t0 = performance.now(), a = E.findAreas(PP);
      const n = entityList(PP, PP.model.handle, PP.model.name).length;
      out.push({ i, f: m.path.slice(-38), ents: n, ms: Math.round(performance.now() - t0), areas: a.length, imp: a.filter(x => x.important).length, sizes: a.slice(0, 6).map(x => `${Math.round(x.box[2] - x.box[0])}x${Math.round(x.box[3] - x.box[1])}`).join(' ') });
    } catch (e) { out.push({ i, f: m.path.slice(-38), err: String(e.message || e).slice(0, 80) }); }
  }
  return out;
};
window.__E = E;
