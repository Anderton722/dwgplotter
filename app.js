const { PDFDocument, degrees, StandardFonts, rgb } = PDFLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/* ---------- helpers ---------- */
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter(k => k != null));
  return el;
};
const readBuf = f => f.arrayBuffer();
const baseName = n => n.replace(/\.[^.]+$/, '');
const fmtSize = b => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';

function download(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  h('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function dropzone({ accept, multiple, label, onFiles }) {
  const input = h('input', { type: 'file', accept });
  if (multiple) input.multiple = true;
  const el = h('label', { class: 'drop' }, h('div', {}, label), input);
  const pick = list => {
    const ok = [...list].filter(f => accept.split(',').some(a => a.startsWith('.') ? f.name.toLowerCase().endsWith(a) : f.type.match(a.replace('*', '.*'))));
    if (ok.length) onFiles(multiple ? ok : [ok[0]]);
  };
  input.onchange = () => { pick(input.files); input.value = ''; };
  el.ondragover = e => { e.preventDefault(); el.classList.add('over'); };
  el.ondragleave = () => el.classList.remove('over');
  el.ondrop = e => { e.preventDefault(); el.classList.remove('over'); pick(e.dataTransfer.files); };
  return el;
}

function status() {
  const el = h('div', { class: 'status' });
  el.set = (msg, cls = '') => { el.className = 'status ' + cls; el.textContent = msg; };
  return el;
}

async function run(st, btn, label, fn) {
  btn.disabled = true; st.set(label + '…');
  try { const msg = await fn(); st.set(msg || 'Done – your download should start.', 'ok'); }
  catch (e) { console.error(e); st.set('Failed: ' + (e.message || e), 'err'); }
  btn.disabled = false;
}

// Reorderable list of files with remove buttons. items: [{file}]
function fileList(items, rerender) {
  return h('ul', { class: 'files' }, items.map((it, i) => h('li', {},
    h('span', { class: 'n' }, it.file.name), h('small', {}, fmtSize(it.file.size)),
    h('button', { disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; rerender(); } }, '↑'),
    h('button', { disabled: i === items.length - 1, onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; rerender(); } }, '↓'),
    h('button', { onclick: () => { items.splice(i, 1); rerender(); } }, '✕'))));
}

async function loadPdfjs(buf) {
  return pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
}

async function renderPage(doc, n, scale) {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale });
  const c = h('canvas'); c.width = vp.width; c.height = vp.height;
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  return c;
}

const canvasBlob = (c, type = 'image/png') => new Promise(r => c.toBlob(r, type));

function parseRanges(text, n) {
  return text.split(',').map(s => s.trim()).filter(Boolean).map(part => {
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    let a, b;
    if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : n; }
    else if (/^\d+$/.test(part)) a = b = +part;
    else throw new Error(`Can't read "${part}"`);
    if (a < 1 || b > n || a > b) throw new Error(`Range "${part}" is outside 1–${n}`);
    return Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i);
  });
}

/* ---------- tools ---------- */
const tools = [
  {
    id: 'merge', icon: '🔗', title: 'Merge PDFs', desc: 'Combine several PDFs into one, in any order.',
    render(root) {
      const items = []; const list = h('div'); const st = status();
      const btn = h('button', { class: 'primary', onclick: () => run(st, btn, 'Merging', async () => {
        const out = await PDFDocument.create();
        for (const it of items) {
          const src = await PDFDocument.load(await readBuf(it.file), { ignoreEncryption: true });
          (await out.copyPages(src, src.getPageIndices())).forEach(p => out.addPage(p));
        }
        download(await out.save(), 'merged.pdf', 'application/pdf');
      }) }, 'Merge');
      const draw = () => { list.replaceChildren(items.length ? h('div', { class: 'panel' }, fileList(items, draw), h('div', { class: 'row', style: 'margin-top:12px' }, btn)) : ''); btn.disabled = items.length < 2; };
      root.append(dropzone({ accept: '.pdf', multiple: true, label: 'Drop PDFs here or click to choose (add as many as you like)', onFiles: fs => { fs.forEach(file => items.push({ file })); draw(); } }), list, st);
    }
  },
  {
    id: 'split', icon: '✂️', title: 'Split PDF', desc: 'Extract page ranges, or split into single pages.',
    render(root) {
      const box = h('div'); const st = status();
      root.append(dropzone({ accept: '.pdf', multiple: false, label: 'Drop a PDF here or click to choose', onFiles: async ([file]) => {
        const buf = await readBuf(file);
        const src = await PDFDocument.load(buf, { ignoreEncryption: true }); const n = src.getPageCount();
        const ranges = h('input', { type: 'text', value: `1-${n}`, size: 24 });
        const mode = h('select', {}, h('option', { value: 'ranges' }, 'One file per range'), h('option', { value: 'merge' }, 'All ranges in one file'), h('option', { value: 'each' }, 'Every page as its own file'));
        const btn = h('button', { class: 'primary', onclick: () => run(st, btn, 'Splitting', async () => {
          const groups = mode.value === 'each' ? Array.from({ length: n }, (_, i) => [i]) : parseRanges(ranges.value, n);
          if (!groups.length) throw new Error('Enter at least one range');
          const make = async idx => { const d = await PDFDocument.create(); (await d.copyPages(src, idx)).forEach(p => d.addPage(p)); return d.save(); };
          const name = baseName(file.name);
          if (mode.value === 'merge') return download(await make(groups.flat()), `${name}-extract.pdf`, 'application/pdf');
          if (groups.length === 1) return download(await make(groups[0]), `${name}-extract.pdf`, 'application/pdf');
          const zip = new JSZip();
          for (let i = 0; i < groups.length; i++) zip.file(`${name}-${i + 1}.pdf`, await make(groups[i]));
          download(await zip.generateAsync({ type: 'blob' }), `${name}-split.zip`, 'application/zip');
        }) }, 'Split');
        box.replaceChildren(h('div', { class: 'panel' }, h('p', {}, `${file.name} – ${n} pages`),
          h('div', { class: 'row' }, h('label', { class: 'f' }, 'Pages (e.g. 1-3, 5, 8-)', ranges), h('label', { class: 'f' }, 'Output', mode), btn)));
      } }), box, st);
    }
  },
  {
    id: 'organize', icon: '🗂️', title: 'Organize & rotate', desc: 'Reorder by dragging, rotate or delete pages.',
    render(root) {
      const box = h('div'); const st = status();
      root.append(dropzone({ accept: '.pdf', multiple: false, label: 'Drop a PDF here or click to choose', onFiles: async ([file]) => {
        st.set('Loading pages…');
        const buf = await readBuf(file); const doc = await loadPdfjs(buf);
        const pages = [];
        for (let i = 1; i <= doc.numPages; i++) pages.push({ i: i - 1, rot: 0, url: (await renderPage(doc, i, 0.35)).toDataURL() });
        st.set('');
        let dragFrom = null; const grid = h('div', { class: 'pages' });
        const btn = h('button', { class: 'primary', onclick: () => run(st, btn, 'Saving', async () => {
          if (!pages.length) throw new Error('No pages left');
          const src = await PDFDocument.load(buf, { ignoreEncryption: true });
          const out = await PDFDocument.create();
          const copied = await out.copyPages(src, pages.map(p => p.i));
          copied.forEach((pg, k) => { pg.setRotation(degrees((pg.getRotation().angle + pages[k].rot) % 360)); out.addPage(pg); });
          download(await out.save(), `${baseName(file.name)}-organized.pdf`, 'application/pdf');
        }) }, 'Save PDF');
        const draw = () => grid.replaceChildren(...pages.map((p, k) => {
          const card = h('div', { class: 'pg', draggable: 'true',
            ondragstart: () => { dragFrom = k; card.classList.add('drag'); },
            ondragend: () => card.classList.remove('drag'),
            ondragover: e => e.preventDefault(),
            ondrop: e => { e.preventDefault(); if (dragFrom === null || dragFrom === k) return; pages.splice(k, 0, pages.splice(dragFrom, 1)[0]); dragFrom = null; draw(); } },
            h('div', { class: 'th' }, h('img', { src: p.url, style: `transform:rotate(${p.rot}deg)` })),
            h('small', {}, `Page ${p.i + 1}`),
            h('div', { class: 'bar' },
              h('button', { title: 'Rotate left', onclick: () => { p.rot = (p.rot + 270) % 360; draw(); } }, '↺'),
              h('button', { title: 'Rotate right', onclick: () => { p.rot = (p.rot + 90) % 360; draw(); } }, '↻'),
              h('button', { title: 'Delete', onclick: () => { pages.splice(k, 1); draw(); } }, '🗑')));
          return card;
        }));
        draw();
        box.replaceChildren(h('div', { class: 'panel' }, h('p', { class: 'hint' }, 'Drag pages to reorder.'), grid, h('div', { class: 'row', style: 'margin-top:14px' }, btn)));
      } }), box, st);
    }
  },
  {
    id: 'img2pdf', icon: '🖼️', title: 'Images to PDF', desc: 'Turn JPG/PNG/WebP photos into a single PDF.',
    render(root) {
      const items = []; const list = h('div'); const st = status();
      const fit = h('select', {}, h('option', { value: 'image' }, 'Page matches image'), h('option', { value: 'a4' }, 'A4 page, image fitted'));
      const btn = h('button', { class: 'primary', onclick: () => run(st, btn, 'Building PDF', async () => {
        const out = await PDFDocument.create();
        for (const { file } of items) {
          let bytes = new Uint8Array(await readBuf(file)), img;
          if (file.type === 'image/jpeg') img = await out.embedJpg(bytes);
          else {
            if (file.type !== 'image/png') { // convert other formats (WebP etc.) through a canvas
              const bmp = await createImageBitmap(file); const c = h('canvas'); c.width = bmp.width; c.height = bmp.height;
              c.getContext('2d').drawImage(bmp, 0, 0); bytes = new Uint8Array(await (await canvasBlob(c)).arrayBuffer());
            }
            img = await out.embedPng(bytes);
          }
          if (fit.value === 'a4') {
            const W = 595, H = 842, m = 24, s = Math.min((W - 2 * m) / img.width, (H - 2 * m) / img.height, 1);
            const w = img.width * s, ht = img.height * s;
            out.addPage([W, H]).drawImage(img, { x: (W - w) / 2, y: (H - ht) / 2, width: w, height: ht });
          } else out.addPage([img.width, img.height]).drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
        }
        download(await out.save(), 'images.pdf', 'application/pdf');
      }) }, 'Create PDF');
      const draw = () => list.replaceChildren(items.length ? h('div', { class: 'panel' }, fileList(items, draw), h('div', { class: 'row', style: 'margin-top:12px' }, h('label', { class: 'f' }, 'Layout', fit), btn)) : '');
      root.append(dropzone({ accept: 'image/*', multiple: true, label: 'Drop images here or click to choose', onFiles: fs => { fs.forEach(file => items.push({ file })); draw(); } }), list, st);
    }
  },
  {
    id: 'pdf2img', icon: '📸', title: 'PDF to images', desc: 'Export every page as a PNG or JPG.',
    render(root) {
      const box = h('div'); const st = status();
      root.append(dropzone({ accept: '.pdf', multiple: false, label: 'Drop a PDF here or click to choose', onFiles: async ([file]) => {
        const doc = await loadPdfjs(await readBuf(file));
        const fmt = h('select', {}, h('option', { value: 'png' }, 'PNG'), h('option', { value: 'jpg' }, 'JPG'));
        const res = h('select', {}, h('option', { value: '1.5' }, 'Standard (≈108 dpi)'), h('option', { value: '2' }, 'High (≈144 dpi)'), h('option', { value: '3' }, 'Print (≈216 dpi)'));
        const btn = h('button', { class: 'primary', onclick: () => run(st, btn, 'Rendering', async () => {
          const jpg = fmt.value === 'jpg', ext = fmt.value, name = baseName(file.name), files = [];
          for (let i = 1; i <= doc.numPages; i++) {
            st.set(`Rendering page ${i} of ${doc.numPages}…`);
            files.push(await canvasBlob(await renderPage(doc, i, +res.value), jpg ? 'image/jpeg' : 'image/png'));
          }
          if (files.length === 1) return download(files[0], `${name}.${ext}`, files[0].type);
          const zip = new JSZip(); files.forEach((b, i) => zip.file(`${name}-${i + 1}.${ext}`, b));
          download(await zip.generateAsync({ type: 'blob' }), `${name}-images.zip`, 'application/zip');
        }) }, 'Export');
        box.replaceChildren(h('div', { class: 'panel' }, h('p', {}, `${file.name} – ${doc.numPages} pages`),
          h('div', { class: 'row' }, h('label', { class: 'f' }, 'Format', fmt), h('label', { class: 'f' }, 'Quality', res), btn)));
      } }), box, st);
    }
  },
  {
    id: 'numbers', icon: '🔢', title: 'Page numbers', desc: 'Stamp page numbers onto every page.',
    render(root) {
      const box = h('div'); const st = status();
      root.append(dropzone({ accept: '.pdf', multiple: false, label: 'Drop a PDF here or click to choose', onFiles: async ([file]) => {
        const pos = h('select', {}, ...[['bc', 'Bottom centre'], ['br', 'Bottom right'], ['bl', 'Bottom left'], ['tc', 'Top centre'], ['tr', 'Top right']].map(([v, t]) => h('option', { value: v }, t)));
        const start = h('input', { type: 'number', value: '1', min: '0', style: 'width:80px' });
        const total = h('select', {}, h('option', { value: 'n' }, '1, 2, 3'), h('option', { value: 'of' }, '1 of N'));
        const btn = h('button', { class: 'primary', onclick: () => run(st, btn, 'Numbering', async () => {
          const doc = await PDFDocument.load(await readBuf(file), { ignoreEncryption: true });
          const font = await doc.embedFont(StandardFonts.Helvetica), pages = doc.getPages();
          pages.forEach((pg, i) => {
            const { width, height } = pg.getSize(), num = +start.value + i;
            const text = total.value === 'of' ? `${num} of ${pages.length + +start.value - 1}` : `${num}`, size = 10;
            const tw = font.widthOfTextAtSize(text, size), x = pos.value[1] === 'c' ? (width - tw) / 2 : pos.value[1] === 'r' ? width - tw - 36 : 36;
            pg.drawText(text, { x, y: pos.value[0] === 'b' ? 24 : height - 32, size, font, color: rgb(0.2, 0.2, 0.2) });
          });
          download(await doc.save(), `${baseName(file.name)}-numbered.pdf`, 'application/pdf');
        }) }, 'Add numbers');
        box.replaceChildren(h('div', { class: 'panel' }, h('p', {}, `${file.name} – ${(await PDFDocument.load(await readBuf(file), { ignoreEncryption: true })).getPageCount()} pages`),
          h('div', { class: 'row' }, h('label', { class: 'f' }, 'Position', pos), h('label', { class: 'f' }, 'Start at', start), h('label', { class: 'f' }, 'Style', total), btn)));
      } }), box, st);
    }
  },
];

/* ---------- router ---------- */
function route() {
  const app = document.getElementById('app'), id = location.hash.replace('#/', '');
  const tool = tools.find(t => t.id === id);
  app.replaceChildren();
  if (!tool) {
    app.append(h('h1', {}, 'Every-day PDF tools, done privately'),
      h('p', { class: 'lead' }, 'The tools you reach for at work, without uploading your files to someone else’s server.'),
      h('div', { class: 'grid' }, tools.map(t => h('a', { class: 'tool', href: `#/${t.id}` }, h('div', { class: 'ico' }, t.icon), h('h3', {}, t.title), h('p', {}, t.desc)))));
    document.title = 'LocalPDF – private PDF tools';
  } else {
    app.append(h('a', { class: 'back', href: '#/' }, '← All tools'), h('h1', {}, tool.icon + ' ' + tool.title), h('p', { class: 'lead' }, tool.desc));
    tool.render(app);
    document.title = tool.title + ' – LocalPDF';
  }
}
addEventListener('hashchange', route);
route();
