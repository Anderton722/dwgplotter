"""Prints a guide page body with a drop box in place of its first button: a drawing dropped there opens in the app (pages/handoff.js).
Any other buttons on that line (a sample drawing, JPG instead of PNG) stay below the box. Usage: py tools/dropbox.py <body.html> <lang>"""
import re
import sys

TEXT = {
    'en': ('Drop a DWG or DXF file here', 'or click to choose one. It opens straight away, and nothing is uploaded.'),
    'es': ('Suelta aquí un archivo DWG o DXF', 'o haz clic para elegirlo. Se abre al momento y no se sube nada.'),
    'fr': ('Déposez un fichier DWG ou DXF ici', "ou cliquez pour en choisir un. Il s'ouvre aussitôt, et rien n'est envoyé."),
    'de': ('DWG- oder DXF-Datei hier ablegen', 'oder zum Auswählen klicken. Sie öffnet sich sofort, und nichts wird hochgeladen.'),
    'zh': ('将 DWG 或 DXF 文件拖到此处', '或点击选择文件。立即打开，不上传任何内容。'),
    'it': ('Trascina qui un file DWG o DXF', 'oppure fai clic per sceglierlo. Si apre subito e non viene caricato nulla.'),
    'pt': ('Solte aqui um arquivo DWG ou DXF', 'ou clique para escolher. Ele abre na hora e nada é enviado.'),
}

body, lang = sys.argv[1], sys.argv[2]
text = open(body, encoding='utf-8').read()
m = re.search(r'^<p><a class="cta" href="([^"]*)">[^<]*</a>(.*)</p>$', text, re.M)
if m:
    title, sub = TEXT[lang]
    box = (f'<label class="drop handoff" tabindex="0" data-go="{m.group(1)}">\n'
           f'  <input type="file" accept=".dwg,.dxf" multiple hidden>\n'
           f'  <strong>{title}</strong>\n  <span>{sub}</span>\n</label>\n')
    rest = m.group(2).strip()
    if rest:
        box += f'<p class="handoff-more">{rest}</p>\n'
    box += '<script src="/handoff.js?v=1" defer></script>'
    text = text[:m.start()] + box + text[m.end():]
sys.stdout.reconfigure(encoding='utf-8')
sys.stdout.write(text)
