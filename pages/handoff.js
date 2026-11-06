// Guide pages: a drawing dropped on (or chosen in) the drop box is handed to the app through IndexedDB in this browser, then the app opens it (?open).
// The file never leaves the computer. If IndexedDB is unavailable the visitor is simply taken to the app.
(() => {
  const box = document.querySelector('.handoff'); if (!box) return;
  const input = box.querySelector('input'), go = box.dataset.go;
  const put = files => new Promise((ok, fail) => {
    const req = indexedDB.open('dwgplotter', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handoff');
    req.onerror = () => fail(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('handoff', 'readwrite');
      tx.objectStore('handoff').put({ files, at: Date.now() }, 'pending');
      tx.oncomplete = () => ok(); tx.onerror = () => fail(tx.error);
    };
  });
  const send = async files => {
    if (!files.length) return;
    try { await put(files); } catch { location.href = go; return; }
    try { navigator.sendBeacon('/api/count?e=guide_drop'); } catch {}
    try { window.gtag?.('event', 'guide_drop', { transport_type: 'beacon' }); } catch {}
    location.href = go + (go.includes('?') ? '&' : '?') + 'open';
  };
  input.addEventListener('change', () => send([...input.files]));
  box.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  // a drawing dropped anywhere on the page counts, so the browser does not open the file itself
  for (const ev of ['dragenter', 'dragover']) addEventListener(ev, e => { e.preventDefault(); box.classList.add('over'); });
  addEventListener('dragleave', e => { if (e.target === document.documentElement) box.classList.remove('over'); });
  addEventListener('drop', e => { e.preventDefault(); box.classList.remove('over'); send([...(e.dataTransfer?.files || [])]); });
})();
