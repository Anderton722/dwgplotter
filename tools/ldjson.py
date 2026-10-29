"""Prints a <script type="application/ld+json"> block for the build (structured data for search engines).
  py tools/ldjson.py home <lang>      the app: SoftwareApplication + FAQPage, with the questions taken from plotter/i18n.js
  py tools/ldjson.py faq <body.html>  a guide: FAQPage from its <h3>question</h3><p>answer</p> pairs (prints nothing if there are none)
The text always matches what the page shows, because it is read from the same source."""
import html, json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
HOME = {'en': '/', 'es': '/es/', 'fr': '/fr/', 'de': '/de/', 'zh': '/zh/'}
HL = {'en': 'en', 'es': 'es', 'fr': 'fr', 'de': 'de', 'zh': 'zh-Hans'}

def strip(s):
    return html.unescape(re.sub(r'<[^>]+>', '', s)).strip()

def faq(pairs):
    return {'@type': 'FAQPage', 'mainEntity': [{'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in pairs]}

def out(obj):
    sys.stdout.reconfigure(encoding='utf-8')
    print('<script type="application/ld+json">' + json.dumps(obj, ensure_ascii=False, separators=(',', ':')) + '</script>')

def home(lang):
    src = (ROOT / 'plotter' / 'i18n.js').read_text(encoding='utf-8')
    block = re.search(r'^const %s = \{(.*?)^\};' % lang, src, re.S | re.M).group(1)
    d = {k: re.sub(r"\\(.)", r'\1', v) for k, v in re.findall(r"'([\w.]+)':\s*'((?:[^'\\]|\\.)*)'", block)}
    d.update({k: re.sub(r"\\(.)", r'\1', v) for k, v in re.findall(r"(?<![\w'.])(\w+):\s*'((?:[^'\\]|\\.)*)'", block)})
    url = 'https://dwgplotter.com' + HOME[lang]
    app = {'@type': 'SoftwareApplication', 'name': 'DWG Plotter', 'url': url, 'description': d['lead'],
           'applicationCategory': 'DesignApplication', 'operatingSystem': 'Any (runs in a web browser)', 'inLanguage': HL[lang],
           'isAccessibleForFree': True, 'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'USD'},
           'license': 'https://www.gnu.org/licenses/gpl-3.0.html', 'image': 'https://dwgplotter.com/og.png',
           'featureList': [d[f'why.{i}t'].rstrip('.。') for i in range(1, 7)]}
    pairs = [(d[f'faq.{i}q'], d[f'faq.{i}a']) for i in range(1, 10) if f'faq.{i}q' in d]
    out({'@context': 'https://schema.org', '@graph': [app, faq(pairs)]})

def guide(path):
    body = pathlib.Path(path).read_text(encoding='utf-8')
    pairs = [(strip(q), strip(a)) for q, a in re.findall(r'<h3>(.*?)</h3>\s*<p>(.*?)</p>', body, re.S)]
    if pairs: out({'@context': 'https://schema.org', **faq(pairs)})

if __name__ == '__main__':
    {'home': home, 'faq': guide}[sys.argv[1]](sys.argv[2])
