#!/bin/sh
# Wraps each page body in the site template and writes <slug>/index.html (English) and <lang>/<slug>/index.html (es, fr, de, zh).
# Bodies live in pages/<slug>.body.html and pages/<lang>/<slug>.body.html. Run from the project root: sh pages/make.sh <outdir>
OUT="${1:-.}"
HREFLANG_BASE() { # slug (may be empty for the home page)
  for l in en es fr de zh-Hans; do
    case $l in en) p="/$1/";; zh-Hans) p="/zh/$1/";; *) p="/$l/$1/";; esac
    printf '<link rel="alternate" hreflang="%s" href="https://dwgplotter.com%s">\n' "$l" "$p"
  done
  printf '<link rel="alternate" hreflang="x-default" href="https://dwgplotter.com/%s/">\n' "$1"
}
page() { # lang, slug, title, description
  lang="$1"; slug="$2"; title="$3"; desc="$4"
  case $lang in
    en) dir="$OUT/$slug"; home="/"; hl=en; pre="";   badge="Your drawings are never uploaded"; free="Free software (GPL v3)."; src="Source code"; cred="Credits"; priv="Privacy"; g1="DWG to PDF"; g2="Open DWG without AutoCAD"; g3="DXF to PDF";;
    es) dir="$OUT/es/$slug"; home="/es/"; hl=es; pre="/es"; badge="Tus dibujos nunca se suben a ningún servidor"; free="Software libre (GPL v3)."; src="Código fuente"; cred="Créditos"; priv="Privacidad"; g1="DWG a PDF"; g2="Abrir DWG sin AutoCAD"; g3="DXF a PDF";;
    fr) dir="$OUT/fr/$slug"; home="/fr/"; hl=fr; pre="/fr"; badge="Vos dessins ne sont jamais envoyés"; free="Logiciel libre (GPL v3)."; src="Code source"; cred="Crédits"; priv="Confidentialité"; g1="DWG en PDF"; g2="Ouvrir un DWG sans AutoCAD"; g3="DXF en PDF";;
    de) dir="$OUT/de/$slug"; home="/de/"; hl=de; pre="/de"; badge="Ihre Zeichnungen werden nie hochgeladen"; free="Freie Software (GPL v3)."; src="Quellcode"; cred="Danksagungen"; priv="Datenschutz"; g1="DWG in PDF"; g2="DWG ohne AutoCAD öffnen"; g3="DXF in PDF";;
    zh) dir="$OUT/zh/$slug"; home="/zh/"; hl=zh-Hans; pre="/zh"; badge="您的图纸绝不会被上传"; free="自由软件（GPL v3）。"; src="源代码"; cred="致谢"; priv="隐私"; g1="DWG 转 PDF"; g2="无需 AutoCAD 打开 DWG"; g3="DXF 转 PDF";;
  esac
  body="pages/$slug.body.html"; [ "$lang" != en ] && body="pages/$lang/$slug.body.html"
  canon="https://dwgplotter.com$pre/$slug/"; mkdir -p "$dir"
  cat > "$dir/index.html" <<EOF
<!doctype html>
<html lang="$hl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>$title | DWG Plotter</title>
<meta name="description" content="$desc">
<link rel="canonical" href="$canon">
$(HREFLANG_BASE "$slug")
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27%3E%3Crect x=%271.5%27 y=%271.5%27 width=%2721%27 height=%2721%27 rx=%276.5%27 fill=%27%234f46e5%27/%3E%3Cpath d=%27M7 15.5 11 9l3 4 3-5%27 fill=%27none%27 stroke=%27%23fff%27 stroke-width=%271.9%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E">
<link rel="stylesheet" href="/plotter/style.css?v=19">
<link rel="stylesheet" href="/pages.css?v=1">
</head>
<body>
<header class="top">
  <a class="brand" href="$home"><svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><rect x="1.5" y="1.5" width="21" height="21" rx="6.5" fill="var(--accent)"/><path d="M7 15.5 11 9l3 4 3-5" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>DWG Plotter</a>
  <span class="private">$badge</span>
</header>
<main class="doc">
$(cat "$body")
</main>
<footer class="foot">$free <a href="https://github.com/Anderton722/dwgplotter" rel="noopener">$src</a> · <a href="https://github.com/Anderton722/dwgplotter/blob/main/NOTICE.md" rel="noopener">$cred</a> · <a href="$pre/privacy/">$priv</a> · <a href="$pre/dwg-to-pdf/">$g1</a> · <a href="$pre/open-dwg-without-autocad/">$g2</a> · <a href="$pre/dxf-to-pdf/">$g3</a></footer>
</body>
</html>
EOF
}

page en dwg-to-pdf "How to Convert DWG to PDF Free, Without AutoCAD" "Convert a DWG drawing to PDF free in your browser. Plots each layout as drawn, keeps lineweights, black and white or colour. Nothing is uploaded."
page en open-dwg-without-autocad "How to Open a DWG File Without AutoCAD" "Ways to open and read a DWG drawing when you do not have AutoCAD, including a free in-browser viewer that saves the drawing as a PDF."
page en dxf-to-pdf "DXF to PDF: Convert a DXF Drawing Free Online" "Convert a DXF drawing to PDF free in your browser. Prints the model drawing with lineweights and linetypes. Nothing is uploaded."
page en privacy "Privacy Policy" "How DWG Plotter handles your drawings and data. Drawings are read in your browser and are never uploaded."

page es dwg-to-pdf "Cómo convertir DWG a PDF gratis, sin AutoCAD" "Convierte un dibujo DWG a PDF gratis en tu navegador. Imprime cada presentación tal como está dibujada, con grosores de línea, en blanco y negro o color. No se sube nada."
page es open-dwg-without-autocad "Cómo abrir un archivo DWG sin AutoCAD" "Formas de abrir y leer un dibujo DWG cuando no tienes AutoCAD, incluido un visor gratuito en el navegador que lo guarda como PDF."
page es dxf-to-pdf "DXF a PDF: convierte un dibujo DXF gratis online" "Convierte un dibujo DXF a PDF gratis en tu navegador. Imprime el dibujo del modelo con grosores y tipos de línea. No se sube nada."
page es privacy "Política de privacidad" "Cómo trata DWG Plotter tus dibujos y datos. Los dibujos se leen en tu navegador y nunca se suben."

page fr dwg-to-pdf "Comment convertir un DWG en PDF gratuitement, sans AutoCAD" "Convertissez un dessin DWG en PDF gratuitement dans votre navigateur. Chaque présentation est tracée telle que dessinée, avec les épaisseurs de ligne, en noir et blanc ou en couleur. Rien n'est envoyé."
page fr open-dwg-without-autocad "Comment ouvrir un fichier DWG sans AutoCAD" "Comment ouvrir et lire un dessin DWG sans AutoCAD, y compris avec une visionneuse gratuite dans le navigateur qui l'enregistre en PDF."
page fr dxf-to-pdf "DXF en PDF : convertir un dessin DXF gratuitement en ligne" "Convertissez un dessin DXF en PDF gratuitement dans votre navigateur. Imprime le dessin du modèle avec épaisseurs et types de ligne. Rien n'est envoyé."
page fr privacy "Politique de confidentialité" "Comment DWG Plotter traite vos dessins et vos données. Les dessins sont lus dans votre navigateur et ne sont jamais envoyés."

page de dwg-to-pdf "DWG kostenlos in PDF umwandeln – ohne AutoCAD" "Wandeln Sie eine DWG-Zeichnung kostenlos im Browser in PDF um. Jedes Layout wird wie gezeichnet gedruckt, mit Linienstärken, in Schwarzweiß oder Farbe. Nichts wird hochgeladen."
page de open-dwg-without-autocad "So öffnen Sie eine DWG-Datei ohne AutoCAD" "So öffnen und lesen Sie eine DWG-Zeichnung ohne AutoCAD – auch mit einem kostenlosen Browser-Viewer, der sie als PDF speichert."
page de dxf-to-pdf "DXF in PDF: DXF-Zeichnung kostenlos online umwandeln" "Wandeln Sie eine DXF-Zeichnung kostenlos im Browser in PDF um. Druckt die Modellzeichnung mit Linienstärken und Linientypen. Nichts wird hochgeladen."
page de privacy "Datenschutzerklärung" "Wie DWG Plotter mit Ihren Zeichnungen und Daten umgeht. Zeichnungen werden in Ihrem Browser gelesen und nie hochgeladen."

page zh dwg-to-pdf "如何免费将 DWG 转为 PDF，无需 AutoCAD" "在浏览器中免费将 DWG 图纸转为 PDF。每个布局按原样打印，保留线宽，可选黑白或彩色。不上传任何内容。"
page zh open-dwg-without-autocad "没有 AutoCAD 如何打开 DWG 文件" "没有 AutoCAD 时打开和查看 DWG 图纸的方法，包括可在浏览器中免费使用并保存为 PDF 的查看器。"
page zh dxf-to-pdf "DXF 转 PDF：免费在线转换 DXF 图纸" "在浏览器中免费将 DXF 图纸转为 PDF。打印模型图形，保留线宽和线型。不上传任何内容。"
page zh privacy "隐私政策" "DWG Plotter 如何处理您的图纸和数据。图纸在您的浏览器中读取，绝不会上传。"
