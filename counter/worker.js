// Usage counter for dwgplotter.com. Route: dwgplotter.com/api/count*  Binding: KV namespace COUNTS.
// Stores one number per event per day (key "2026-10-28:save_pdf"). No IP, file name, or file data is read or kept.
const EVENTS = new Set(['open_dwg', 'open_dxf', 'open_fail', 'save_pdf', 'save_png', 'save_jpg', 'save_zip', 'open_sample', 'save_sample']);
export default {
  async fetch(req, env) {
    const e = new URL(req.url).searchParams.get('e');
    if (req.method !== 'POST' || !EVENTS.has(e)) return new Response(null, { status: 204 });
    const key = new Date().toISOString().slice(0, 10) + ':' + e;
    await env.COUNTS.put(key, String(Number(await env.COUNTS.get(key) || 0) + 1));
    return new Response(null, { status: 204 });
  },
};
