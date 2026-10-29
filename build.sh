#!/bin/sh
# Builds ./dist: the static site, ready to upload to Cloudflare Pages. Private drawings and Autodesk fonts are left out.
set -e
rm -rf dist && mkdir -p dist/vendor dist/fonts
cp -r plotter dist/plotter
cp engine.js dwgworker.js dxf.js shx.js pdfctx.js LICENSE NOTICE.md dist/
cp -r vendor/libredwg vendor/*.js vendor/*.json vendor/*.txt dist/vendor/
printf '/  /plotter/  200\n' > dist/_redirects
printf 'User-agent: *\nAllow: /\nSitemap: https://dwgplotter.com/sitemap.xml\n' > dist/robots.txt
sh pages/make.sh dist
cp pages/pages.css dist/pages.css
# One copy of the app per language (/es/, /fr/, /de/, /zh/): same page, with the language set in <html lang>, its own title, description and hreflang links, and its text pre-filled.
HREFLANG='<link rel="alternate" hreflang="en" href="https://dwgplotter.com/">\n<link rel="alternate" hreflang="es" href="https://dwgplotter.com/es/">\n<link rel="alternate" hreflang="fr" href="https://dwgplotter.com/fr/">\n<link rel="alternate" hreflang="de" href="https://dwgplotter.com/de/">\n<link rel="alternate" hreflang="zh-Hans" href="https://dwgplotter.com/zh/">\n<link rel="alternate" hreflang="x-default" href="https://dwgplotter.com/">'
lang_page() { # code, html lang, title, description, og title, og description, column of pages/guides.tsv
  mkdir -p "dist/$1"; py tools/ldjson.py home "$1" > dist/.ld.html
  sed -e "/<!--LDJSON-->/{r dist/.ld.html" -e "d}" -e "s#^<meta property=\"og:url\" content=\".*\">#<meta property=\"og:url\" content=\"https://dwgplotter.com/$1/\">#" \
      -e "s#^<html lang=\"en\">#<html lang=\"$2\">#" -e "s#^<title>.*</title>#<title>$3</title>#" \
      -e "s#^<meta name=\"description\" content=\".*\">#<meta name=\"description\" content=\"$4\">#" \
      -e "s#^<link rel=\"canonical\" href=\".*\">#<link rel=\"canonical\" href=\"https://dwgplotter.com/$1/\">#" \
      -e "s#^<meta property=\"og:title\" content=\".*\">#<meta property=\"og:title\" content=\"$5\">#" \
      -e "s#^<meta property=\"og:description\" content=\".*\">#<meta property=\"og:description\" content=\"$6\">#" \
      -e "s#<!--HREFLANG-->#$HREFLANG#" plotter/index.html > "dist/$1/index.html"
  guides "$7" "/$1" > dist/.gl.html; sed -i -e "/<!--GUIDES-->/{r dist/.gl.html" -e "d}" "dist/$1/index.html"
  py tools/prerender.py "$1" "dist/$1/index.html" # the text is in the HTML for search engines, not only filled in by the script
}
guides() { # column of pages/guides.tsv, language prefix: the home page's list of guides
  tr -d '\r' < pages/guides.tsv | awk -F'\t' -v c="$1" -v p="$2" '{ printf "        <li><a href=\"%s/%s/\">%s</a></li>\n", p, $1, $c }'
}
py tools/ldjson.py home en > dist/.ld.html
sed -i -e "s#<!--HREFLANG-->#$HREFLANG#" -e "/<!--LDJSON-->/{r dist/.ld.html" -e "d}" dist/plotter/index.html
guides 2 "" > dist/.gl.html; sed -i -e "/<!--GUIDES-->/{r dist/.gl.html" -e "d}" dist/plotter/index.html
lang_page es es "Convertidor de DWG a PDF – Gratis, online, sin subir archivos | DWG Plotter" "Convierte dibujos DWG y DXF a PDF gratis, en tu navegador. Abre archivos DWG sin AutoCAD. Las presentaciones se imprimen tal como están dibujadas y no se sube nada." "Convertidor de DWG a PDF – Gratis, online, sin subir archivos" "Abre dibujos DWG y DXF sin AutoCAD y guárdalos como PDF. No se sube nada." 3
lang_page fr fr "Convertisseur DWG en PDF – Gratuit, en ligne, sans envoi de fichier | DWG Plotter" "Convertissez des dessins DWG et DXF en PDF gratuitement, dans votre navigateur. Ouvrez des fichiers DWG sans AutoCAD. Les présentations sont tracées telles que dessinées et rien n'est envoyé." "Convertisseur DWG en PDF – Gratuit, en ligne, sans envoi de fichier" "Ouvrez des dessins DWG et DXF sans AutoCAD et enregistrez-les en PDF. Rien n'est envoyé." 4
lang_page de de "DWG-in-PDF-Konverter – Kostenlos, online, ohne Upload | DWG Plotter" "Wandeln Sie DWG- und DXF-Zeichnungen kostenlos im Browser in PDF um. DWG-Dateien ohne AutoCAD öffnen. Layouts werden wie gezeichnet gedruckt, und nichts wird hochgeladen." "DWG-in-PDF-Konverter – Kostenlos, online, ohne Upload" "DWG- und DXF-Zeichnungen ohne AutoCAD öffnen und als PDF speichern. Nichts wird hochgeladen." 5
lang_page zh zh-Hans "DWG 转 PDF 在线转换器 – 免费，无需上传 | DWG Plotter" "在浏览器中免费将 DWG 和 DXF 图纸转为 PDF。无需 AutoCAD 即可打开 DWG 文件。布局按原样打印，不上传任何内容。" "DWG 转 PDF 在线转换器 – 免费，无需上传" "无需 AutoCAD 即可打开 DWG 和 DXF 图纸并保存为 PDF。不上传任何内容。" 6
{ printf '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  printf '<url><loc>https://dwgplotter.com/</loc></url>\n'
  SLUGS="$(tr -d '\r' < pages/guides.tsv | cut -f1) about privacy"
  for p in es fr de zh $SLUGS; do printf '<url><loc>https://dwgplotter.com/%s/</loc></url>\n' "$p"; done
  for l in es fr de zh; do for p in $SLUGS; do printf '<url><loc>https://dwgplotter.com/%s/%s/</loc></url>\n' "$l" "$p"; done; done
  printf '</urlset>\n'; } > dist/sitemap.xml
rm -f dist/.ld.html dist/.gl.html
cp pages/version-check.js dist/version-check.js
[ -f og.png ] && cp og.png dist/og.png
echo "built dist: $(find dist -type f | wc -l) files, $(du -sh dist | cut -f1)"
