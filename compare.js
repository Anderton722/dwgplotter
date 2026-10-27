// Extract text and vector segments from a PDF (page 1) so two plots can be compared numerically.
window.extractPdf = async function (bytes) {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise, pg = await doc.getPage(1);
  const O = pdfjsLib.OPS, tc = await pg.getTextContent(), ops = await pg.getOperatorList();
  const texts = tc.items.filter(i => i.str.trim()).map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], h: Math.hypot(i.transform[2], i.transform[3]), w: i.width, rot: Math.atan2(i.transform[1], i.transform[0]) }));
  const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
  let ctm = [1, 0, 0, 1, 0, 0], lw = 1, stack = [], segs = [], clipN = 0;
  const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const f = ops.fnArray[i], a = ops.argsArray[i];
    if (f === O.save) stack.push([ctm, lw]);
    else if (f === O.restore) [ctm, lw] = stack.pop() || [ctm, lw];
    else if (f === O.transform) ctm = mul(ctm, a);
    else if (f === O.setLineWidth) lw = a[0];
    else if (f === O.constructPath) {
      const [pops, co] = a; let k = 0, cur = null, start = null; const sub = [];
      const push = p => { cur = p; sub.push(p); };
      for (const op of pops) {
        if (op === O.moveTo) { start = [co[k], co[k + 1]]; k += 2; cur = start; sub.push(null, start); }
        else if (op === O.lineTo) { push([co[k], co[k + 1]]); k += 2; }
        else if (op === O.curveTo) { const c = [cur, [co[k], co[k + 1]], [co[k + 2], co[k + 3]], [co[k + 4], co[k + 5]]]; k += 6; for (let t = 1; t <= 8; t++) { const u = t / 8, v = 1 - u; push([0, 1].map(d => v * v * v * c[0][d] + 3 * v * v * u * c[1][d] + 3 * v * u * u * c[2][d] + u * u * u * c[3][d])); } }
        else if (op === O.curveTo2) { const c = [cur, cur, [co[k], co[k + 1]], [co[k + 2], co[k + 3]]]; k += 4; push(c[3]); }
        else if (op === O.curveTo3) { push([co[k + 2], co[k + 3]]); k += 4; }
        else if (op === O.rectangle) { const [x, y, w, h] = [co[k], co[k + 1], co[k + 2], co[k + 3]]; k += 4; sub.push(null, [x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]); cur = [x, y]; }
        else if (op === O.closePath) { if (start) push(start); }
      }
      // keep the path for the following paint operator
      ops._p = sub;
    } else if (f === O.stroke || f === O.closeStroke || f === O.fillStroke || f === O.closeFillStroke || f === O.fill || f === O.eoFill) {
      const sub = ops._p || [], wsc = lw * Math.hypot(ctm[0], ctm[1]); let prev = null;
      for (const p of sub) { if (p === null) { prev = null; continue; } const P = ap(ctm, p[0], p[1]); if (prev) segs.push([prev[0], prev[1], P[0], P[1], wsc, f === O.fill || f === O.eoFill ? 1 : 0]); prev = P; }
      ops._p = null;
    } else if (f === O.endPath || f === O.clip) { ops._p = null; }
  }
  return { texts, segs, view: pg.view };
};

// Render both PDFs onto the reference page grid (ours transformed by the fitted alignment) and compare ink.
// Returns metrics plus a diff canvas: black = both, red = only in reference (we are missing it), blue = only ours.
window.pixelDiff = async function (oursBytes, refBytes, fit, S = 1, tol = 2) {
  const load = async b => (await (await pdfjsLib.getDocument({ data: b.slice() }).promise).getPage(1));
  const rp = await load(refBytes), op = await load(oursBytes), W = Math.ceil(rp.view[2] * S), H = Math.ceil(rp.view[3] * S);
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); return c; };
  const cr = mk(), co = mk();
  await rp.render({ canvasContext: cr.getContext('2d'), viewport: rp.getViewport({ scale: S }) }).promise;
  const oh = op.view[3];
  await op.render({ canvasContext: co.getContext('2d'), viewport: op.getViewport({ scale: fit.s * S, offsetX: fit.ex * S, offsetY: (rp.view[3] - fit.ey - oh * fit.s) * S }) }).promise;
  const ink = c => { const d = c.getContext('2d').getImageData(0, 0, W, H).data, a = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) a[i] = d[i * 4] < 170 ? 1 : 0; return a; };
  const R = ink(cr), O = ink(co);
  const near = (a, x, y) => { for (let j = -tol; j <= tol; j++) { const Y = y + j; if (Y < 0 || Y >= H) continue; for (let i = -tol; i <= tol; i++) { const X = x + i; if (X >= 0 && X < W && a[Y * W + X]) return true; } } return false; };
  const out = document.createElement('canvas'); out.width = W; out.height = H; const x = out.getContext('2d'), im = x.createImageData(W, H);
  let rInk = 0, rHit = 0, oInk = 0, oHit = 0; const missRows = new Float32Array(Math.ceil(H / 40)), missCols = new Float32Array(Math.ceil(W / 40));
  for (let y = 0; y < H; y++) for (let X = 0; X < W; X++) {
    const i = y * W + X, r = R[i], o = O[i]; let c = [255, 255, 255];
    if (r) { rInk++; if (near(O, X, y)) { rHit++; c = o ? [0, 0, 0] : [150, 150, 150]; } else { c = [230, 0, 0]; missRows[y / 40 | 0]++; missCols[X / 40 | 0]++; } }
    if (o) { oInk++; if (near(R, X, y)) { oHit++; if (!r) c = [150, 150, 150]; } else c = [0, 90, 255]; }
    im.data[i * 4] = c[0]; im.data[i * 4 + 1] = c[1]; im.data[i * 4 + 2] = c[2]; im.data[i * 4 + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  return { recall: +(rHit / rInk).toFixed(4), precision: +(oHit / oInk).toFixed(4), refInk: rInk, oursInk: oInk, canvas: out, refCanvas: cr, oursCanvas: co };
};

// Vector match: for every reference segment (>= minLen pt) is there a segment of ours (after alignment) on the same line
// that overlaps most of it? Ignores raster effects. Returns rate plus the unmatched reference segments.
window.segMatch = function (A, B, f, minLen = 8, tol = 1.2) {
  const ours = A.segs.map(g => [f.s * g[0] + f.ex, f.s * g[1] + f.ey, f.s * g[2] + f.ex, f.s * g[3] + f.ey]);
  const cell = 60, grid = new Map(), add = (k, i) => { (grid.get(k) || grid.set(k, []).get(k)).push(i); };
  ours.forEach((g, i) => { const x0 = Math.min(g[0], g[2]) / cell | 0, x1 = Math.max(g[0], g[2]) / cell | 0, y0 = Math.min(g[1], g[3]) / cell | 0, y1 = Math.max(g[1], g[3]) / cell | 0; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) add(x + ',' + y, i); });
  let n = 0, hit = 0; const un = [];
  for (const g of B.segs) {
    const L = Math.hypot(g[2] - g[0], g[3] - g[1]); if (L < minLen) continue; n++;
    const ux = (g[2] - g[0]) / L, uy = (g[3] - g[1]) / L; let best = 0;
    const cand = new Set(); const x0 = Math.min(g[0], g[2]) / cell | 0, x1 = Math.max(g[0], g[2]) / cell | 0, y0 = Math.min(g[1], g[3]) / cell | 0, y1 = Math.max(g[1], g[3]) / cell | 0;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) (grid.get(x + ',' + y) || []).forEach(i => cand.add(i));
    for (const i of cand) {
      const o = ours[i], d1 = Math.abs((o[0] - g[0]) * uy - (o[1] - g[1]) * ux), d2 = Math.abs((o[2] - g[0]) * uy - (o[3] - g[1]) * ux);
      if (d1 > tol || d2 > tol) continue; // not collinear
      const t1 = (o[0] - g[0]) * ux + (o[1] - g[1]) * uy, t2 = (o[2] - g[0]) * ux + (o[3] - g[1]) * uy;
      best = Math.max(best, Math.max(0, Math.min(L, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2))) / L);
      if (best > 0.7) break;
    }
    if (best > 0.7) hit++; else un.push(g);
  }
  return { n, hit, rate: +(hit / n).toFixed(4), unmatched: un };
};

// Align on the sheet border: the bounding box of the very long lines in each plot.
window.frameFit = function (A, B) {
  const bb = segs => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const g of segs) { if (Math.hypot(g[2] - g[0], g[3] - g[1]) < 1000) continue; for (const [x, y] of [[g[0], g[1]], [g[2], g[3]]]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } } return [x0, y0, x1, y1]; };
  const a = [0, 0, A.view[2], A.view[3]], b = bb(B.segs), sx = (b[2] - b[0]) / (a[2] - a[0]), sy = (b[3] - b[1]) / (a[3] - a[1]), s = (sx + sy) / 2;
  return { s, ex: b[0] - s * a[0], ey: b[1] - s * a[1], sx, sy, ourBox: a, refBox: b };
};

// Robust fit (RANSAC over unique-text pairs): ref = s*ours + e. Returns {s,ex,ey,inliers,pairs}.
window.robustFit = function (A, B) {
  const key = t => t.s.trim().replace(/\s+/g, ' '), co = {}, cr = {};
  A.texts.forEach(t => co[key(t)] = (co[key(t)] || 0) + 1); B.texts.forEach(t => cr[key(t)] = (cr[key(t)] || 0) + 1);
  const pairs = []; for (const t of A.texts) { const k = key(t); if (co[k] === 1 && cr[k] === 1 && k.length > 2) pairs.push([t, B.texts.find(r => key(r) === k)]); }
  let best = { inl: -1 };
  for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
    const [a1, b1] = pairs[i], [a2, b2] = pairs[j], dx = a2.x - a1.x, dy = a2.y - a1.y; if (Math.hypot(dx, dy) < 300) continue;
    const s = Math.hypot(b2.x - b1.x, b2.y - b1.y) / Math.hypot(dx, dy), ex = b1.x - s * a1.x, ey = b1.y - s * a1.y;
    const inl = pairs.filter(([a, b]) => Math.hypot(s * a.x + ex - b.x, s * a.y + ey - b.y) < 6).length;
    if (inl > best.inl) best = { inl, s, ex, ey };
  }
  return { ...best, pairs: pairs.length };
};

// Text comparison after alignment: how many of the reference's strings we reproduce, in the right place and size.
window.textReport = function (A, B, f) {
  const key = t => t.s.trim().replace(/\s+/g, ' ');
  const OA = A.texts.map(t => ({ ...t, x: f.s * t.x + f.ex, y: f.s * t.y + f.ey, h: t.h * f.s })), tol = 6;
  let exact = 0, wrongPlace = 0; const missing = [], hr = [], dist = [];
  for (const r of B.texts) {
    const same = OA.filter(o => key(o) === key(r));
    if (!same.length) { missing.push(r.s.trim().slice(0, 34) + ' @' + r.x.toFixed(0) + ',' + r.y.toFixed(0)); continue; }
    const near = same.reduce((b, o) => (Math.hypot(o.x - r.x, o.y - r.y) < Math.hypot(b.x - r.x, b.y - r.y) ? o : b));
    const d = Math.hypot(near.x - r.x, near.y - r.y);
    if (d < tol) { exact++; hr.push(near.h / r.h); } else { wrongPlace++; dist.push(r.s.trim().slice(0, 24) + ' d=' + d.toFixed(0) + ' ours@' + near.x.toFixed(0) + ',' + near.y.toFixed(0) + ' ref@' + r.x.toFixed(0) + ',' + r.y.toFixed(0)); }
  }
  const refKeys = new Set(B.texts.map(key)), extra = OA.filter(o => !refKeys.has(key(o))).map(o => o.s.trim().slice(0, 30));
  const med = a => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : 0);
  return { refTexts: B.texts.length, oursTexts: A.texts.length, exact, wrongPlace, missing: missing.length, extra: extra.length, medianHeightRatio: +med(hr).toFixed(3), missingSample: missing.slice(0, 10), wrongSample: dist.slice(0, 8), extraSample: extra.slice(0, 10) };
};

// Fit ref = s*ours + (ex,ey) from text strings that appear once in each plot (least squares, uniform scale).
window.fitAlign = function (ours, ref) {
  const key = t => t.s.trim(), count = (arr) => { const m = {}; arr.forEach(t => m[key(t)] = (m[key(t)] || 0) + 1); return m; };
  const co = count(ours.texts), cr = count(ref.texts), pairs = [];
  for (const t of ours.texts) { const k = key(t); if (co[k] === 1 && cr[k] === 1 && k.length > 2) pairs.push([t, ref.texts.find(r => key(r) === k)]); }
  const n = pairs.length; if (n < 3) return { n, error: 'too few text matches' };
  const mx = pairs.reduce((s, [a]) => s + a.x, 0) / n, my = pairs.reduce((s, [a]) => s + a.y, 0) / n, rx = pairs.reduce((s, [, b]) => s + b.x, 0) / n, ry = pairs.reduce((s, [, b]) => s + b.y, 0) / n;
  let num = 0, den = 0; for (const [a, b] of pairs) { num += (a.x - mx) * (b.x - rx) + (a.y - my) * (b.y - ry); den += (a.x - mx) ** 2 + (a.y - my) ** 2; }
  const s = num / den, ex = rx - s * mx, ey = ry - s * my;
  const res = pairs.map(([a, b]) => Math.hypot(s * a.x + ex - b.x, s * a.y + ey - b.y)).sort((p, q) => p - q);
  return { n, s, ex, ey, medianErr: res[res.length >> 1], p90: res[Math.floor(res.length * .9)] };
};
