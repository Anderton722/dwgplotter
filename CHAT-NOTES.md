# DWGPlotter chat notes (saved 2026-10-27)

## State
- Site: dwgplotter.com (apex Active) and www.dwgplotter.com (CNAME to dwgplotter.pages.dev), Cloudflare Pages, direct-upload zip deploy.
- Project folder: D:\Claude\DWGPlotter (copied from D:\Claude\office-tool-project, which still exists and can be deleted once you confirm the copy is good).
- Git: origin/main has 9dece64 (privacy page discloses Cloudflare Web Analytics, 5 languages) and f5dc585 (DWG read in a background worker).
- Full transcript: C:\Users\seana\.claude\projects\D--Claude\f50fe548-cb6e-4433-88b8-adfb355aea74.jsonl

## Done this stretch
- Cloudflare Web Analytics added (cookieless, automatic setup, beacon token 2d1379c3c5ce4cf7b0adb1e5e49d430f).
- Privacy pages updated in en/es/fr/de/zh.
- DWG reading moved to dwgworker.js (module worker, libredwg-web WASM); main-thread fallback if workers fail. engine import bumped to ?v=26; build.sh copies dwgworker.js.
- www redirect/domain working; sitemap resubmitted (25 URLs); home and /dwg-to-pdf/ indexed in Google.
- Title-block text differences explained: reference PDFs were an older drawing revision (checked sheet 7102 only).

## Stats (latest check)
- Cloudflare, last 24 h: 11 page views, 11 visits (was 9/9 earlier). Likely mostly own tests.

## Open items
- "office tool" session (folder D:\Claude\office-tool, design a new product, Remote Control on): not created. Needs the request typed in the desktop app, not over Remote Control.
- Bing Webmaster Tools: needs your Microsoft sign-in, then Import from Google Search Console.
- Custom event counts: not possible on free Cloudflare analytics.
- Later: native-speaker review of translations, forum/Reddit posts (you publish), AdSense plus consent banner once there is traffic, SHX font licensing, CJK real-drawing check, DWF support.
