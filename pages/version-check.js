// DWG version checker: reads the first bytes of a DWG (or the $ACADVER header of a DXF) in the browser. The messages come from data-* attributes on #vc-out, in the page's language.
const NAMES = { AC1032: '2018', AC1027: '2013', AC1024: '2010', AC1021: '2007', AC1018: '2004', AC1015: '2000', AC1014: 'R14', AC1012: 'R13', AC1009: 'R11/R12', AC1006: 'R10', AC1004: 'R9', AC1003: 'R2.6', AC1002: 'R2.5', AC1001: 'R2.2', 'AC1.50': 'R2.05', 'AC2.10': 'R2.10', 'AC1.40': 'R1.40', 'AC1.2': 'R1.2' };
const OPENS = ['AC1014', 'AC1015', 'AC1018', 'AC1021', 'AC1024', 'AC1027', 'AC1032'];
const out = document.getElementById('vc-out'), input = document.getElementById('vc-file'), drop = input.closest('label');
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);
const home = (() => { const l = document.documentElement.lang.slice(0, 2); return l === 'en' ? '/' : `/${l}/`; })();

async function check(file) {
  const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer()), text = new TextDecoder('latin1').decode(head);
  let kind, code = text.slice(0, 6).replace(/\0.*$/, '');
  if (!(code in NAMES) && NAMES[text.slice(0, 5)]) code = text.slice(0, 5);
  const dxf = text.match(/\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC[\d.]+)/);
  if (code in NAMES) kind = OPENS.includes(code) ? 'ok' : code === 'AC1012' ? 'part' : 'old';
  else if (dxf) { kind = 'dxf'; code = dxf[1]; }
  else kind = 'bad';
  const v = { file: file.name, code, name: NAMES[code] || code };
  out.replaceChildren(document.createTextNode(fill(out.dataset[kind], v)));
  if (kind === 'ok' || kind === 'part' || kind === 'dxf') out.append(' ', Object.assign(document.createElement('a'), { href: home, textContent: out.dataset.open }));
  out.className = 'vc-out ' + (kind === 'bad' || kind === 'old' ? 'err' : 'ok'); out.hidden = false;
}
input.addEventListener('change', () => input.files[0] && check(input.files[0]));
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) check(e.dataTransfer.files[0]); });
