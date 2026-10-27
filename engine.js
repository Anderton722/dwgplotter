import { createModule, LibreDwg, Dwg_File_Type } from './vendor/libredwg/dist/libredwg-web.js';
import { PdfCtx, makeBoundsCtx, needsRaster } from './pdfctx.js?v=60';
import { ShxFont } from './shx.js?v=1';
import { dxfToDb } from './dxf.js?v=6';

// DWG plotting engine: reads a DWG in the browser and writes vector PDFs. No UI code lives here.
// Needs the pdf-lib global (PDFLib) and a DOM canvas (for measuring text).
// Everything the engine loads sits next to this file, so the site needs no outside servers.
const HERE = new URL('./', import.meta.url).href, BASE = HERE + 'vendor/libredwg/wasm/';
export const config = { fontDir: HERE + 'fonts/' }; // where SHX fonts are served from

let lib;
async function getLib() {
  if (lib) return lib;
  const wasmBinary = new Uint8Array(await (await fetch(BASE + 'libredwg-web.wasm')).arrayBuffer());
  lib = new LibreDwg(await createModule({ wasmBinary, locateFile: p => BASE + p }));
  await loadHershey();
  return lib;
}
// per-drawing setup that needs the parsed styles
async function prepare(P) {
  await loadShxFonts(P);
}

// AutoCAD index colours: only the common ones; 7 is white/black
const ACI = { 1: '#f00', 2: '#cc0', 3: '#0a0', 4: '#0aa', 5: '#00f', 6: '#c0c', 7: '#000', 8: '#808080', 9: '#c0c0c0' };
const aci = i => ACI[i] || '#000';

function parse(buf, type = Dwg_File_Type.DWG) {
  const l = lib; let data, db;
  try { data = l.dwg_read_data(buf, type); db = l.convert(data); }
  catch (e) { lib = null; throw e; } // a failed read can leave the reader's memory in a bad state: use a fresh reader next time
  finally { if (data) { try { l.dwg_free(data); } catch { lib = null; } } } // hand the reader's memory back
  return makeP(db);
}
// Reading happens in a background worker so a big drawing does not freeze the page; if workers are unavailable the caller falls back to parse().
let worker, jobId = 0; const jobs = new Map();
function readInWorker(buf) {
  return new Promise((resolve, reject) => {
    let w; try { w = worker ||= new Worker(new URL('./dwgworker.js', import.meta.url), { type: 'module' }); } catch { return reject({ fallback: true }); }
    w.onmessage = ({ data }) => { const j = jobs.get(data.id); if (!j) return; jobs.delete(data.id); data.error ? j.reject({ message: data.error }) : j.resolve(data.db); };
    w.onerror = () => { for (const j of jobs.values()) j.reject({ fallback: true }); jobs.clear(); w.terminate(); if (worker === w) worker = null; };
    const id = ++jobId, copy = buf.slice(0); jobs.set(id, { resolve, reject });
    try { w.postMessage({ id, buf: copy }, [copy]); } catch { jobs.delete(id); reject({ fallback: true }); }
  });
}
async function readDwg(buf) {
  try { return makeP(await readInWorker(buf)); }
  catch (e) { if (!e || !e.fallback) throw e; await getLib(); return parse(buf, Dwg_File_Type.DWG); }
}
function makeP(db) {
  const blocks = {}; for (const b of db.tables.BLOCK_RECORD.entries) blocks[b.name] = b;
  const layers = {}; for (const y of db.tables.LAYER.entries) layers[y.name] = y;
  const byOwner = {}; for (const e of db.entities) (byOwner[e.ownerBlockRecordSoftId] ||= []).push(e);
  const styleFonts = {}, styleWidth = {}; for (const s of db.tables.STYLE.entries) { styleFonts[s.name] = s.font; styleWidth[s.name] = s.widthFactor || 1; }
  const model = db.tables.BLOCK_RECORD.entries.find(b => /^\*model_space$/i.test(b.name)); // some files spell these in capitals
  const paper = db.tables.BLOCK_RECORD.entries.find(b => /^\*paper_space$/i.test(b.name));
  return { db, blocks, layers, byOwner, model, paper, styleFonts, styleWidth };
}

let HIDDEN = new Set(); // layers the user switched off for this preview or plot
const withAllLayers = fn => { const h = HIDDEN; HIDDEN = new Set(); try { return fn(); } finally { HIDDEN = h; } }; // sheet sizes and areas ignore the user's choices
function hiddenLayer(L, name) {
  if (HIDDEN.size && HIDDEN.has(name)) return true;
  const y = L[name]; if (!y) return false;
  return !!(y.frozen || y.off || y.isFrozen || y.isOff || (y.colorIndex < 0) || y.plotFlag === false || y.plotFlag === 0);
}

function entityList(P, handle, name) {
  // top-level space entities come from db.entities (owner = block record handle); block defs from the record
  return P.byOwner[handle] || (P.blocks[name] && P.blocks[name].entities) || [];
}

const SUPPORTED = new Set(['LINE', 'LWPOLYLINE', 'POLYLINE2D', 'CIRCLE', 'ARC', 'ELLIPSE', 'SPLINE', 'SOLID', 'HATCH', '3DFACE', 'TEXT', 'MTEXT', 'ATTRIB', 'INSERT', 'MULTILEADER', 'VIEWPORT', 'DIMENSION', 'LEADER', 'MLINE', 'POINT', 'OLE2FRAME', 'ACAD_TABLE', 'POLYLINE3D', 'WIPEOUT']);
const IGNORED = new Set(['ATTDEF']);
// Each layout owns its own paper-space block record (found through the layout object); fall back to the first one.
const layoutRecord = (P, name) => {
  const lay = P.db.objects.LAYOUT.find(l => l.layoutName === name);
  return (lay && P.db.tables.BLOCK_RECORD.entries.find(b => b.handle === lay.paperSpaceTableId)) || P.paper;
};
// Warnings: things in the drawing we could not print faithfully, so the user is never told a sheet is complete when it isn't.
let WARN = {};
const warn = (key, n = 1) => { WARN[key] = (WARN[key] || 0) + n; };
const WARN_TEXT = { OLE2FRAME: 'embedded object (OLE) not shown', MLINE: 'multi-line drawn approximately', ACAD_TABLE: 'table not shown', DIMENSION: 'dimension without geometry', UNKNOWN: 'unsupported object' };

// ---- text -------------------------------------------------------------------------------------
const CAP = 0.677; // cap height / em, calibrated against the reference plot (Arial is 0.716)
const mctx = document.createElement('canvas').getContext('2d');
// Faces map CAD fonts onto the standard PDF fonts (css = canvas font for measuring, pdf = font resource name)
// cap = cap height / em (CAD text height is the cap height, PDF font size is the em)
const FACES = {
  sans: { key: 'sans', css: 'Arial', pdf: 'F1', cap: 0.716 }, sansB: { key: 'sansB', css: 'bold Arial', pdf: 'F2', cap: 0.716 }, sansI: { key: 'sansI', css: 'italic Arial', pdf: 'F3', cap: 0.716 },
  narrow: { key: 'narrow', css: 'Arial', pdf: 'F1', wScale: 0.82, cap: 0.716 }, narrowB: { key: 'narrowB', css: 'bold Arial', pdf: 'F2', wScale: 0.82, cap: 0.716 },
  serif: { key: 'serif', css: '"Times New Roman"', pdf: 'F4', cap: 0.675 }, mono: { key: 'mono', css: '"Courier New"', pdf: 'F5', cap: 0.675 },
  // lettering the PDF fonts cannot write (CJK, Cyrillic, Arabic, ...): the visitor's own system fonts
  intl: { key: 'intl', css: '"Segoe UI","Microsoft YaHei","PingFang SC","Hiragino Sans","Yu Gothic","Malgun Gothic","Noto Sans CJK SC","Noto Sans",Arial,sans-serif', pdf: 'F1', cap: 0.716 },
};
const measure = (s, size, face = FACES.sans) => {
  const [, style, family] = /^((?:bold |italic )?)(.*)$/.exec(face.css);
  mctx.font = `${style}${size}px ${family}`;
  return mctx.measureText(s).width * (face.wScale || 1);
};

// Which face/stroke font a text object uses: style table font file, overridden by an inline \f code in MTEXT
function faceFor(P, styleName, raw) {
  // an inline \f code only sets the face when it opens the whole text (a Symbol-font bullet in the middle must not)
  const font = String(P.styleFonts?.[styleName] || '').toLowerCase(), inl = /^\s*(?:\\p[^;]*;)?\{?\\f([^|;]+)\|b(\d)\|i(\d)/.exec(raw || '');
  if (!inl && (/\.shx$/.test(font) || font === 'txt' || font === 'simplex' || font === 'romans')) return { stroke: true, shx: SHX[font.replace(/\.shx$/, '')] || null };
  const name = (inl ? inl[1] : font).toLowerCase(), bold = inl ? inl[2] === '1' : /nb\.|bold|b\.ttf/.test(name), ital = inl ? inl[3] === '1' : /ariali|italic/.test(name);
  if (/times/.test(name)) return FACES.serif;
  if (/lucon|courier|consol/.test(name)) return FACES.mono;
  if (/narrow|arialn/.test(name)) return bold ? FACES.narrowB : FACES.narrow;
  return bold ? FACES.sansB : ital ? FACES.sansI : FACES.sans;
}

// Hershey single-stroke glyphs stand in for SHX fonts (ROMANS is derived from the same Roman Simplex design).
let HERSHEY = null;
async function loadHershey() {
  if (HERSHEY) return;
  const j = await (await fetch(HERE + 'vendor/hersheytext.min.json')).json();
  HERSHEY = {}; j.futural.chars.forEach((g, i) => { // y-up, baseline 0, cap height 21
    const strokes = g.d.split(/(?=M)/).map(s => (s.match(/-?\d+(?:\.\d+)?/g) || []).map(Number)).filter(n => n.length >= 4).map(n => { const p = []; for (let k = 0; k < n.length; k += 2) p.push([n[k], 22 - n[k + 1]]); return p; });
    HERSHEY[String.fromCharCode(33 + i)] = { adv: g.o * 2, strokes };
  });
  HERSHEY[' '] = { adv: 14, strokes: [] };
}

// AutoCAD's own SHX fonts (the real glyphs), loaded from fonts/ for every SHX font the drawing's text styles use.
const SHX = {};
async function loadShxFonts(P) {
  const names = new Set(Object.values(P.styleFonts).map(f => String(f || '').toLowerCase().replace(/\.shx$/, '')).filter(Boolean));
  await Promise.all([...names].filter(n => !(n in SHX) && !/\.(ttf|ttc|otf)$/.test(n)).map(async n => {
    try { const r = await fetch(`${config.fontDir}${n}.shx`); SHX[n] = r.ok ? new ShxFont(await r.arrayBuffer()) : null; } catch (e) { SHX[n] = null; }
  }));
}
// One glyph from a stroke face: the SHX font when we have it, else the Hershey stand-in. Units: face.unit per cap height.
const strokeGlyph = (face, ch) => (face.shx && face.shx.glyph(ch.codePointAt(0))) || (face.shx ? { adv: face.shx.above * 0.6, strokes: [] } : (HERSHEY[ch] || HERSHEY['?']));
const strokeUnit = face => (face.shx ? face.shx.above : 21);
const strokeWidth = (s, face, sc) => [...s].reduce((w, c) => w + strokeGlyph(face, c).adv * sc, 0);

function cleanText(t) {
  return t.replace(/\\\\/g, '\u0001').replace(/\\fSymbol[^;]*;([^{}\\]*)/g, (m, g) => g.replace(/·/g, '•')) // Symbol-font bullet.replace(/\\([{}])/g, '$1').replace(/\\P/g, '\n')
    .replace(/\\S([^;^/#]*)[\^/#]([^;]*);/g, '$1/$2').replace(/\\[fFHWCcQTAp][^;]*;/g, '') // codes that carry arguments end with ;
    .replace(/\\[LlOoKk]/g, '').replace(/\\~/g, ' ')
    .replace(/[{}]/g, '').replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[uUoO]/g, '').replace(/%%%/g, '%').replace(/\u0001/g, '\\');
}

// o: text, x, y (anchor), h (CAD text height), rot, xs (width factor), ha 0/1/2 = left/centre/right (4 = middle), va 0/1 = baseline/bottom, 2 = middle, 3 = top
function drawText(ctx, o) { // strokes of lettering are not snap points
  if (ctx._ns !== undefined) ctx._ns++;
  try { return drawText0(ctx, o); } finally { if (ctx._ns !== undefined) ctx._ns--; }
}
function drawText0(ctx, o) {
  const face = needsRaster(String(o.text)) ? FACES.intl : (o.face || FACES.sans), h = o.h || 2.5, sc = h / (face.stroke ? strokeUnit(face) : 21);
  // measured against the reference: plain Arial TEXT is sized on a 0.677 cap ratio, Arial MTEXT on 0.716
  const size = h / (face.key === 'sans' && !o.mtext ? 0.677 : (face.cap || CAP));
  // MTEXT: an inline \W<n>; sets the width factor and wins over the style's; otherwise MTEXT ignores the style factor
  const wm = o.mtext && /\\W([\d.]+);/.exec(String(o.text)), xs = wm ? +wm[1] : (o.xs || 1);
  if (window.__textLog) window.__textLog.push({ s: cleanText(String(o.text)).split('\n')[0].trim(), face: face.key || (face.stroke ? 'stroke' : '?'), mtext: !!o.mtext, xs });
  const width = s => face.stroke ? strokeWidth(s, face, sc) : measure(s, size, face);
  // lines: [{ segs: [{ t, x }], w }] with x / w in "local" units (drawing units divided by the width factor)
  const lines = [];
  if (!o.mtext) cleanText(String(o.text)).replace(/\t/g, ' ').split('\n').forEach(t => lines.push({ segs: [{ t, x: 0 }], w: width(t) }));
  else { let u = 1, ind = 0, left = 0, stops = [], grid = 4 * h; // paragraph settings persist until a later \p changes them
   for (const chunk of String(o.text).split(/\\P|\r?\n/)) { // paragraph breaks are \P or a real newline
    // paragraph codes: \p[x]i<first-line indent>,l<left indent>,t<tab stop>; (x = indents in half-text-height units, as measured)
    const pm = /\\p([^;]*);/.exec(chunk);
    if (pm) {
      let p = pm[1]; if (p[0] === 'x') { u = h * 0.85; grid = 2 * u; p = p.slice(1); } else u = 1; // measured: 1 unit = 2.1 mm for 2.5 mm text
      const set = {}; for (const f of p.split(',')) { const v = parseFloat(f.slice(1)); if (!isNaN(v)) set[f[0]] = v; else if (f[0] === 't') set.t0 = 1; }
      if ('i' in set) ind = set.i * u; if ('l' in set) left = set.l * u;
      if ('t' in set) stops = [set.t * u]; else if (set.t0) stops = [];
    }
    const nextStop = x => stops.find(v => v > x + 1e-6) ?? Math.ceil((x + 1e-6) / grid) * grid;
    const avail = o.wrap > 0 ? o.wrap : Infinity; let cur = { segs: [], w: 0 }, X = left + ind;
    cleanText(chunk).split('\t').forEach((part, pi) => {
      if (pi > 0) X = nextStop(X);
      let piece = '', pieceX = X;
      for (const word of part.split(' ')) { // word-wrap to the text box width; wrapped lines restart at the left indent
        const t = piece ? piece + ' ' + word : word;
        if (piece && pieceX + width(t) * xs > avail) { cur.segs.push({ t: piece, x: pieceX / xs }); cur.w = pieceX / xs + width(piece); lines.push(cur); cur = { segs: [], w: 0 }; pieceX = left; piece = word; } else piece = t;
      }
      cur.segs.push({ t: piece, x: pieceX / xs }); cur.w = pieceX / xs + width(piece); X = pieceX + width(piece) * xs;
    });
    lines.push(cur);
   }
  }
  const pitch = h * 1.667 * (o.ls || 1), n = lines.length;
  const va = o.va === 4 ? 2 : o.va, ha = o.ha === 4 ? 1 : o.ha;
  const first = va === 3 ? -h : va === 2 ? ((n - 1) * pitch - h) / 2 : (n - 1) * pitch; // first baseline relative to the anchor (y up)
  ctx.translate(o.x, o.y); ctx.rotate(o.rot || 0); ctx.scale(xs * (face.wScale || 1), -1);
  if (!face.stroke) { ctx.font = `${/^bold /.test(face.css) ? 'bold ' : /^italic /.test(face.css) ? 'italic ' : ''}${size}px ${face.css.replace(/^(bold|italic) /, '')}`; ctx.pdfFont = face.pdf; }
  lines.forEach((ln, i) => {
    const x0 = ha === 1 ? -ln.w / 2 : ha === 2 ? -ln.w : 0, base = -(first - i * pitch);
    for (const seg of ln.segs) {
      if (!seg.t) continue;
      if (!face.stroke) { ctx.fillText(seg.t, (x0 + seg.x) / (face.wScale || 1), base); continue; }
      let x = x0 + seg.x; // stroke font: each glyph is a set of polylines in font units (y up, baseline 0)
      ctx.beginPath(); // SHX text strokes plot at the object's lineweight (0.25 mm by default), as in the reference
      for (const c of seg.t) {
        const g = strokeGlyph(face, c);
        for (const s of g.strokes) s.forEach(([gx, gy], k) => ctx[k ? 'lineTo' : 'moveTo'](x + gx * sc, base - gy * sc));
        x += g.adv * sc;
      }
      ctx.stroke();
    }
  });
}

// ---- colour ------------------------------------------------------------------------------------
// AutoCAD Color Index -> RGB. 1-9 and 250-255 are fixed; 10-249 are 24 hues x 5 brightness levels x (full, half saturation).
const ACI_RGB = (() => {
  const t = [[0, 0, 0], [255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255], [0, 0, 255], [255, 0, 255], [255, 255, 255], [128, 128, 128], [192, 192, 192]];
  const hsv = (h, s, v) => { const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6]; return [r + m, g + m, b + m].map(q => Math.floor(q * 255 + 1e-6)); };
  for (let i = 10; i < 250; i++) { const g = Math.floor((i - 10) / 10), v = (i - 10) % 10, level = [1, 0.65, 0.5, 0.3, 0.15][v >> 1]; t[i] = hsv(g * 15, v % 2 ? 0.5 : 1, 1).map(q => Math.floor(q * level + 1e-6)); }
  [[51, 51, 51], [91, 91, 91], [132, 132, 132], [173, 173, 173], [214, 214, 214], [255, 255, 255]].forEach((c, k) => { t[250 + k] = c; });
  return t;
})();
let PLOT_COLOR = false; // false = monochrome (indexed colours print black), true = colour
const rgbStr = (r, g, b) => `rgb(${r},${g},${b})`, intRgb = n => rgbStr(n >> 16 & 255, n >> 8 & 255, n & 255);
// Effective plot colour of an entity: own colour, else its layer's (ByLayer), else its block's (ByBlock = pcol).
function plotColour(P, e, pcol) {
  const own = e.color != null && e.color !== 16777215; // true-colour objects keep their colour in both modes
  if (!PLOT_COLOR) return own ? intRgb(e.color) : '#000';
  let ci = e.colorIndex, tc = e.color;
  if (ci === 0) return pcol; // ByBlock
  if (ci === 256 || ci == null) { const L = P.layers[e.layer]; ci = L ? Math.abs(L.colorIndex) : 7; tc = L?.color; if (ci === 0 || ci === 256 || !ci) ci = 7; }
  if (ci === 7) return '#000'; // white / black prints black on paper
  const base = ACI_RGB[ci] || [0, 0, 0], baseInt = base[0] << 16 | base[1] << 8 | base[2];
  return tc != null && tc !== baseInt && tc !== 16777215 ? intRgb(tc) : rgbStr(...base);
}

// Draw primitives into a 2D context. T is a 2x3 affine matrix [a,b,c,d,e,f].
function draw(ctx, P, list, T, depth = 0, parent = null, pcol = '#000') {
  for (const e of list) {
    if (hiddenLayer(P.layers, e.layer)) continue;
    ctx.save(); ctx.transform(...T);
    // monochrome plot style maps indexed colours to black; true-colour objects keep their own colour
    const tc = plotColour(P, e, pcol);
    ctx.strokeStyle = ctx.fillStyle = tc;
    const lw = lineweightMm(P, e, parent), scale = Math.hypot(T[0], T[1]) || 1;
    CUR_SCALE = scale;
    ctx.lineWidth = Math.max(lw ? Math.max(lw * PX_PER_MM, MIN_PX) / scale : HAIR_PX / scale, e.constantWidth || 0); // lineweights are paper mm; polyline widths are drawing units; weight 0 = hairline
    const pat = linetypePattern(P, e);
    ctx.setLineDash(pat ? pat.map(d => d * (e.lineTypeScale || 1) * (P.db.header.LTSCALE || 1)) : []);
    ctx.beginPath();
    switch (e.type) {
      case 'LINE': ctx.moveTo(e.startPoint.x, e.startPoint.y); ctx.lineTo(e.endPoint.x, e.endPoint.y); ctx.stroke(); break;
      case 'LWPOLYLINE': {
        const v = e.vertices; if (!v?.length) break;
        ctx.moveTo(v[0].x, v[0].y);
        const n = (e.flag & (1 | 512)) ? v.length : v.length - 1; // this DWG version flags "closed" as 512
        for (let i = 0; i < n; i++) {
          const a = v[i], b = v[(i + 1) % v.length];
          if (a.bulge) bulge(ctx, a, b, a.bulge); else ctx.lineTo(b.x, b.y);
        }
        ctx.stroke(); break;
      }
      case 'POLYLINE2D': { // old-style polyline: vertices with bulges and widths
        const v = (e.vertices || []).filter(q => !(q.flag & 16)); if (v.length < 2) break; // flag 16 = spline frame point
        const w0 = e.startWidth || v[0].startWidth || 0; if (w0 > 0) ctx.lineWidth = Math.max(ctx.lineWidth, w0);
        ctx.moveTo(v[0].x, v[0].y);
        const n = (e.flag & 1) ? v.length : v.length - 1;
        for (let i = 0; i < n; i++) { const a = v[i], b = v[(i + 1) % v.length]; if (a.bulge) bulge(ctx, a, b, a.bulge); else ctx.lineTo(b.x, b.y); }
        ctx.stroke(); break;
      }
      case 'DIMENSION': { // the drawing already holds a block with the dimension's lines, arrows and text
        const b = P.blocks[e.name];
        if (b && depth < 6) { ctx.restore(); ctx.save(); draw(ctx, P, b.entities || [], T, depth + 1, e, tc); ctx.restore(); continue; }
        warn('DIMENSION'); break;
      }
      case 'LEADER': {
        const v = e.vertices || []; if (v.length < 2) break;
        ctx.moveTo(v[0].x, v[0].y); for (const p of v.slice(1)) ctx.lineTo(p.x, p.y); ctx.stroke();
        if (e.isArrowheadEnabled) { // arrowhead at the first vertex
          const a = v[0], b = v[1], len = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, k = Math.min(3, len / 3);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + ux * k - uy * k / 6, a.y + uy * k + ux * k / 6); ctx.lineTo(a.x + ux * k + uy * k / 6, a.y + uy * k - ux * k / 6); ctx.closePath(); ctx.fill();
        }
        break;
      }
      case 'MLINE': { // approximate: two parallel lines at +-0.5 x scale around the path (the standard style)
        const vs = (e.vertices || []).map(q => ({ p: q.vertex, m: q.miterDirection || q.vertexDirection })); if (vs.length < 2) break;
        warn('MLINE');
        for (const side of [0.5, -0.5]) {
          vs.forEach((q, i) => { const m = q.m || { x: 0, y: 0 }, off = side * (e.scale || 1); ctx[i ? 'lineTo' : 'moveTo'](q.p.x + m.x * off, q.p.y + m.y * off); });
          if (e.flags & 2) ctx.closePath(); ctx.stroke(); ctx.beginPath();
        }
        break;
      }
      case 'OLE2FRAME': { // embedded document (e.g. an Excel table or picture): we cannot render it, so mark where it sits
        warn('OLE2FRAME'); const a = e.leftUpPoint, b = e.rightDownPoint; if (!a || !b) break;
        ctx.setLineDash([2, 2]); ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); ctx.stroke(); break;
      }
      case 'ACAD_TABLE': warn('ACAD_TABLE'); break;
      case 'POINT': break; // points have no printed size in the default display mode
      case 'POLYLINE3D': { // plotted flat: x and y of each vertex
        const v = e.vertices || []; if (v.length < 2) break;
        ctx.moveTo(v[0].x, v[0].y); for (const p of v.slice(1)) ctx.lineTo(p.x, p.y); if (e.flag & 1) ctx.closePath(); ctx.stroke(); break;
      }
      case 'WIPEOUT': { // a mask: paints its outline in white over everything drawn before it
        const pts = e.clippingBoundaryPath || []; if (pts.length < 2 || !e.uPixel || !e.vPixel) break;
        const W = e.imageSize?.x || 1, H = e.imageSize?.y || 1, at = p => ({ x: e.position.x + (p.x + 0.5) * W * e.uPixel.x + (p.y + 0.5) * H * e.vPixel.x, y: e.position.y + (p.x + 0.5) * W * e.uPixel.y + (p.y + 0.5) * H * e.vPixel.y });
        const poly = pts.length === 2 ? [pts[0], { x: pts[1].x, y: pts[0].y }, pts[1], { x: pts[0].x, y: pts[1].y }] : pts;
        const q = poly.map(at); ctx.fillStyle = 'rgb(255,255,255)'; ctx.moveTo(q[0].x, q[0].y); for (const p of q.slice(1)) ctx.lineTo(p.x, p.y); ctx.closePath(); ctx.fill(); break;
      }
      case '3DFACE': { // drawn as its (visible) edges, e.g. the sheet border rectangles
        const c = [e.corner1, e.corner2, e.corner3, e.corner4];
        for (let i = 0; i < 4; i++) if (!((e.flag || 0) & (1 << i))) { ctx.moveTo(c[i].x, c[i].y); ctx.lineTo(c[(i + 1) % 4].x, c[(i + 1) % 4].y); }
        ctx.stroke(); break;
      }
      case 'MULTILEADER': {
        for (const s of e.leaderSections || []) for (const ln of s.leaderLines || []) {
          const pts = [...ln.vertices, s.lastLeaderLinePoint], d = s.doglegVector || { x: 0, y: 0 }, L = s.doglegLength || 0;
          pts.push({ x: s.lastLeaderLinePoint.x + d.x * L, y: s.lastLeaderLinePoint.y + d.y * L });
          ctx.moveTo(pts[0].x, pts[0].y); for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y); ctx.stroke();
          const a = pts[0], b = pts[1], len = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, k = e.arrowheadSize || 2.5;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + ux * k - uy * k / 6, a.y + uy * k + ux * k / 6); ctx.lineTo(a.x + ux * k + uy * k / 6, a.y + uy * k - ux * k / 6); ctx.closePath(); ctx.fill();
        }
        if (e.textContent && e.textAnchor && e.contentBasePosition) drawText(ctx, { text: e.textContent, x: e.textAnchor.x, y: e.contentBasePosition.y, h: e.textHeight || 2.5, ha: 0, va: 2, mtext: true, face: FACES.narrow });
        break;
      }
      case 'ELLIPSE': {
        const rx = Math.hypot(e.majorAxisEndPoint.x, e.majorAxisEndPoint.y);
        ctx.ellipse(e.center.x, e.center.y, rx, rx * e.axisRatio, Math.atan2(e.majorAxisEndPoint.y, e.majorAxisEndPoint.x), e.startAngle, e.endAngle); ctx.stroke(); break;
      }
      case 'SPLINE': {
        const pts = e.fitPoints?.length ? e.fitPoints : e.controlPoints; if (!pts?.length) break;
        ctx.moveTo(pts[0].x, pts[0].y); for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y); ctx.stroke(); break;
      }
      case 'SOLID': for (const c of [e.corner1, e.corner2, e.corner4, e.corner3]) c && (ctx[ctx._m ? 'lineTo' : 'moveTo'](c.x, c.y), ctx._m = 1); ctx._m = 0; ctx.fill(); break;
      case 'HATCH': {
        for (const bp of e.boundaryPaths || []) {
          if (bp.vertices?.length) { ctx.moveTo(bp.vertices[0].x, bp.vertices[0].y); for (const v of bp.vertices.slice(1)) ctx.lineTo(v.x, v.y); ctx.closePath(); continue; }
          if (!bp.edges?.length) continue;
          let first = true; // a boundary made of edges: line, arc, ellipse or spline pieces joined end to end
          const go = (x, y) => { if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y); };
          for (const ed of bp.edges) {
            if (ed.type === 1) { go(ed.start.x, ed.start.y); ctx.lineTo(ed.end.x, ed.end.y); }
            else if (ed.type === 2) { const a0 = ed.startAngle, sx = ed.center.x + ed.radius * Math.cos(a0), sy = ed.center.y + ed.radius * Math.sin(a0); go(sx, sy); ctx.arc(ed.center.x, ed.center.y, ed.radius, a0, ed.endAngle, !ed.isCCW); }
            else if (ed.type === 3) { // ellipse: `end` is the major axis end relative to the centre, `lengthOfMinorAxis` the minor/major ratio
              const mx = ed.end.x, my = ed.end.y, nx = -my * ed.lengthOfMinorAxis, ny = mx * ed.lengthOfMinorAxis, a0 = ed.startAngle;
              let span = ed.isCCW ? ed.endAngle - a0 : a0 - ed.endAngle; while (span <= 1e-9) span += 2 * Math.PI;
              for (let k = 0; k <= 48; k++) { const t = a0 + (ed.isCCW ? 1 : -1) * span * k / 48; go(ed.center.x + mx * Math.cos(t) + nx * Math.sin(t), ed.center.y + my * Math.cos(t) + ny * Math.sin(t)); }
            } else if (ed.type === 4 && ed.controlPoints?.length) { for (const p of splinePoints(ed)) go(p.x, p.y); }
          }
          ctx.closePath();
        }
        if (e.solidFill) ctx.fill('evenodd'); else ctx.stroke(); break;
      }
      case 'CIRCLE': ctx.arc(e.center.x, e.center.y, e.radius, 0, 7); ctx.stroke(); break;
      case 'ATTRIB': {
        const a = e.text; if (!a || typeof a !== 'object' || (e.flags & 1) || !a.text) break;
        const just = a.halign || a.valign;
        drawText(ctx, { text: a.text, x: (just && e.alignmentPoint ? e.alignmentPoint : a.startPoint).x, y: (just && e.alignmentPoint ? e.alignmentPoint : a.startPoint).y, h: a.textHeight, rot: a.rotation, xs: a.xScale, ha: a.halign, va: a.valign, face: faceFor(P, a.styleName, a.text) });
        break;
      }
      case 'ARC': {
        const span = (((e.endAngle - e.startAngle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        if (span < 1e-9) break; // zero-length arc: nothing is drawn (not a full circle)
        ctx.arc(e.center.x, e.center.y, e.radius, e.startAngle, e.endAngle); ctx.stroke(); break;
      }
      case 'TEXT': {
        if (!e.text) break;
        const just = e.halign || e.valign, p = just && e.endPoint ? e.endPoint : e.startPoint;
        drawText(ctx, { text: e.text, x: p.x, y: p.y, h: e.textHeight, rot: e.rotation, xs: e.xScale, ha: e.halign, va: e.valign, face: faceFor(P, e.styleName, e.text) });
        break;
      }
      case 'MTEXT': {
        if (!e.text) break;
        const d = e.direction, rot = d && (d.x || d.y) ? Math.atan2(d.y, d.x) : (e.rotation || 0), ap = e.attachmentPoint || 1;
        drawText(ctx, { text: e.text, x: e.insertionPoint.x, y: e.insertionPoint.y, h: e.textHeight, rot, ha: [0, 1, 2][(ap - 1) % 3], va: [3, 2, 0][Math.floor((ap - 1) / 3)], mtext: true, wrap: e.rectWidth, ls: e.lineSpacing || 1, face: faceFor(P, e.styleName, e.text) });
        break;
      }
      case 'INSERT': {
        const b = P.blocks[e.name]; if (!b || depth > 6) break;
        const sx = e.xScale || 1, sy = e.yScale || 1, r = e.rotation || 0, c = Math.cos(r), s = Math.sin(r);
        const inner = [c * sx, s * sx, -s * sy, c * sy, e.insertionPoint.x, e.insertionPoint.y];
        if (!(b.entities || []).length) { // an empty block is probably an external reference (xref) to another drawing
          const xr = P.xrefFiles?.get(xrefKey(e.name));
          if (xr && depth < 5) { // the user supplied it: draw that drawing's model space at the insert's position
            const base = xr.db.header.INSBASE || { x: 0, y: 0 };
            ctx.restore(); ctx.save();
            draw(ctx, xr, entityList(xr, xr.model.handle, xr.model.name), mul(T, mul(inner, [1, 0, 0, 1, -base.x, -base.y])), depth + 1, e, tc);
            ctx.restore(); continue;
          }
          if (P.xrefs?.some(x => x.key === xrefKey(e.name))) warn('XREF:' + e.name);
        }
        ctx.restore(); ctx.save();
        draw(ctx, P, b.entities || [], mul(T, inner), depth + 1, e, tc);
        // attributes are owned by the INSERT and positioned in the parent space, not inside the block
        if (P.byOwner[e.handle]) draw(ctx, P, P.byOwner[e.handle], T, depth + 1, e, tc);
        ctx.restore(); continue;
      }
      default:
        if (!SUPPORTED.has(e.type) && !IGNORED.has(e.type)) warn('UNKNOWN:' + e.type);
    }
    ctx.restore();
  }
}
// AutoCAD stores lineweights as an index: 29 = ByLayer, 30 = ByBlock, 31 = default
const LW_MM = [0, .05, .09, .13, .15, .18, .2, .25, .3, .35, .4, .5, .53, .6, .7, .8, .9, 1, 1.06, 1.2, 1.4, 1.58, 2, 2.11];
let PX_PER_MM = 1, MIN_PX = 0.6, HAIR_PX = 0.6, CUR_SCALE = 1;
function lineweightMm(P, e, parent, depth = 0) {
  let c = e.lineweight;
  if (c === 29) c = P.layers[e.layer]?.lineweight ?? 31;
  if (c === 30) return parent && depth < 6 ? lineweightMm(P, parent, null, depth + 1) : 0.25;
  if (c === 31 || c === 29 || c == null) return 0.25;
  return LW_MM[c] ?? 0.25;
}
function linetypePattern(P, e) {
  let name = e.lineType;
  if (!name || name === 'ByLayer') name = P.layers[e.layer]?.lineType;
  if (!name || /^(continuous|bylayer|byblock)$/i.test(name)) return null;
  const t = P.db.tables.LTYPE.entries.find(x => x.name === name);
  if (!t?.pattern?.length) return null;
  const d = t.pattern.map(p => Math.max(Math.abs(p.elementLength), 0.05));
  return d.length % 2 ? d.concat(d) : d;
}
const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
function bulge(ctx, a, b, k) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), th = 4 * Math.atan(k), r = d / (2 * Math.sin(th / 2));
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, h = r * Math.cos(th / 2), cx = mx - dy / d * h, cy = my + dx / d * h;
  const a0 = Math.atan2(a.y - cy, a.x - cx), a1 = Math.atan2(b.y - cy, b.x - cx);
  ctx.arc(cx, cy, Math.abs(r), a0, a1, k < 0);
}

function bounds(P, list, out = { x0: 1e30, y0: 1e30, x1: -1e30, y1: -1e30 }, T = [1, 0, 0, 1, 0, 0], depth = 0) {
  const add = (x, y) => { const X = T[0] * x + T[2] * y + T[4], Y = T[1] * x + T[3] * y + T[5]; out.x0 = Math.min(out.x0, X); out.y0 = Math.min(out.y0, Y); out.x1 = Math.max(out.x1, X); out.y1 = Math.max(out.y1, Y); };
  for (const e of list) {
    if (hiddenLayer(P.layers, e.layer)) continue;
    if (e.type === 'LINE') { add(e.startPoint.x, e.startPoint.y); add(e.endPoint.x, e.endPoint.y); }
    else if (e.type === 'LWPOLYLINE') e.vertices?.forEach(v => add(v.x, v.y));
    else if (e.type === 'CIRCLE' || e.type === 'ARC') { add(e.center.x - e.radius, e.center.y - e.radius); add(e.center.x + e.radius, e.center.y + e.radius); }
    else if (e.type === 'INSERT' && P.blocks[e.name] && depth < 6) {
      const sx = e.xScale || 1, sy = e.yScale || 1, r = e.rotation || 0, c = Math.cos(r), s = Math.sin(r);
      bounds(P, P.blocks[e.name].entities || [], out, mul(T, [c * sx, s * sx, -s * sy, c * sy, e.insertionPoint.x, e.insertionPoint.y]), depth + 1);
    }
  }
  return out;
}

async function renderItem(P, which, canvas, layoutName, win = null) {
  PLOT_COLOR = !!renderItem.colour; WARN = {}; // previews follow the colour setting
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const snap = renderItem.snap; renderItem.snap = null; delete ctx.moveTo; delete ctx.lineTo; delete ctx._ns;
  if (snap) hookSnap(ctx, snap);
  const rec = which === 'Model' ? P.model : layoutRecord(P, layoutName);
  const list = entityList(P, rec.handle, rec.name);
  let b;
  let paperU = 1;
  if (which !== 'Model') { const s = paperSize(P, list); paperU = s.u; b = { x0: s.x0, y0: s.y0, x1: s.x0 + s.W, y1: s.y0 + s.H }; } // sheet size (paper-space units)
  else { // model: measure everything that will be painted, text included
    const bc = makeBoundsCtx((t, f) => { mctx.font = f; return mctx.measureText(t).width; }), keep = [PX_PER_MM, MIN_PX, HAIR_PX], w0 = { ...WARN };
    PX_PER_MM = 1; MIN_PX = 0; HAIR_PX = 0; draw(bc, P, list, [1, 0, 0, -1, 0, 0]); WARN = w0; [PX_PER_MM, MIN_PX, HAIR_PX] = keep;
    b = bc.box[0] <= bc.box[2] ? { x0: bc.box[0], y0: -bc.box[3], x1: bc.box[2], y1: -bc.box[1] } : { x0: 0, y0: 0, x1: 100, y1: 100 };
    if (win) b = { x0: win[0], y0: win[1], x1: win[2], y1: win[3] }; // an area: just that rectangle of the model
  }
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  const k = Math.min((canvas.width - 20) / w, (canvas.height - 20) / h);
  const T = [k, 0, 0, -k, 10 - b.x0 * k, canvas.height - 10 + b.y0 * k];
  PX_PER_MM = which === 'Model' ? 1 : k / paperU; MIN_PX = 0.6; HAIR_PX = 0.6; // line weights are millimetres of paper; k is pixels per paper unit
  if (win) { ctx.save(); ctx.transform(...T); ctx.beginPath(); ctx.rect(b.x0, b.y0, w, h); ctx.clip(); ctx.setTransform(1, 0, 0, 1, 0, 0); }
  const vpInfo = drawSpace(ctx, P, which === 'Model' ? inWindow(P, list, win) : list, T, which);
  if (win) ctx.restore();
  if (snap) { delete ctx.moveTo; delete ctx.lineTo; delete ctx._ns; }
  // `map` lets the viewer turn a click on the canvas back into drawing coordinates (x = x0 + (px - 10) / k, y = y0 + (H - 10 - py) / k)
  return { entities: list.length, bounds: b, extentsSize: [w.toFixed(1), h.toFixed(1)], viewports: vpInfo, map: { k, x0: b.x0, y0: b.y0, H: canvas.height, paper: which !== 'Model', u: paperU, snap } };
}
// Collect the canvas-pixel position of every line vertex painted (not lettering), so the measure tool can snap to ends and corners.
function hookSnap(ctx, snap) {
  const seen = new Set(); ctx._ns = 0;
  for (const m of ['moveTo', 'lineTo']) {
    const f = CanvasRenderingContext2D.prototype[m];
    ctx[m] = function (x, y) {
      if (!ctx._ns && snap.length < 600000) { const t = ctx.getTransform(), px = Math.round(t.a * x + t.c * y + t.e), py = Math.round(t.b * x + t.d * y + t.f), key = px * 65536 + py; if (!seen.has(key)) { seen.add(key); snap.push(px, py); } }
      return f.call(ctx, x, y);
    };
  }
}

// Paper-space entities plus each viewport's model-space window, painted through any 2D-context-like object.
function drawSpace(ctx, P, list, T, which) {
  draw(ctx, P, list, T);
  const vpInfo = [];
  if (which !== 'Model') for (const v of list.filter(e => e.type === 'VIEWPORT' && e.viewportId > 1)) {
    // model view centre = target + display centre (the parser stores them as an offset pair)
    let cx = v.targetPoint.x + v.displayCenter.x, cy = v.targetPoint.y + v.displayCenter.y, s = v.height / v.viewHeight;
    const modelList = entityList(P, P.model.handle, P.model.name);
    let win = [cx - v.width / (2 * s), cy - v.height / (2 * s), cx + v.width / (2 * s), cy + v.height / (2 * s)], shown = inWindow(P, modelList, win);
    if (P._ebox?.size && !shown.some(e => P._ebox.has(e)) && !P.xrefs?.some(x => !x.file)) { // nothing paints inside the view (and no missing xref could explain it)
      // the view points at empty space although the model has content (seen in some exported drawings): fit the model into the view instead
      const areas = (P._areas || []).filter(a => a.important), boxes = areas.length ? areas.map(a => a.box) : [...P._ebox.values()];
      const m = boxes.reduce((u, b) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])], [1e30, 1e30, -1e30, -1e30]);
      if (m[2] > m[0] && m[3] > m[1]) { s = Math.min(v.width / (m[2] - m[0]), v.height / (m[3] - m[1])) * 0.95; cx = (m[0] + m[2]) / 2; cy = (m[1] + m[3]) / 2; win = m; shown = modelList; warn('VIEWPORT_FIT'); }
    }
    vpInfo.push({ id: v.viewportId, modelCenter: [cx.toFixed(1), cy.toFixed(1)], scale: s.toFixed(4), s, rect: [v.viewportCenter.x - v.width / 2, v.viewportCenter.y - v.height / 2, v.viewportCenter.x + v.width / 2, v.viewportCenter.y + v.height / 2] });
    ctx.save(); ctx.transform(...T);
    ctx.beginPath(); ctx.rect(v.viewportCenter.x - v.width / 2, v.viewportCenter.y - v.height / 2, v.width, v.height); ctx.clip();
    // model -> paper: scale about the view centre, then move it to the viewport centre
    const M = [s, 0, 0, s, v.viewportCenter.x - cx * s, v.viewportCenter.y - cy * s];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    draw(ctx, P, shown, mul(T, M)); // only the part of the model this viewport can see is written to the page
    ctx.restore();
  }
  return vpInfo;
}

// Plot a layout 1:1 at its own paper size (mm -> points) as a vector PDF.
// options: colour (bool); fit = [w, h] mm to scale the sheet onto a different paper (orientation follows the drawing).
async function plotLayoutPdf(P, layoutName, { colour = false, fit = null, margin = 5 } = {}) {
  PLOT_COLOR = colour; WARN = {};
  const rec = layoutRecord(P, layoutName), list = entityList(P, rec.handle, rec.name), k = 72 / 25.4;
  const { W: Wu, H: Hu, x0, y0, u } = paperSize(P, list), W = Wu * u, H = Hu * u; // W, H in millimetres; u = mm per paper-space unit
  let pw = W, ph = H, s = 1;
  if (fit) { const hi = Math.max(...fit), lo = Math.min(...fit); [pw, ph] = W >= H ? [hi, lo] : [lo, hi]; s = Math.min((pw - 2 * margin) / W, (ph - 2 * margin) / H); }
  const ox = (pw - W * s) / 2, oy = (ph - H * s) / 2; // sheet position on the page, mm from the bottom-left
  const ctx = new PdfCtx(); PX_PER_MM = k; MIN_PX = 0.35; HAIR_PX = 0; // line weights stay true to paper whatever the scale
  ctx.setBase([1, 0, 0, -1, 0, ph * k]); // draw code works top-down like a screen; PDF pages are bottom-up
  const su = s * u; // page points per paper-space unit = su * k
  drawSpace(ctx, P, list, [su * k, 0, 0, -su * k, (ox - x0 * su) * k, (ph - oy + y0 * su) * k], 'Layout');
  const doc = await PDFLib.PDFDocument.create(), page = doc.addPage([pw * k, ph * k]);
  const SF = PDFLib.StandardFonts;
  for (const [res, name] of [['F1', SF.Helvetica], ['F2', SF.HelveticaBold], ['F3', SF.HelveticaOblique], ['F4', SF.TimesRoman], ['F5', SF.Courier], ['F6', SF.Symbol]])
    page.node.setFontDictionary(PDFLib.PDFName.of(res), (await doc.embedFont(name)).ref);
  page.node.addContentStream(doc.context.register(doc.context.stream(ctx.toString()))); await embedImages(doc, page, ctx);
  return { bytes: await doc.save(), size: [pw, ph], sheet: [W, H], scale: s, ops: ctx.out.length, warnings: { ...WARN } };
}

// Sheet size for a layout: the smallest ISO sheet (either orientation) that holds everything drawn in paper space,
// since this parser does not expose the layout's plot settings. Falls back to the content's own size.
const ISO_SHEETS = [[210, 297], [297, 420], [420, 594], [594, 841], [841, 1189]];
function paperSize(P, list) {
  const bc = makeBoundsCtx((t, f) => { mctx.font = f; return mctx.measureText(t).width; });
  const keep = [PX_PER_MM, MIN_PX, HAIR_PX]; PX_PER_MM = 1; MIN_PX = 0; HAIR_PX = 0; const w0 = { ...WARN };
  withAllLayers(() => draw(bc, P, list, [1, 0, 0, -1, 0, 0])); WARN = w0; [PX_PER_MM, MIN_PX, HAIR_PX] = keep;
  let [bx0, by0, bx1, by1] = [bc.box[0], -bc.box[3], bc.box[2], -bc.box[1]];
  for (const v of list.filter(e => e.type === 'VIEWPORT' && e.viewportId > 1)) { bx0 = Math.min(bx0, v.viewportCenter.x - v.width / 2); bx1 = Math.max(bx1, v.viewportCenter.x + v.width / 2); by0 = Math.min(by0, v.viewportCenter.y - v.height / 2); by1 = Math.max(by1, v.viewportCenter.y + v.height / 2); }
  if (!(bx0 <= bx1 && by0 <= by1)) return { W: 420, H: 297, x0: 0, y0: 0, u: 1 }; // nothing paints on this sheet
  // Paper space is measured in the drawing's own unit, which the file does not state. Sheet content only a few units across
  // is metres; an imperial drawing (MEASUREMENT = 0) a few dozen units across is inches; everything else is millimetres.
  // u = millimetres per paper-space unit.
  const span = Math.max(bx1, by1, bx1 - bx0, by1 - by0);
  const u = span < 5 ? 1000 : P.db.header.MEASUREMENT === 0 && span <= 100 ? 25.4 : 1;
  if (bx0 * u >= -2 && by0 * u >= -2) {
    let best = null;
    for (const [a, b] of u === 25.4 ? [...ISO_SHEETS, ...ANSI_SHEETS] : ISO_SHEETS) for (const [W, H] of [[b, a], [a, b]]) if (bx1 * u <= W + 2 && by1 * u <= H + 2 && (!best || W * H < best.W * best.H)) best = { W, H, x0: 0, y0: 0, u };
    if (best) return { ...best, W: best.W / u, H: best.H / u }; // back to paper-space units
  }
  return { W: u === 1 ? Math.ceil(bx1 - bx0) : bx1 - bx0, H: u === 1 ? Math.ceil(by1 - by0) : by1 - by0, x0: bx0, y0: by0, u };
}
// US sheets for imperial drawings: ANSI A-E (Letter, Tabloid, C, D, E) and Architectural A-E (9x12 ... 36x48 in)
const ANSI_SHEETS = [[215.9, 279.4], [279.4, 431.8], [431.8, 558.8], [558.8, 863.6], [863.6, 1117.6], [228.6, 304.8], [304.8, 457.2], [457.2, 609.6], [609.6, 914.4], [914.4, 1219.2]];

// Plot model space to its extents, fitted (centred, with a margin) onto a sheet. Default A3 landscape, 10 mm margin.
async function plotModelExtents(P, { paper = [420, 297], margin = 10, colour = false, window: win = null, orient = 'landscape' } = {}) {
  PLOT_COLOR = colour; WARN = {};
  const list = entityList(P, P.model.handle, P.model.name), k = 72 / 25.4;
  const bc = makeBoundsCtx((t, f) => { mctx.font = f; return mctx.measureText(t).width; });
  PX_PER_MM = 1; MIN_PX = 0; HAIR_PX = 0;
  draw(bc, P, list, [1, 0, 0, -1, 0, 0]); // device y = -drawing y
  // a window [x0, y0, x1, y1] plots just that rectangle of model space instead of everything
  const bx0 = win ? win[0] : bc.box[0], bx1 = win ? win[2] : bc.box[2], by0 = win ? win[1] : -bc.box[3], by1 = win ? win[3] : -bc.box[1], w = bx1 - bx0, h = by1 - by0;
  if (orient === 'auto' && (h > w) !== (paper[1] > paper[0])) paper = [paper[1], paper[0]]; // follow the drawing's shape
  const s = Math.min((paper[0] - 2 * margin) / w, (paper[1] - 2 * margin) / h), sk = s * k;
  const ox = (paper[0] * k - w * sk) / 2, oy = (paper[1] * k - h * sk) / 2;
  const ctx = new PdfCtx(); PX_PER_MM = k; MIN_PX = 0.35; HAIR_PX = 0;
  ctx.setBase([1, 0, 0, -1, 0, paper[1] * k]);
  const T = [sk, 0, 0, -sk, ox - bx0 * sk, paper[1] * k - oy + by0 * sk];
  if (win) { ctx.save(); ctx.transform(...T); ctx.beginPath(); ctx.rect(bx0, by0, w, h); ctx.clip(); ctx.setTransform(1, 0, 0, 1, 0, 0); }
  draw(ctx, P, inWindow(P, list, win), T); // only what falls inside the window goes into the page
  if (win) ctx.restore();
  const doc = await PDFLib.PDFDocument.create(), page = doc.addPage([paper[0] * k, paper[1] * k]), SF = PDFLib.StandardFonts;
  for (const [res, name] of [['F1', SF.Helvetica], ['F2', SF.HelveticaBold], ['F3', SF.HelveticaOblique], ['F4', SF.TimesRoman], ['F5', SF.Courier], ['F6', SF.Symbol]])
    page.node.setFontDictionary(PDFLib.PDFName.of(res), (await doc.embedFont(name)).ref);
  page.node.addContentStream(doc.context.register(doc.context.stream(ctx.toString()))); await embedImages(doc, page, ctx);
  return { bytes: await doc.save(), extents: [bx0, by0, bx1, by1].map(v => +v.toFixed(1)), size: [+w.toFixed(1), +h.toFixed(1)], scale: s, ratio: +(1 / s).toFixed(1), ops: ctx.out.length, warnings: { ...WARN } };
}


// ======================================================================================
// Public API (used by the UI)
// ======================================================================================
const DWG_VERSIONS = { AC1009: 'AutoCAD R12', AC1012: 'AutoCAD R13', AC1014: 'AutoCAD R14', AC1015: 'AutoCAD 2000', AC1018: 'AutoCAD 2004', AC1021: 'AutoCAD 2007', AC1024: 'AutoCAD 2010', AC1027: 'AutoCAD 2013', AC1032: 'AutoCAD 2018 or newer' };

// Read a DWG from an ArrayBuffer. Throws Error('NOT_DWG') or Error('UNREADABLE') with a friendly code in .message.
export async function openDrawing(buf) {
  const bytes = new Uint8Array(buf, 0, Math.min(2048, buf.byteLength)), head = new TextDecoder().decode(bytes.subarray(0, 6));
  const isDwg = /^AC10\d\d$/.test(head); // DXF is the text (or binary) exchange format: "0 / SECTION" near the start
  const isDxf = !isDwg && (/(^|\n)\s*0\s*\r?\n\s*SECTION/.test(new TextDecoder('latin1').decode(bytes)) || new TextDecoder('latin1').decode(bytes.subarray(0, 18)) === 'AutoCAD Binary DXF');
  if (!isDwg && !isDxf) throw new Error('NOT_DWG');
  await loadHershey();
  let P; try { P = isDxf ? makeP(await dxfToDb(decodeDxf(new Uint8Array(buf)))) : await readDwg(buf); } catch (e) { throw Object.assign(new Error('UNREADABLE'), { cause: e }); }
  if (!P.model) throw new Error('UNREADABLE');
  await prepare(P); P.version = isDxf ? 'DXF' : head; P.versionName = isDxf ? 'DXF' : DWG_VERSIONS[head] || head;
  // R14 and older have no "plot this layer" setting; the reader reports 0 for it, which must not mean "do not plot"
  if (isDwg && head < 'AC1015') for (const l of P.db.tables.LAYER.entries) l.plotFlag = 1;
  P.xrefs = findXrefCandidates(P); P.xrefFiles = new Map(); // possible external references and the files supplied for them
  return P;
}

const ISO_NAMES = [[210, 297, 'A4'], [297, 420, 'A3'], [420, 594, 'A2'], [594, 841, 'A1'], [841, 1189, 'A0'],
  [215.9, 279.4, 'Letter'], [279.4, 431.8, 'Tabloid'], [431.8, 558.8, 'ANSI C'], [558.8, 863.6, 'ANSI D'], [863.6, 1117.6, 'ANSI E'],
  [228.6, 304.8, 'Arch A'], [304.8, 457.2, 'Arch B'], [457.2, 609.6, 'Arch C'], [609.6, 914.4, 'Arch D'], [914.4, 1219.2, 'Arch E']];
// "A1 landscape" for an ISO-sized sheet, else "404 x 277 mm"
export function sheetLabel([W, H]) {
  const lo = Math.min(W, H), hi = Math.max(W, H), hit = ISO_NAMES.find(([a, b]) => Math.abs(a - lo) < 4 && Math.abs(b - hi) < 4);
  return hit ? `${hit[2]} ${W >= H ? 'landscape' : 'portrait'}` : `${Math.round(W)} x ${Math.round(H)} mm`;
}

// Everything printable in the drawing: each layout (sheet) and the model space.
export function listItems(P) {
  const items = [];
  const layouts = P.db.objects.LAYOUT.filter(l => l.layoutName !== 'Model').sort((a, b) => a.tabOrder - b.tabOrder);
  for (const l of layouts) {
    const rec = layoutRecord(P, l.layoutName), list = entityList(P, rec.handle, rec.name);
    const content = list.filter(e => e.type !== 'VIEWPORT').length, views = list.filter(e => e.type === 'VIEWPORT' && e.viewportId > 1).length;
    const size = paperSize(P, list), sheet = [size.W * size.u, size.H * size.u]; // millimetres
    items.push({ id: 'layout:' + l.layoutName, kind: 'layout', name: l.layoutName, sheet, label: sheetLabel(sheet), empty: content === 0 && views === 0, count: content + views });
  }
  const m = entityList(P, P.model.handle, P.model.name), areas = m.length ? findAreas(P) : [];
  if (!areas.length) items.push({ id: 'model', kind: 'model', name: 'Whole drawing', empty: m.length === 0, count: m.length });
  else areas.forEach((a, i) => { // each cluster of real content becomes its own printable area, stray objects left out
    const pad = Math.max(a.box[2] - a.box[0], a.box[3] - a.box[1]) * 0.02, win = [a.box[0] - pad, a.box[1] - pad, a.box[2] + pad, a.box[3] + pad];
    items.push({ id: 'area:' + i, kind: 'area', name: areas.length === 1 ? 'Whole drawing' : `Drawing ${i + 1}`, window: win, aspect: (win[2] - win[0]) / (win[3] - win[1]), important: a.important, only: areas.length === 1, empty: false, count: Math.round(a.weight) });
  });
  return items;
}

// Draw a preview of an item onto a canvas (fits the canvas, white background).
export async function drawPreview(P, item, canvas, { colour = false, hidden = [], snap = null } = {}) {
  renderItem.colour = colour; HIDDEN = new Set(hidden); renderItem.snap = snap;
  return renderItem(P, item.kind === 'layout' ? 'Paper' : 'Model', canvas, item.name, item.window);
}

// Plot one item to a single-page PDF.
//   layouts: { colour, fit: [w, h] | null }       model: { colour, paper: [w, h], margin }
export async function plotItem(P, item, opts = {}) {
  HIDDEN = new Set(opts.hidden || []);
  return item.kind !== 'layout' ? plotModelExtents(P, { colour: opts.colour, paper: opts.paper || [420, 297], margin: opts.margin ?? 10, window: item.window || opts.window, orient: item.kind === 'area' ? 'auto' : (opts.orient || 'landscape') })
    : plotLayoutPdf(P, item.name, { colour: opts.colour, fit: opts.fit || null });
}

// Join PDFs (each possibly a different page size) into one document.
export async function mergePdfs(byteArrays) {
  const out = await PDFLib.PDFDocument.create();
  for (const b of byteArrays) { const src = await PDFLib.PDFDocument.load(b); (await out.copyPages(src, src.getPageIndices())).forEach(p => out.addPage(p)); }
  return out.save();
}

// Plain-language notes for the things we could not print faithfully.
// Notes about what could not be drawn. `tr(key, count, vars)` turns a note into the page's language; without it the notes come out in English.
const EN_WARN = {
  'w.ole': n => `${n} embedded picture${n > 1 ? 's/documents are' : '/document is'} not shown (marked with a dashed box)`,
  'w.mline': () => 'Some multi-lines are drawn approximately', 'w.table': () => 'A table in this drawing could not be shown',
  'w.vp': () => 'A view on this sheet could not be placed exactly, so its contents are shown fitted to the view (not to scale)',
  'w.xref': (n, v) => `Linked drawing${n > 1 ? 's' : ''} not added, so not shown: ${v.names}`,
  'w.unknown': (n, v) => `${n} ${v.type} object${n > 1 ? 's' : ''} not shown`,
};
export function describeWarnings(w = {}, tr = (k, n, v) => EN_WARN[k](n, v)) {
  const out = [];
  if (w.OLE2FRAME) out.push(tr('w.ole', w.OLE2FRAME));
  if (w.MLINE) out.push(tr('w.mline'));
  if (w.ACAD_TABLE) out.push(tr('w.table'));
  if (w.VIEWPORT_FIT) out.push(tr('w.vp'));
  const links = Object.keys(w).filter(k => k.startsWith('XREF:')).map(k => k.slice(5));
  if (links.length) out.push(tr('w.xref', links.length, { names: links.join(', ') }));
  for (const [k, v] of Object.entries(w)) if (k.startsWith('UNKNOWN:')) out.push(tr('w.unknown', v, { type: k.slice(8).toLowerCase() }));
  return out;
}

export const lastWarnings = () => ({ ...WARN }); // notes collected by the most recent preview or plot
export { getLib, parse, prepare, renderItem, entityList, layoutRecord, drawText, faceFor, ACI_RGB, SHX, SUPPORTED, IGNORED, paperSize, plotLayoutPdf, plotModelExtents };

// ======================================================================================
// Areas: split model space into the drawings that matter and drop the noise
// ======================================================================================
const HOLLOW = new Set(['LINE', 'LWPOLYLINE', 'POLYLINE2D', '3DFACE', 'ARC', 'CIRCLE']);
const boxArea = b => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const boxHit = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
const boxUnion = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

// Objects whose footprint touches the window [x0, y0, x1, y1] (all of them when there is no window or no footprints yet).
const inWindow = (P, list, win) => (win && P._ebox ? list.filter(e => { const b = P._ebox.get(e); return !b || boxHit(b, win); }) : list);

// Footprint of one object (painted extent, text included), or null if it paints nothing.
function entityBox(bc, P, e) {
  bc.box = [1e30, 1e30, -1e30, -1e30]; bc.pts = []; bc.out.length = 0;
  draw(bc, P, [e], [1, 0, 0, -1, 0, 0]); bc.out.length = 0;
  return bc.box[0] <= bc.box[2] ? [bc.box[0], -bc.box[3], bc.box[2], -bc.box[1]] : null; // an object that paints nothing has no footprint
}

// Returns [{ box, weight, important }] in reading order. box = [x0, y0, x1, y1] in model units.
export function findAreas(P) { return P._areas || withAllLayers(() => findAreasInner(P)); }
function findAreasInner(P) {
  if (P._areas) return P._areas;
  const list = entityList(P, P.model.handle, P.model.name);
  const bc = makeBoundsCtx((t, f) => { mctx.font = f; return mctx.measureText(t).width; });
  const keep = [PX_PER_MM, MIN_PX, HAIR_PX, PLOT_COLOR], w0 = { ...WARN };
  PX_PER_MM = 1; MIN_PX = 0; HAIR_PX = 0; PLOT_COLOR = false;
  const boxes = []; P._ebox = new Map(); // footprints are kept so a plot can skip everything outside its window
  for (const e of list) {
    if (e.type === 'VIEWPORT') continue;
    const b = entityBox(bc, P, e); if (!b) continue;
    P._ebox.set(e, b);
    // weight ~ how much drawing an object stands for; embedded-object placeholders count for almost nothing
    boxes.push({ b, t: e.type, w: e.type === 'OLE2FRAME' ? 0.05 : 1 + (e.type === 'INSERT' ? (P.blocks[e.name]?.entities?.length || 0) : 0) });
  }
  WARN = w0; [PX_PER_MM, MIN_PX, HAIR_PX, PLOT_COLOR] = keep;
  if (!boxes.length) return (P._areas = []);

  const all = boxes.reduce((u, q) => boxUnion(u, q.b), boxes[0].b), allArea = boxArea(all);
  // giant hollow outlines (a frame around everything) must not glue the whole model into one cluster
  const frames = boxes.filter(q => HOLLOW.has(q.t) && boxArea(q.b) > 0.35 * allArea);
  const rest = boxes.filter(q => !frames.includes(q));
  if (!rest.length) return (P._areas = [{ box: all, weight: 1, important: true }]);

  // size the "close enough" distance from the core of the drawing (2nd-98th percentile of object centres), so one object
  // at a silly coordinate cannot stretch it and glue everything together
  const pct = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
  const cxs = rest.map(q => (q.b[0] + q.b[2]) / 2), cys = rest.map(q => (q.b[1] + q.b[3]) / 2);
  const lo = rest.length >= 30 ? 0.02 : 0, hi = rest.length >= 30 ? 0.98 : 1;
  const u0 = [pct(cxs, lo), pct(cys, lo), pct(cxs, hi), pct(cys, hi)];
  const d = Math.max(0.012 * Math.hypot(u0[2] - u0[0], u0[3] - u0[1]), 1e-6);
  // anything much bigger than the core of the drawing is a stray (or a frame in disguise): leave it out of the grouping
  const L = 3 * Math.max(u0[2] - u0[0], u0[3] - u0[1], d), pool = rest.filter(q => q.b[2] - q.b[0] <= L && q.b[3] - q.b[1] <= L);
  if (!pool.length) return (P._areas = [{ box: all, weight: 1, important: true }]);
  // union-find over boxes that come within d of each other (spatial hash keeps it fast)
  const parent = pool.map((_, i) => i), find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const cell = d * 2, grid = new Map(), dil = pool.map(q => [q.b[0] - d / 2, q.b[1] - d / 2, q.b[2] + d / 2, q.b[3] + d / 2]), bigs = [];
  dil.forEach((b, i) => {
    const x0 = Math.floor(b[0] / cell), x1 = Math.floor(b[2] / cell), y0 = Math.floor(b[1] / cell), y1 = Math.floor(b[3] / cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 600) { bigs.push(i); return; } // too many cells: compare directly below
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const k = x + ',' + y, bucket = grid.get(k) || grid.set(k, []).get(k);
      for (const j of bucket) if (boxHit(dil[j], b)) parent[find(i)] = find(j);
      bucket.push(i);
    }
  });
  for (const i of bigs) for (let j = 0; j < dil.length; j++) if (j !== i && boxHit(dil[i], dil[j])) parent[find(i)] = find(j);
  const groups = new Map();
  pool.forEach((q, i) => { const r = find(i), g = groups.get(r); if (g) { g.box = boxUnion(g.box, q.b); g.weight += q.w; } else groups.set(r, { box: q.b.slice(), weight: q.w }); });

  // noise filter: tiny clusters are stray objects
  const total = [...groups.values()].reduce((s, g) => s + g.weight, 0), minW = Math.max(Math.min(3, total * 0.5), 0.015 * total);
  let areas = [...groups.values()].filter(g => g.weight >= minW).sort((a, b) => b.weight - a.weight).slice(0, 40);
  // a sheet border around a cluster belongs to it (but an enormous empty frame does not)
  for (const f of frames.sort((a, b) => boxArea(a.b) - boxArea(b.b))) {
    const a = areas.find(g => g.box[0] >= f.b[0] - d && g.box[1] >= f.b[1] - d && g.box[2] <= f.b[2] + d && g.box[3] <= f.b[3] + d && boxArea(f.b) <= 4 * boxArea(g.box));
    if (a) a.box = boxUnion(a.box, f.b);
  }
  const top = areas.length ? areas[0].weight : 0;
  areas.forEach(a => { a.important = a.weight >= 0.25 * top; });
  // reading order: along the longer direction of the whole drawing
  const wide = (u0[2] - u0[0]) >= (u0[3] - u0[1]);
  areas.sort(wide ? (a, b) => a.box[0] - b.box[0] : (a, b) => b.box[3] - a.box[3]);
  return (P._areas = areas);
}

// ======================================================================================
// External references (xrefs): other drawings that a drawing displays inside itself.
// The parser does not flag them or give their file path. In the file an xref is an EMPTY block named after the
// referenced drawing, so we treat "empty block that gets inserted" as a possible xref and fill it only when the user
// supplies a DWG with the matching file name.
// ======================================================================================
export function xrefKey(name) { return String(name || '').replace(/^.*[\\/]/, '').replace(/\.(dwg|dxf)$/i, '').trim().toLowerCase(); }

// Empty blocks that are actually inserted somewhere: [{ name, key, uses, file }]
export function findXrefCandidates(P) {
  const empty = new Set(P.db.tables.BLOCK_RECORD.entries.filter(b => !b.name.startsWith('*') && !(b.entities || []).length).map(b => b.name));
  if (!empty.size) return [];
  const uses = new Map(), count = list => { for (const e of list) if (e.type === 'INSERT' && empty.has(e.name)) uses.set(e.name, (uses.get(e.name) || 0) + 1); };
  count(P.db.entities); for (const b of P.db.tables.BLOCK_RECORD.entries) if (!b.name.startsWith('*')) count(b.entities || []);
  return [...uses].map(([name, n]) => ({ name, key: xrefKey(name), uses: n, file: null }));
}

function resetCaches(P) { delete P._areas; delete P._ebox; }

// Fill the xref called like this file with the (already opened, or raw) drawing. Returns the xref entry, or null if the
// file is not one this drawing links to.
export async function attachXref(P, fileName, source) {
  const key = xrefKey(fileName), ref = P.xrefs.find(x => x.key === key);
  if (!ref) return null;
  const XP = source instanceof ArrayBuffer ? await openDrawing(source) : source;
  if (XP === P) return null;
  XP.xrefFiles = P.xrefFiles; P.xrefFiles.set(key, XP); ref.file = fileName;
  for (const c of XP.xrefs) if (!P.xrefs.some(x => x.key === c.key)) P.xrefs.push({ ...c, nested: true }); // the xref may link to more
  resetCaches(P);
  return ref;
}

// Open one or more files given together: the one that links to the others is the main drawing, the rest are its xrefs.
// files: [{ name, buf }]. Returns { P, used: [names], ignored: [names] }.
export async function openSet(files) {
  const opened = [];
  for (const f of files) opened.push({ name: f.name, P: await openDrawing(f.buf) });
  if (opened.length === 1) return { P: opened[0].P, used: [], ignored: [] };
  const score = o => opened.filter(x => x !== o && o.P.xrefs.some(r => r.key === xrefKey(x.name))).length;
  const main = opened.reduce((best, o) => (score(o) > score(best) ? o : best), opened[0]);
  const used = [], ignored = [];
  for (const o of opened) if (o !== main) (await attachXref(main.P, o.name, o.P)) ? used.push(o.name) : ignored.push(o.name);
  main.P.mainName = main.name;
  return { P: main.P, used, ignored, mainName: main.name };
}

// ======================================================================================
// Viewer helpers: layers and units
// ======================================================================================
// The layers a drawing really uses (with how many objects sit on each), for the layer panel.
// `off` marks layers the drawing itself keeps hidden or non-plotting; those stay off.
export function listLayers(P) {
  const count = new Map(), bump = list => { for (const e of list) count.set(e.layer, (count.get(e.layer) || 0) + 1); };
  const drawings = [P, ...(P.xrefFiles ? [...P.xrefFiles.values()] : [])]; // layers of supplied xrefs are listed too
  for (const D of drawings) { bump(D.db.entities); for (const b of D.db.tables.BLOCK_RECORD.entries) if (!b.name.startsWith('*')) bump(b.entities || []); }
  const out = new Map();
  for (const D of drawings) for (const l of D.db.tables.LAYER.entries) {
    const n = count.get(l.name) || 0; if (!n || out.has(l.name)) continue;
    const ci = Math.abs(l.colorIndex), tc = l.color != null && l.color !== 16777215 && ACI_RGB[ci] && (ACI_RGB[ci][0] << 16 | ACI_RGB[ci][1] << 8 | ACI_RGB[ci][2]) !== l.color ? intRgb(l.color) : null;
    const rgb = tc || (ci && ci !== 7 && ci !== 256 && ACI_RGB[ci] ? rgbStr(...ACI_RGB[ci]) : '#6b7280');
    out.set(l.name, { name: l.name, count: n, color: rgb, off: !!(l.frozen || l.off || l.colorIndex < 0 || l.plotFlag === false || l.plotFlag === 0) });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

// What one drawing unit is, from the drawing's INSUNITS setting: { label, mm } (mm = millimetres per unit, or 0 if unitless).
export function drawingUnits(P) {
  const U = { 1: ['in', 25.4], 2: ['ft', 304.8], 3: ['mi', 1609344], 4: ['mm', 1], 5: ['cm', 10], 6: ['m', 1000], 7: ['km', 1e6] }[P.db.header.INSUNITS];
  return U ? { label: U[0], mm: U[1] } : { label: 'units', mm: 0 };
}

// Points along a B-spline given as degree, knots and control points (de Boor). Weights are ignored.
function splinePoints(sp) {
  const p = sp.degree || 3, cp = sp.controlPoints, kn = sp.knots, n = cp.length - 1, out = [];
  if (!kn || kn.length < n + p + 2) return cp; // not enough data: fall back to the control polygon
  const t0 = kn[p], t1 = kn[n + 1], steps = Math.max(24, n * 8);
  for (let s = 0; s <= steps; s++) {
    const t = Math.min(t1 - 1e-9, t0 + (t1 - t0) * s / steps); let k = p; while (k < n && t >= kn[k + 1]) k++;
    const d = []; for (let j = 0; j <= p; j++) d.push({ x: cp[j + k - p].x, y: cp[j + k - p].y });
    for (let r = 1; r <= p; r++) for (let j = p; j >= r; j--) {
      const den = kn[j + 1 + k - r] - kn[j + k - p], a = den ? (t - kn[j + k - p]) / den : 0;
      d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y };
    }
    out.push(d[p]);
  }
  return out;
}
// DXF text is UTF-8 from AutoCAD 2007 on, and a Windows code page before that
function decodeDxf(bytes) { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return new TextDecoder('windows-1252').decode(bytes); } }
// Pictures of lettering the PDF fonts cannot write (see PdfCtx._rasterText): put them in the page's resources
async function embedImages(doc, page, ctx) {
  for (const im of ctx.images || []) {
    const blob = await new Promise(r => im.canvas.toBlob(r, 'image/png'));
    const img = await doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
    page.node.setXObject(PDFLib.PDFName.of(im.name), img.ref);
  }
}
