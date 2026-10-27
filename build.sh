#!/bin/sh
# Builds ./dist: the static site, ready to upload to Cloudflare Pages. Private drawings and Autodesk fonts are left out.
set -e
rm -rf dist && mkdir -p dist/vendor dist/fonts
cp -r plotter dist/plotter
cp engine.js dxf.js shx.js pdfctx.js LICENSE NOTICE.md dist/
cp -r vendor/libredwg vendor/*.js vendor/*.json vendor/*.txt dist/vendor/
printf '/  /plotter/  302\n' > dist/_redirects
echo "built dist: $(find dist -type f | wc -l) files, $(du -sh dist | cut -f1)"
