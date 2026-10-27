import { createModule, LibreDwg, Dwg_File_Type } from './vendor/libredwg/dist/libredwg-web.js';

// Reads a DWG off the main thread so a big drawing does not freeze the page. Gets { id, buf }, answers { id, db } or { id, error }.
const BASE = new URL('./vendor/libredwg/wasm/', import.meta.url).href;
let lib;
async function getLib() {
  if (lib) return lib;
  const wasmBinary = new Uint8Array(await (await fetch(BASE + 'libredwg-web.wasm')).arrayBuffer());
  lib = new LibreDwg(await createModule({ wasmBinary, locateFile: p => BASE + p }));
  return lib;
}

self.onmessage = async ({ data: { id, buf } }) => {
  try {
    const l = await getLib(); let data, db;
    try { data = l.dwg_read_data(buf, Dwg_File_Type.DWG); db = l.convert(data); }
    catch (e) { lib = null; throw e; } // a failed read can leave the reader's memory in a bad state: use a fresh reader next time
    finally { if (data) { try { l.dwg_free(data); } catch { lib = null; } } }
    self.postMessage({ id, db });
  } catch (e) { self.postMessage({ id, error: String((e && e.message) || e) }); }
};
