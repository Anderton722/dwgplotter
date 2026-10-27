// Reader for AutoCAD SHX single-stroke fonts ("shapes 1.0" and "unifont 1.0"). Big fonts (CJK) are not supported.
// glyph(codePoint) -> { adv, strokes: [[ [x,y], ... ], ...] } in font units, y up, baseline at y = 0.
const DIRS = [[1, 0], [1, .5], [1, 1], [.5, 1], [0, 1], [-.5, 1], [-1, 1], [-1, .5], [-1, 0], [-1, -.5], [-1, -1], [-.5, -1], [0, -1], [.5, -1], [1, -1], [1, -.5]];
const s8 = b => (b > 127 ? b - 256 : b);

export class ShxFont {
  constructor(buf) {
    const u8 = new Uint8Array(buf), v = new DataView(buf), head = String.fromCharCode(...u8.subarray(0, 22));
    this.shapes = new Map(); this.cache = new Map(); this.above = 21; this.below = 7; this.kind = null;
    let p = u8.indexOf(0x1a) + 1;
    const cstr = q => { let e = q; while (u8[e]) e++; return e + 1; };
    if (head.startsWith('AutoCAD-86 unifont')) {
      this.kind = 'uni';
      const n = v.getUint32(p, true), hdr = v.getUint16(p + 4, true); p += 6;
      const q = cstr(p); this.above = u8[q]; this.below = u8[q + 1]; p += hdr;
      for (let i = 0; i < n && p + 4 <= u8.length; i++) {
        const num = v.getUint16(p, true), len = v.getUint16(p + 2, true), start = p + 4;
        this.shapes.set(num, u8.subarray(cstr(start), start + len)); p = start + len;
      }
    } else if (head.startsWith('AutoCAD-86 shapes')) {
      this.kind = 'shp';
      const count = v.getUint16(p + 4, true); p += 6;
      const table = []; for (let i = 0; i < count; i++) { table.push([v.getUint16(p, true), v.getUint16(p + 2, true)]); p += 4; }
      for (const [num, len] of table) {
        const data = u8.subarray(cstr(p), p + len);
        if (num === 0) { this.above = data[0] || 21; this.below = data[1] || 7; } else this.shapes.set(num, data);
        p += len;
      }
    } else throw new Error('unsupported SHX format: ' + head.trim());
  }

  glyph(cp) {
    if (this.cache.has(cp)) return this.cache.get(cp);
    const data = this.shapes.get(cp); let g = null;
    if (data) {
      const st = { x: 0, y: 0, down: true, scale: 1, stack: [], paths: [], cur: null };
      st.cur = [[0, 0]]; st.paths.push(st.cur);
      this._run(data, st, 0);
      g = { adv: st.x, strokes: st.paths.filter(s => s.length > 1) };
    }
    this.cache.set(cp, g); return g;
  }

  _run(data, st, depth) {
    let i = 0, skip = false;
    const penUp = () => { st.down = false; st.cur = null; };
    const penDown = () => { st.down = true; st.cur = [[st.x, st.y]]; st.paths.push(st.cur); };
    const to = (x, y) => { st.x = x; st.y = y; if (st.down) { if (!st.cur) { st.cur = [[x, y]]; st.paths.push(st.cur); } else st.cur.push([x, y]); } };
    const arc = (cx, cy, r, a0, a1, ccw) => {
      let span = ccw ? a1 - a0 : a0 - a1; while (span <= 1e-9) span += 2 * Math.PI; if (span > 2 * Math.PI + 1e-9) span -= 2 * Math.PI;
      const n = Math.max(2, Math.ceil(span / (Math.PI / 12)));
      for (let k = 1; k <= n; k++) { const a = a0 + (ccw ? 1 : -1) * span * k / n; to(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
    };
    const bulgeTo = (dx, dy, b) => {
      const x0 = st.x, y0 = st.y;
      if (!b) return to(x0 + dx, y0 + dy);
      const k = b / 127, d = Math.hypot(dx, dy), th = 4 * Math.atan(k), r = d / (2 * Math.sin(th / 2)), h = r * Math.cos(th / 2);
      const mx = x0 + dx / 2, my = y0 + dy / 2, cx = mx - dy / d * h, cy = my + dx / d * h;
      arc(cx, cy, Math.abs(r), Math.atan2(y0 - cy, x0 - cx), Math.atan2(y0 + dy - cy, x0 + dx - cx), k > 0);
    };
    while (i < data.length) {
      const c = data[i++], apply = !skip; skip = false;
      if (c === 0) break;
      if (c >= 15) { const len = c >> 4, d = DIRS[c & 15]; if (apply) to(st.x + d[0] * len * st.scale, st.y + d[1] * len * st.scale); continue; }
      switch (c) {
        case 1: if (apply) penDown(); break;
        case 2: if (apply) penUp(); break;
        case 3: { const n = data[i++]; if (apply && n) st.scale /= n; break; }
        case 4: { const n = data[i++]; if (apply) st.scale *= n; break; }
        case 5: if (apply) st.stack.push([st.x, st.y]); break;
        case 6: if (apply) { const [x, y] = st.stack.pop() || [st.x, st.y]; st.x = x; st.y = y; if (st.down) { st.cur = [[x, y]]; st.paths.push(st.cur); } } break;
        case 7: {
          const num = this.kind === 'uni' ? data[i] | data[i + 1] << 8 : data[i]; i += this.kind === 'uni' ? 2 : 1;
          if (apply && depth < 8 && this.shapes.has(num)) { const keepScale = st.scale; this._run(this.shapes.get(num), st, depth + 1); st.scale = keepScale; }
          break;
        }
        case 8: { const dx = s8(data[i++]), dy = s8(data[i++]); if (apply) to(st.x + dx * st.scale, st.y + dy * st.scale); break; }
        case 9: for (;;) { const dx = s8(data[i++]), dy = s8(data[i++]); if (!dx && !dy) break; if (apply) to(st.x + dx * st.scale, st.y + dy * st.scale); } break;
        case 10: {
          const r = data[i++] * st.scale, sp = s8(data[i++]); if (!apply) break;
          const ccw = sp >= 0, m = Math.abs(sp), oct = (m >> 4) & 7, cnt = (m & 7) || 8, a0 = oct * Math.PI / 4, a1 = a0 + (ccw ? 1 : -1) * cnt * Math.PI / 4;
          const cx = st.x - r * Math.cos(a0), cy = st.y - r * Math.sin(a0); arc(cx, cy, r, a0, a1, ccw); break;
        }
        case 11: {
          const so = data[i++], eo = data[i++], hi = data[i++], lo = data[i++], sp = s8(data[i++]); if (!apply) break;
          const r = (hi * 256 + lo) * st.scale, ccw = sp >= 0, m = Math.abs(sp), oct = (m >> 4) & 7, cnt = m & 7, u = Math.PI / 4 / 256;
          const a0 = oct * Math.PI / 4 + so * u, a1 = (oct + (ccw ? cnt : -cnt)) * Math.PI / 4 + eo * u;
          const cx = st.x - r * Math.cos(a0), cy = st.y - r * Math.sin(a0); arc(cx, cy, r, a0, a1, ccw); break;
        }
        case 12: { const dx = s8(data[i++]), dy = s8(data[i++]), b = s8(data[i++]); if (apply) bulgeTo(dx * st.scale, dy * st.scale, b); break; }
        case 13: for (;;) { const dx = s8(data[i++]), dy = s8(data[i++]); if (!dx && !dy) break; const b = s8(data[i++]); if (apply) bulgeTo(dx * st.scale, dy * st.scale, b); } break;
        case 14: skip = true; break; // next command is for vertical text only
      }
    }
  }
}
