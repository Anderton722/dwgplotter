// A minimal CanvasRenderingContext2D look-alike that records PDF content-stream operators,
// so the same draw() code can paint the screen preview and write a vector PDF.
const f = n => (Math.abs(n) < 1e-9 ? 0 : +n.toFixed(4));
// compose(A, B): apply B first, then A (same convention as mul() in spike.js)
const compose = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
const invert = m => { const d = m[0] * m[3] - m[1] * m[2]; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; };

// Runs the same draw code but only measures: the bounding box of everything that would be painted (device space).
export function makeBoundsCtx(measureText) { return new (class extends PdfCtx {
  constructor() { super(); this.box = [1e30, 1e30, -1e30, -1e30]; this.pts = []; this.mt = measureText; }
  _pt(x, y) { const m = this.ctm, X = m[0] * x + m[2] * y + m[4], Y = m[1] * x + m[3] * y + m[5]; this.pts.push([X, Y]); }
  _commit() { for (const [X, Y] of this.pts) { this.box[0] = Math.min(this.box[0], X); this.box[1] = Math.min(this.box[1], Y); this.box[2] = Math.max(this.box[2], X); this.box[3] = Math.max(this.box[3], Y); } this.pts = []; }
  beginPath() { this.pts = []; }
  closePath() {}
  moveTo(x, y) { this._pt(x, y); }
  lineTo(x, y) { this._pt(x, y); }
  rect(x, y, w, h) { this._pt(x, y); this._pt(x + w, y + h); }
  ellipse(cx, cy, rx, ry, rot, a0, a1, ccw = false) { // sample the arc so partial arcs measure correctly
    let sweep = ccw ? a0 - a1 : a1 - a0; sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    for (let k = 0; k <= 16; k++) { const t = a0 + (ccw ? -1 : 1) * sweep * k / 16, x = rx * Math.cos(t), y = ry * Math.sin(t); this._pt(cx + x * cr - y * sr, cy + x * sr + y * cr); }
  }
  arc(cx, cy, r, a0, a1, ccw = false) { this.ellipse(cx, cy, r, r, 0, a0, a1, ccw); }
  stroke() { this._commit(); }
  fill() { this._commit(); }
  clip() { this.pts = []; }
  fillText(text, x, y) { const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1]) || 10, w = this.mt ? this.mt(text, this.font) : size * 0.55 * String(text).length; this._pt(x, y); this._pt(x + w, y - size * 0.72); this._commit(); }
  toString() { return ''; }
})(); }

export class PdfCtx {
  constructor() { this.out = ['0 g 0 G 1 J 1 j']; this.path = []; this.ctm = [1, 0, 0, 1, 0, 0]; this.stack = []; this.cur = false; this.lineWidth = 1; this.dash = []; this.font = '10px Arial'; this.fillStyle = this.strokeStyle = '#000'; }
  save() { this.stack.push([this.ctm, this.lineWidth, this.dash]); this.out.push('q'); }
  restore() { [this.ctm, this.lineWidth, this.dash] = this.stack.pop(); this.out.push('Q'); }
  _cm(m) { this.ctm = compose(this.ctm, m); this.out.push(m.map(f).join(' ') + ' cm'); }
  transform(a, b, c, d, e, g) { this._cm([a, b, c, d, e, g]); }
  // canvas setTransform is relative to the device; here "device" = the base matrix (page flip) set below
  setBase(m) { this.base = m; this._cm(m); }
  setTransform(a, b, c, d, e, g) { this._cm(compose(invert(this.ctm), compose(this.base || [1, 0, 0, 1, 0, 0], [a, b, c, d, e, g]))); }
  translate(x, y) { this._cm([1, 0, 0, 1, x, y]); }
  scale(x, y) { this._cm([x, 0, 0, y, 0, 0]); }
  rotate(a) { const c = Math.cos(a), s = Math.sin(a); this._cm([c, s, -s, c, 0, 0]); }
  setLineDash(d) { this.dash = d; }
  beginPath() { this.path = []; this.cur = false; }
  closePath() { this.path.push('h'); }
  moveTo(x, y) { this.path.push(`${f(x)} ${f(y)} m`); this.cur = true; }
  lineTo(x, y) { this.path.push(`${f(x)} ${f(y)} ${this.cur ? 'l' : 'm'}`); this.cur = true; }
  rect(x, y, w, h) { this.path.push(`${f(x)} ${f(y)} ${f(w)} ${f(h)} re`); this.cur = false; }
  _bez(c1x, c1y, c2x, c2y, x, y) { this.path.push([c1x, c1y, c2x, c2y, x, y].map(f).join(' ') + ' c'); }
  // elliptical arc as cubic Béziers of at most 90° each
  ellipse(cx, cy, rx, ry, rot, a0, a1, ccw = false) {
    let sweep = ccw ? a0 - a1 : a1 - a0;
    if (sweep <= 0) sweep += 2 * Math.PI * Math.ceil((1e-9 - sweep) / (2 * Math.PI));
    if (sweep > 2 * Math.PI) sweep = 2 * Math.PI;
    const n = Math.max(1, Math.ceil(sweep / (Math.PI / 2) - 1e-9)), step = (ccw ? -sweep : sweep) / n, k = 4 / 3 * Math.tan(step / 4);
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const P = (t, dx = 0, dy = 0) => { const x = rx * Math.cos(t) + dx, y = ry * Math.sin(t) + dy; return [cx + x * cr - y * sr, cy + x * sr + y * cr]; };
    const D = t => [-rx * Math.sin(t), ry * Math.cos(t)]; // tangent
    const rotv = ([x, y]) => [x * cr - y * sr, x * sr + y * cr];
    let t = a0, [sx, sy] = P(t);
    this.lineTo(sx, sy);
    for (let i = 0; i < n; i++) {
      const t2 = t + step, d1 = rotv(D(t)), d2 = rotv(D(t2)), [x1, y1] = P(t), [x2, y2] = P(t2);
      this._bez(x1 + k * d1[0], y1 + k * d1[1], x2 - k * d2[0], y2 - k * d2[1], x2, y2); t = t2;
    }
  }
  arc(cx, cy, r, a0, a1, ccw = false) { this.ellipse(cx, cy, r, r, 0, a0, a1, ccw); }
  _rgb(style) { const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(style); return (m ? [m[1], m[2], m[3]].map(v => f(v / 255)) : [0, 0, 0]).join(' '); }
  _style() { this.out.push(`${f(this.lineWidth)} w [${this.dash.map(f).join(' ')}] 0 d ${this._rgb(this.strokeStyle)} RG`); }
  _paint(op) { if (!this.path.length) return; this.out.push(...this.path, op); }
  stroke() { this._style(); this._paint('S'); }
  fill(rule) { this.out.push(`${this._rgb(this.fillStyle)} rg`); this._paint(rule === 'evenodd' ? 'f*' : 'f'); }
  clip() { this._paint('W n'); }
  fillRect() {}
  fillText(text, x, y) {
    const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1]) || 10;
    this.out.push(`${this._rgb(this.fillStyle)} rg`);
    // WinAnsi bytes (and Symbol-font letters for Greek) written as octal escapes so the stream stays pure ASCII
    const WIN = { '•': 149, '–': 150, '—': 151, '‘': 145, '’': 146, '“': 147, '”': 148, '…': 133, '€': 128, '™': 153 }; // WinAnsi 0x80-0x9f
    const PLAIN = { '−': '-', '₂': '2', '₃': '3', '₁': '1', ' ': ' ' }; // look-alikes in plain text
    const SYM = { Δ: 'D', Φ: 'F', Γ: 'G', Θ: 'Q', Λ: 'L', Π: 'P', Σ: 'S', Ω: 'W', α: 'a', β: 'b', γ: 'g', δ: 'd', ε: 'e', θ: 'q', λ: 'l', μ: 'm', π: 'p', σ: 's', φ: 'f', ω: 'w', 'ɸ': 'f' }; // Symbol font letters
    const esc = k => '\\' + k.toString(8).padStart(3, '0');
    const runs = []; // [fontResource, escaped string]
    for (let c of String(text)) {
      c = PLAIN[c] ?? c; let font = this.pdfFont || 'F1', code;
      if (c in SYM) { font = 'F6'; code = SYM[c].charCodeAt(0); }
      else { const k = WIN[c] ?? c.charCodeAt(0); if ((k >= 32 && k < 127 && !(c in WIN)) || (k >= 160 && k < 256) || (c in WIN)) code = k; else { code = 63; const m = (globalThis.__badChars ||= new Map()); m.set(k, (m.get(k) || 0) + 1); } }
      const ch = c === '(' || c === ')' || c === '\\' ? '\\' + c : code >= 32 && code < 127 && font !== 'F6' ? String.fromCharCode(code) : esc(code);
      if (runs.length && runs[runs.length - 1][0] === font) runs[runs.length - 1][1] += ch; else runs.push([font, ch]);
    }
    // canvas glyphs point toward -y in user space; PDF glyphs point toward +y, hence the -1 in Tm
    this.out.push(`BT 1 0 0 -1 ${f(x)} ${f(y)} Tm ${runs.map(([fnt, s]) => `/${fnt} ${f(size)} Tf (${s}) Tj`).join(' ')} ET`);
  }
  toString() { return this.out.join('\n'); }
}
