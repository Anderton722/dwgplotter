"""Writes plotter/sample.dxf: an original sample drawing (a small house, plan and front elevation) that anyone may use.
Two drawings sit apart in the model, each with its title underneath, so the plotter's Smart plot finds two sheets.
Units are millimetres, drawn at full size; the captions give the intended print scale, 1:100. Run: py tools/make_sample.py"""
import math, pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / 'plotter' / 'sample.dxf'
# name, colour (ACI), lineweight (1/100 mm), linetype
LAYERS = [('0', 7, 25, 'CONTINUOUS'), ('A-WALL', 7, 50, 'CONTINUOUS'), ('A-DOOR', 3, 25, 'CONTINUOUS'),
          ('A-GLAZ', 4, 25, 'CONTINUOUS'), ('A-FURN', 8, 18, 'CONTINUOUS'), ('A-ROOF', 6, 18, 'DASHED'),
          ('A-DIMS', 1, 18, 'CONTINUOUS'), ('A-TEXT', 2, 25, 'CONTINUOUS'), ('A-ELEV', 7, 35, 'CONTINUOUS'),
          ('A-GRND', 7, 70, 'CONTINUOUS'), ('TITLE', 7, 35, 'CONTINUOUS')]
ents = []

def g(*pairs):  # group codes and values
    return ''.join(f'{c}\n{v}\n' for c, v in pairs)

def line(lay, x1, y1, x2, y2):
    ents.append(g((0, 'LINE'), (8, lay), (10, x1), (20, y1), (30, 0), (11, x2), (21, y2), (31, 0)))

def poly(lay, pts, closed=False):
    s = g((0, 'LWPOLYLINE'), (8, lay), (90, len(pts)), (70, 1 if closed else 0))
    ents.append(s + ''.join(g((10, x), (20, y)) for x, y in pts))

def rect(lay, x, y, w, h):
    poly(lay, [(x, y), (x + w, y), (x + w, y + h), (x, y + h)], True)

def arc(lay, cx, cy, r, a1, a2):
    ents.append(g((0, 'ARC'), (8, lay), (10, cx), (20, cy), (30, 0), (40, r), (50, a1), (51, a2)))

def circle(lay, cx, cy, r):
    ents.append(g((0, 'CIRCLE'), (8, lay), (10, cx), (20, cy), (30, 0), (40, r)))

def text(lay, x, y, h, s, align=0, rot=0):  # align: 0 left, 1 centre
    e = [(0, 'TEXT'), (8, lay), (10, x), (20, y), (30, 0), (40, h), (1, s), (50, rot)]
    if align: e += [(72, align), (11, x), (21, y), (31, 0)]
    ents.append(g(*e))

def dim(x1, y1, x2, y2, off, label=None):  # aligned dimension drawn with lines, ticks and text
    dx, dy = x2 - x1, y2 - y1; L = math.hypot(dx, dy); ux, uy = dx / L, dy / L; nx, ny = -uy, ux
    a, b = (x1 + nx * off, y1 + ny * off), (x2 + nx * off, y2 + ny * off)
    s = 1 if off > 0 else -1
    line('A-DIMS', x1 + nx * 150 * s, y1 + ny * 150 * s, a[0] + nx * 150 * s, a[1] + ny * 150 * s)
    line('A-DIMS', x2 + nx * 150 * s, y2 + ny * 150 * s, b[0] + nx * 150 * s, b[1] + ny * 150 * s)
    line('A-DIMS', a[0] - ux * 200, a[1] - uy * 200, b[0] + ux * 200, b[1] + uy * 200)
    for p in (a, b):  # architectural ticks
        line('A-DIMS', p[0] - 120 * (ux + nx), p[1] - 120 * (uy + ny), p[0] + 120 * (ux + nx), p[1] + 120 * (uy + ny))
    ang = math.degrees(math.atan2(dy, dx))
    text('A-DIMS', (a[0] + b[0]) / 2 + nx * 120, (a[1] + b[1]) / 2 + ny * 120, 220, label or f'{round(L)}', 1, ang)

def door(hx, hy, w, ang, swing=1):  # hinge point, leaf width, wall direction (deg), swing side
    t = math.radians(ang); px, py = hx + w * math.cos(t + swing * math.pi / 2), hy + w * math.sin(t + swing * math.pi / 2)
    line('A-DOOR', hx, hy, px, py)
    a1, a2 = (ang, ang + 90) if swing == 1 else (ang - 90, ang)
    arc('A-DOOR', hx, hy, w, a1 % 360, a2 % 360)

def window_h(x1, x2, y, t):  # window in a horizontal wall: frame ends and two glass lines
    for x in (x1, x2): line('A-GLAZ', x, y, x, y + t)
    line('A-GLAZ', x1, y + t * .4, x2, y + t * .4); line('A-GLAZ', x1, y + t * .6, x2, y + t * .6)

def window_v(y1, y2, x, t):
    for y in (y1, y2): line('A-GLAZ', x, y, x + t, y)
    line('A-GLAZ', x + t * .4, y1, x + t * .4, y2); line('A-GLAZ', x + t * .6, y1, x + t * .6, y2)

def caption(x, y, title):  # drawing title under each drawing, kept close so Smart plot keeps it with the drawing
    text('TITLE', x, y, 450, title); line('TITLE', x, y - 150, x + 7500, y - 150)
    text('A-TEXT', x, y - 600, 250, 'Scale 1:100. Dimensions in mm. DWG Plotter sample drawing, free to use.')

# ---- drawing 1: ground floor plan ----
X, Y, W, H, T, t = 8000, 9000, 12000, 8000, 300, 100  # house origin, size, outer and inner wall thickness
caption(X, Y - 2300, 'GROUND FLOOR PLAN')
# outer walls with openings: front door (bottom, x 5200-6100), windows cut by glazing over the wall lines
poly('A-WALL', [(X + 5200, Y), (X, Y), (X, Y + H), (X + W, Y + H), (X + W, Y), (X + 6100, Y)])
poly('A-WALL', [(X + 5200, Y + T), (X + T, Y + T), (X + T, Y + H - T), (X + W - T, Y + H - T), (X + W - T, Y + T), (X + 6100, Y + T)])
line('A-WALL', X + 5200, Y, X + 5200, Y + T); line('A-WALL', X + 6100, Y, X + 6100, Y + T)
door(X + 5200, Y + T, 900, 0, 1)
window_h(X + 1200, X + 3600, Y, T); window_h(X + 8000, X + 10200, Y, T)
window_h(X + 1500, X + 4200, Y + H - T, T); window_h(X + 7600, X + 9400, Y + H - T, T)
window_v(Y + 2500, Y + 4500, X, T); window_v(Y + 5000, Y + 6600, X + W - T, T)
# internal walls: living on the left; bedroom (bottom) and kitchen (top) on the right, each with a door from the living room
ix = X + 6800
for x in (ix, ix + t):
    line('A-WALL', x, Y + T, x, Y + 2400); line('A-WALL', x, Y + 3300, x, Y + 5600); line('A-WALL', x, Y + 6500, x, Y + H - T)
for y in (Y + 2400, Y + 3300, Y + 5600, Y + 6500): line('A-WALL', ix, y, ix + t, y)
door(ix + t, Y + 2400, 900, 90, -1); door(ix + t, Y + 5600, 900, 90, -1)
hy = Y + 4300  # wall between bedroom and kitchen
line('A-WALL', ix + t, hy, X + W - T, hy); line('A-WALL', ix + t, hy + t, X + W - T, hy + t)
# furniture
rect('A-FURN', X + 900, Y + 4800, 900, 2400); rect('A-FURN', X + 900, Y + 4800, 2400, 900)  # corner sofa
rect('A-FURN', X + 2600, Y + 1300, 1600, 900); circle('A-FURN', X + 3400, Y + 1750, 250)  # dining table
rect('A-FURN', X + 9800, Y + 900, 1600, 2000); rect('A-FURN', X + 9900, Y + 2550, 1400, 300)  # bed and pillows
rect('A-FURN', X + W - T - 600, Y + 4400, 600, 3200)  # kitchen worktop
circle('A-FURN', X + W - T - 300, Y + 6800, 180); rect('A-FURN', X + W - T - 560, Y + 5300, 520, 520)  # sink, hob
# roof overhang (dashed) and labels
rect('A-ROOF', X - 500, Y - 500, W + 1000, H + 1000)
text('A-TEXT', X + 3300, Y + 3800, 350, 'LIVING', 1); text('A-TEXT', X + 3300, Y + 3350, 220, '33.6 m²', 1)
text('A-TEXT', X + 9800, Y + 6300, 350, 'KITCHEN', 1); text('A-TEXT', X + 9800, Y + 2000, 350, 'BEDROOM', 1)
text('A-TEXT', X + 5650, Y - 1200, 250, 'ENTRANCE', 1)
dim(X, Y + H, X + W, Y + H, 1600); dim(X, Y, X, Y + H, 1600)
dim(X, Y, X + 5200, Y, -1600); dim(X + 5200, Y, X + 6100, Y, -1600); dim(X + 6100, Y, X + W, Y, -1600)
nx, ny = X + W + 1100, Y + H - 800  # north arrow, touching the roof line
circle('A-TEXT', nx, ny, 600); poly('A-TEXT', [(nx, ny + 800), (nx - 300, ny - 400), (nx + 300, ny - 400)], True); text('A-TEXT', nx, ny + 1050, 350, 'N', 1)

# ---- drawing 2: front elevation ----
ex, ey, eh = 38000, 9000, 2700
caption(ex, ey - 2100, 'FRONT ELEVATION')
line('A-GRND', ex - 3000, ey, ex + W + 3000, ey)
rect('A-ELEV', ex, ey, W, eh)
poly('A-ELEV', [(ex - 500, ey + eh), (ex + W / 2, ey + eh + 2600), (ex + W + 500, ey + eh)], True)  # roof
line('A-ELEV', ex - 500, ey + eh - 200, ex + W + 500, ey + eh - 200)  # fascia
rect('A-ELEV', ex + 7600, ey + eh + 1000, 700, 1800)  # chimney
for x1, x2 in ((1200, 3600), (8000, 10200)):  # front windows as in the plan
    rect('A-GLAZ', ex + x1, ey + 900, x2 - x1, 1300); line('A-GLAZ', ex + (x1 + x2) / 2, ey + 900, ex + (x1 + x2) / 2, ey + 2200)
    rect('A-ELEV', ex + x1 - 100, ey + 800, x2 - x1 + 200, 100)  # sill
rect('A-DOOR', ex + 5200, ey, 900, 2100)
for k in range(3): rect('A-DOOR', ex + 5350, ey + 200 + k * 620, 600, 500)
circle('A-DOOR', ex + 5950, ey + 1050, 40)
rect('A-ELEV', ex + 5000, ey + 2100, 1300, 120)  # canopy
dim(ex + W, ey, ex + W, ey + eh, -1500); dim(ex + W, ey, ex + W, ey + eh + 2600, -2600, '5300')
dim(ex, ey, ex + W, ey, -1400)
text('A-TEXT', ex - 2500, ey + 150, 250, 'GROUND LEVEL')

# ---- write the file ----
hdr = g((0, 'SECTION'), (2, 'HEADER'), (9, '$ACADVER'), (1, 'AC1015'), (9, '$INSUNITS'), (70, 4), (9, '$MEASUREMENT'), (70, 1),
        (9, '$LTSCALE'), (40, 100), (9, '$EXTMIN'), (10, 0), (20, 0), (30, 0), (9, '$EXTMAX'), (10, 56000), (20, 18000), (30, 0), (0, 'ENDSEC'))
lt = g((0, 'TABLE'), (2, 'LTYPE'), (70, 2),
       (0, 'LTYPE'), (2, 'CONTINUOUS'), (70, 0), (3, 'Solid line'), (72, 65), (73, 0), (40, 0.0),
       (0, 'LTYPE'), (2, 'DASHED'), (70, 0), (3, 'Dashed __ __ __'), (72, 65), (73, 2), (40, 9.0), (49, 6.0), (49, -3.0), (0, 'ENDTAB'))
la = g((0, 'TABLE'), (2, 'LAYER'), (70, len(LAYERS))) + ''.join(
    g((0, 'LAYER'), (2, n), (70, 0), (62, c), (6, l), (370, w)) for n, c, w, l in LAYERS) + g((0, 'ENDTAB'))
body = hdr + g((0, 'SECTION'), (2, 'TABLES')) + lt + la + g((0, 'ENDSEC'), (0, 'SECTION'), (2, 'ENTITIES')) + ''.join(ents) + g((0, 'ENDSEC'), (0, 'EOF'))
OUT.write_text(body, encoding='utf-8', newline='\r\n')
print(f'wrote {OUT} ({len(ents)} entities, {OUT.stat().st_size // 1024} KB)')
