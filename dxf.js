// DXF reader: turns a text DXF into the same drawing structure the DWG reader gives the engine, so one renderer serves both.
// Model space only (paper-space layouts are not read from DXF). Uses the MIT-licensed dxf-parser, served from ./vendor/.
let Parser;
async function getParser() {
  if (Parser) return Parser;
  const src = await (await fetch(new URL('./vendor/dxf-parser.js', import.meta.url))).text(), m = { exports: {} };
  new Function('module', 'exports', src)(m, m.exports); // the file is a UMD bundle
  return (Parser = m.exports.default || m.exports);
}

// The parser has no HATCH or LEADER reader, so these are added here (they print as fills and arrows on most drawings).
function common(o, c) { // the group codes every entity shares
  switch (c.code) { case 8: o.layer = c.value; return true; case 62: o.colorIndex = c.value; return true; case 6: o.lineType = c.value; return true; case 370: o.lineweight = c.value; return true; case 5: o.handle = c.value; return true; case 67: o.inPaperSpace = !!c.value; return true; }
  return false;
}
class HatchReader {
  constructor() { this.ForEntityName = 'HATCH'; }
  parseEntity(sc, cur) {
    const h = { type: 'HATCH', boundaryPaths: [], solidFill: false }; let mode = 0, path = null, edge = null, px = 0, qx = 0;
    for (cur = sc.next(); !sc.isEOF() && cur.code !== 0; cur = sc.next()) {
      const v = cur.value, poly = path && path.polyline;
      if (common(h, cur)) continue;
      switch (cur.code) {
        case 70: if (mode < 2) h.solidFill = v === 1; break;
        case 91: mode = 1; break;
        case 75: mode = 2; break;
        case 92: if (mode === 1) { path = { polyline: !!(v & 2), vertices: [], edges: [] }; h.boundaryPaths.push(path); edge = null; } break;
        case 72: if (mode === 1 && path && !path.polyline) { edge = { type: v }; path.edges.push(edge); } break;
        case 73: if (mode === 1 && edge) edge.isCCW = v === 1; break;
        case 10: px = v; break;
        case 20: if (mode === 1 && path) { const p = { x: px, y: v }; if (poly) path.vertices.push(p); else if (edge) { if (edge.type === 1) edge.start = p; else if (edge.type === 4) (edge.controlPoints ||= []).push(p); else edge.center = p; } } break;
        case 11: qx = v; break;
        case 21: if (mode === 1 && edge && (edge.type === 1 || edge.type === 3)) edge.end = { x: qx, y: v }; break;
        case 42: if (mode === 1 && poly && path.vertices.length) path.vertices[path.vertices.length - 1].bulge = v; break;
        case 40: if (mode === 1 && edge) { if (edge.type === 2) edge.radius = v; else if (edge.type === 3) edge.lengthOfMinorAxis = v; } break;
        case 50: if (mode === 1 && edge) edge.startAngle = rad(v); break;
        case 51: if (mode === 1 && edge) edge.endAngle = rad(v); break;
      }
    }
    for (const bp of h.boundaryPaths) { // spline pieces: joined through their control points
      bp.edges = bp.edges.flatMap(e => e.type !== 4 ? [e] : (e.controlPoints || []).slice(1).map((p, i) => ({ type: 1, start: e.controlPoints[i], end: p })));
    }
    return h;
  }
}
class LeaderReader {
  constructor() { this.ForEntityName = 'LEADER'; }
  parseEntity(sc, cur) {
    const l = { type: 'LEADER', vertices: [] }; let px = 0;
    for (cur = sc.next(); !sc.isEOF() && cur.code !== 0; cur = sc.next()) {
      if (common(l, cur)) continue;
      if (cur.code === 71) l.isArrowheadEnabled = cur.value === 1; else if (cur.code === 10) px = cur.value; else if (cur.code === 20) l.vertices.push({ x: px, y: cur.value });
    }
    return l;
  }
}

const MODEL = 'M0', PAPER = 'P0';
const LW = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211]; // lineweight index -> hundredths of mm
const rad = d => (d || 0) * Math.PI / 180;
const lwIndex = v => v == null || v === -1 ? 29 : v === -2 ? 30 : v < 0 ? 31 : LW.reduce((b, x, i) => (Math.abs(x - v) < Math.abs(LW[b] - v) ? i : b), 0);

let seq = 0;
function convert(e) {
  const o = { type: e.type, handle: 'D' + (++seq), layer: e.layer || '0', colorIndex: e.colorIndex == null ? 256 : e.colorIndex, lineType: e.lineType, lineweight: lwIndex(e.lineweight), lineTypeScale: e.lineTypeScale };
  const v = e.vertices || [];
  switch (e.type) {
    case 'LINE': if (v.length < 2) return null; return { ...o, startPoint: v[0], endPoint: v[1] };
    case 'LWPOLYLINE': return { ...o, vertices: v, flag: e.shape ? 1 : 0 };
    case 'POLYLINE': return { ...o, type: e.is3dPolyline ? 'POLYLINE3D' : 'POLYLINE2D', vertices: v.map(q => ({ ...q, flag: q.flag || 0 })), flag: e.shape ? 1 : 0 };
    case 'CIRCLE': case 'ARC': return { ...o, center: e.center, radius: e.radius, startAngle: e.startAngle, endAngle: e.endAngle };
    case 'ELLIPSE': return { ...o, center: e.center, majorAxisEndPoint: e.majorAxisEndPoint, axisRatio: e.axisRatio, startAngle: e.startAngle ?? 0, endAngle: e.endAngle ?? 2 * Math.PI };
    case 'SPLINE': return { ...o, controlPoints: e.controlPoints, fitPoints: e.fitPoints };
    case 'SOLID': { const p = e.points || []; return { ...o, corner1: p[0], corner2: p[1], corner3: p[2], corner4: p[3] }; }
    case '3DFACE': return { ...o, corner1: v[0], corner2: v[1], corner3: v[2], corner4: v[3] || v[2], flag: 0 };
    case 'TEXT': return { ...o, text: e.text, startPoint: e.startPoint, endPoint: e.endPoint, textHeight: e.textHeight, rotation: rad(e.rotation), xScale: e.xScale, halign: e.halign || 0, valign: e.valign || 0, styleName: e.styleName };
    case 'MTEXT': return { ...o, text: e.text, insertionPoint: e.position, textHeight: e.height, rectWidth: e.width, attachmentPoint: e.attachmentPoint, rotation: rad(e.rotation), styleName: e.styleName };
    case 'INSERT': return { ...o, name: e.name, insertionPoint: e.position, xScale: e.xScale, yScale: e.yScale, rotation: rad(e.rotation) };
    case 'DIMENSION': return { ...o, name: e.block };
    case 'HATCH': return { ...o, boundaryPaths: e.boundaryPaths, solidFill: e.solidFill };
    case 'LEADER': return { ...o, vertices: e.vertices, isArrowheadEnabled: e.isArrowheadEnabled };
    default: return null; // points, attributes, hatches and the like are not read from DXF
  }
}

// Text styles (name -> font file, width factor): the parser skips this table, so it is read straight from the text.
function readStyles(text) {
  const a = text.split(/\r?\n/), out = []; let i = 0;
  while (i < a.length - 3 && !(a[i].trim() === '0' && a[i + 1].trim() === 'TABLE' && a[i + 2].trim() === '2' && a[i + 3].trim().toUpperCase() === 'STYLE')) i++;
  let cur = null;
  for (i += 4; i < a.length - 1; i += 2) {
    const code = +a[i], val = a[i + 1].trim();
    if (code === 0) { if (val === 'ENDTAB') break; cur = val === 'STYLE' ? { name: '', font: '', widthFactor: 1 } : null; if (cur) out.push(cur); }
    else if (cur) { if (code === 2) cur.name = val; else if (code === 3) cur.font = val; else if (code === 41) cur.widthFactor = +val || 1; }
  }
  return out;
}

// Layers read straight from the text as well, because the parser drops each layer's linetype and lineweight.
function readLayers(text) {
  const a = text.split(/\r?\n/), out = []; let i = 0;
  while (i < a.length - 3 && !(a[i].trim() === '0' && a[i + 1].trim() === 'TABLE' && a[i + 2].trim() === '2' && a[i + 3].trim().toUpperCase() === 'LAYER')) i++;
  let cur = null;
  for (i += 4; i < a.length - 1; i += 2) {
    const code = +a[i], val = a[i + 1].trim();
    if (code === 0) { if (val === 'ENDTAB') break; cur = val === 'LAYER' ? { name: '0', colorIndex: 7, frozen: false, off: false, lineType: 'Continuous', lineweight: 29, plotFlag: 1 } : null; if (cur) out.push(cur); }
    else if (cur) {
      if (code === 2) cur.name = val; else if (code === 6) cur.lineType = val; else if (code === 370) cur.lineweight = lwIndex(+val);
      else if (code === 70) cur.frozen = !!(+val & 1); else if (code === 290) cur.plotFlag = +val ? 1 : 0;
      else if (code === 62) { const c = +val; cur.off = c < 0; cur.colorIndex = c || 7; }
    }
  }
  return out;
}

// Returns the `db` object the engine expects (tables, blocks, entities, header), or throws.
export async function dxfToDb(text) {
  const parser = new (await getParser())(); parser.registerEntityHandler(HatchReader); parser.registerEntityHandler(LeaderReader);
  const D = parser.parseSync(text), H = D.header || {};
  const layers = readLayers(text);
  if (!layers.some(l => l.name === '0')) layers.push({ name: '0', colorIndex: 7, lineweight: 31, plotFlag: 1 });
  const ltypes = Object.values(D.tables?.lineType?.lineTypes || {}).map(t => ({ name: t.name, pattern: (t.pattern || []).map(n => ({ elementLength: n })) }));
  const entities = [], records = [{ name: '*Model_Space', handle: MODEL }, { name: '*Paper_Space', handle: PAPER }];
  for (const e of D.entities || []) { if (e.inPaperSpace) continue; const c = convert(e); if (c) { c.ownerBlockRecordSoftId = MODEL; entities.push(c); } }
  for (const [name, b] of Object.entries(D.blocks || {})) {
    if (/^\*(model|paper)_space/i.test(name)) continue;
    records.push({ name, handle: 'B' + records.length, entities: (b.entities || []).map(convert).filter(Boolean) });
  }
  return {
    entities, header: { LTSCALE: H.$LTSCALE || 1, MEASUREMENT: H.$MEASUREMENT ?? 1, INSUNITS: H.$INSUNITS ?? 0, INSBASE: H.$INSBASE || { x: 0, y: 0 } },
    tables: { BLOCK_RECORD: { entries: records }, LAYER: { entries: layers }, LTYPE: { entries: ltypes }, STYLE: { entries: readStyles(text) } }, objects: { LAYOUT: [] },
  };
}
