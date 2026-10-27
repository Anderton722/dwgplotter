#!/bin/sh
# Builds ./dist: the static site, ready to upload to Cloudflare Pages. Private drawings and Autodesk fonts are left out.
set -e
rm -rf dist && mkdir -p dist/vendor dist/fonts
cp -r plotter dist/plotter
cp engine.js dxf.js shx.js pdfctx.js LICENSE NOTICE.md dist/
cp -r vendor/libredwg vendor/*.js vendor/*.json vendor/*.txt dist/vendor/
printf '/  /plotter/  302\n' > dist/_redirects
printf 'User-agent: *\nAllow: /\nSitemap: https://dwgplotter.com/sitemap.xml\n' > dist/robots.txt
printf '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://dwgplotter.com/plotter/</loc></url></urlset>\n' > dist/sitemap.xml
echo "built dist: $(find dist -type f | wc -l) files, $(du -sh dist | cut -f1)"
