# Tells Bing (and other IndexNow engines) about every URL in dist/sitemap.xml. Run after a deploy is live.
import json, re, sys, urllib.request

KEY = '19b80853c466891e670ada0ac219a97b'
urls = re.findall(r'<loc>([^<]+)</loc>', open('dist/sitemap.xml', encoding='utf-8').read())
body = json.dumps({'host': 'dwgplotter.com', 'key': KEY,
                   'keyLocation': f'https://dwgplotter.com/{KEY}.txt', 'urlList': urls}).encode()
req = urllib.request.Request('https://api.indexnow.org/indexnow', body,
                             {'Content-Type': 'application/json; charset=utf-8'})
try:
    with urllib.request.urlopen(req) as r:
        print(r.status, len(urls), 'urls')
except urllib.error.HTTPError as e:
    sys.exit(f'{e.code} {e.read().decode()[:300]}')
