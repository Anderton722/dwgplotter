"""Fills a page's data-i18n text in at build time, so search engines see each language without running JavaScript.
  py tools/prerender.py <lang> <page.html>    rewrites the page in place (the app still fills the same text in when it loads)"""
import html, pathlib, re, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from ldjson import strings

def render(lang, page):
    d, en = strings(lang), strings('en')
    t = lambda k: d.get(k, en.get(k, ''))
    src = open(page, encoding='utf-8', newline='').read()
    src = re.sub(r'(<(\w+)\b[^>]*\sdata-i18n="([\w.]+)"[^>]*>)(.*?)(</\2>)', lambda m: m[1] + html.escape(t(m[3]), quote=False) + m[5], src, flags=re.S)
    src = re.sub(r'(<(\w+)\b[^>]*\sdata-i18n-html="([\w.]+)"[^>]*>)(.*?)(</\2>)', lambda m: m[1] + t(m[3]) + m[5], src, flags=re.S)
    def attrs(m):
        tag = m[0]
        for a, k in (p.split(':') for p in m[1].split(',')):
            v = html.escape(t(k))
            tag = re.sub(r'\s%s="[^"]*"' % re.escape(a), '', tag)
            tag = tag[:-1].rstrip('/').rstrip() + f' {a}="{v}"' + ('/>' if tag.endswith('/>') else '>')
        return tag
    src = re.sub(r'<[^<>]*\sdata-i18n-attr="([^"]+)"[^<>]*>', attrs, src)
    if lang != 'en': # links to the guides go to the same guide in this language
        src = re.sub(r'href="/([a-z0-9-]+)/"', lambda m: m[0] if m[1] in ('es', 'fr', 'de', 'zh', 'plotter') else f'href="/{lang}/{m[1]}/"', src)
    open(page, 'w', encoding='utf-8', newline='').write(src)

if __name__ == '__main__':
    render(sys.argv[1], sys.argv[2])
