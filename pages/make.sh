#!/bin/sh
# Wraps each pages/<slug>.body.html in the site template and writes <slug>/index.html (run from the project root: sh pages/make.sh <outdir>)
OUT="${1:-.}"
page() { # slug, title, description
  slug="$1"; title="$2"; desc="$3"; mkdir -p "$OUT/$slug"
  cat > "$OUT/$slug/index.html" <<EOF
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>$title | DWG Plotter</title>
<meta name="description" content="$desc">
<link rel="canonical" href="https://dwgplotter.com/$slug/">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27%3E%3Crect x=%271.5%27 y=%271.5%27 width=%2721%27 height=%2721%27 rx=%276.5%27 fill=%27%234f46e5%27/%3E%3Cpath d=%27M7 15.5 11 9l3 4 3-5%27 fill=%27none%27 stroke=%27%23fff%27 stroke-width=%271.9%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E">
<link rel="stylesheet" href="/plotter/style.css?v=14">
<link rel="stylesheet" href="/pages.css?v=1">
</head>
<body>
<header class="top">
  <a class="brand" href="/plotter/"><svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><rect x="1.5" y="1.5" width="21" height="21" rx="6.5" fill="var(--accent)"/><path d="M7 15.5 11 9l3 4 3-5" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>DWG Plotter</a>
  <span class="private">Your drawings are never uploaded</span>
</header>
<main class="doc">
$(cat "pages/$slug.body.html")
</main>
<footer class="foot">Free software (GPL v3). <a href="https://github.com/Anderton722/dwgplotter" rel="noopener">Source code</a> · <a href="https://github.com/Anderton722/dwgplotter/blob/main/NOTICE.md" rel="noopener">Credits</a> · <a href="/privacy/">Privacy</a> · <a href="/dwg-to-pdf/">DWG to PDF</a> · <a href="/open-dwg-without-autocad/">Open DWG without AutoCAD</a> · <a href="/dxf-to-pdf/">DXF to PDF</a></footer>
</body>
</html>
EOF
}
page dwg-to-pdf "How to Convert DWG to PDF Free, Without AutoCAD" "Convert a DWG drawing to PDF free in your browser. Plots each layout as drawn, keeps lineweights, black and white or colour. Nothing is uploaded."
page open-dwg-without-autocad "How to Open a DWG File Without AutoCAD" "Ways to open and read a DWG drawing when you do not have AutoCAD, including a free in-browser viewer that saves the drawing as a PDF."
page dxf-to-pdf "DXF to PDF: Convert a DXF Drawing Free Online" "Convert a DXF drawing to PDF free in your browser. Prints the model drawing with lineweights and linetypes. Nothing is uploaded."
page privacy "Privacy Policy" "How DWG Plotter handles your drawings and data. Drawings are read in your browser and are never uploaded."
