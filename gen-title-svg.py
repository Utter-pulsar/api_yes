# Generate a VECTOR title SVG: Paris-green (#80E484) rounded panel + logo (cropped to its art and
# enlarged) + "API YES" as true Excalifont vector paths (dark ink, for contrast on the light green).
# fontTools is pure-Python (borrowed from the modelscope env); brotli + PIL come from minimind.
# Run via:  C:\ProgramData\anaconda3\envs\minimind\python.exe gen-title-svg.py
import sys, io, base64
sys.path.append(r"C:\ProgramData\anaconda3\envs\modelscope\Lib\site-packages")
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen
from PIL import Image

FONT = "src/renderer/public/fonts/Excalifont-Regular.woff2"
LOGO = "assets/logo.png"
OUT = "img/title.svg"
TEXT = "API YES"

FONT_PX = 150.0
GAP = 104.0                  # roomier separation between logo and title
PAD_X, PAD_Y = 132.0, 100.0  # wider left/right padding; taller panel so it isn't thin
LOGO_SCALE = 1.0          # logo height == text-ink height (same top-to-bottom extent)
BG = "#018B8D"           # 马尔斯绿 Mars green
INK = "#FFF7EA"          # warm cream text (reads on the teal panel)
RADIUS_FRAC = 0.30

font = TTFont(FONT)
upm = font["head"].unitsPerEm
gs = font.getGlyphSet()
cmap = font.getBestCmap()
hmtx = font["hmtx"]
s = FONT_PX / upm

# lay out glyphs → one combined path (font units, y-up) + ink bounds
d_parts, bounds, cursor = [], BoundsPen(gs), 0
for ch in TEXT:
    gname = cmap.get(ord(ch))
    if gname is None:
        cursor += int(0.32 * upm)  # space fallback
        continue
    pen = SVGPathPen(gs)
    gs[gname].draw(TransformPen(pen, (1, 0, 0, 1, cursor, 0)))
    cmds = pen.getCommands()
    if cmds.strip():
        d_parts.append(cmds)
    gs[gname].draw(TransformPen(bounds, (1, 0, 0, 1, cursor, 0)))
    cursor += hmtx[gname][0]
xmin, ymin, xmax, ymax = bounds.bounds
tw, th = (xmax - xmin) * s, (ymax - ymin) * s

# crop logo to its visible art, then size it relative to the text
logo = Image.open(LOGO).convert("RGBA")
logo = logo.crop(logo.getbbox())
logo_h = th * LOGO_SCALE
logo_w = logo_h * logo.width / logo.height
emb = logo.resize((round(logo_w / logo_h * 400), 400), Image.LANCZOS)  # embed at ~400px tall
buf = io.BytesIO(); emb.save(buf, "PNG"); b64 = base64.b64encode(buf.getvalue()).decode()

content_h = max(logo_h, th)
W = PAD_X + logo_w + GAP + tw + PAD_X
H = content_h + 2 * PAD_Y
radius = H * RADIUS_FRAC
logo_x, logo_y = PAD_X, PAD_Y + (content_h - logo_h) / 2
LX, LY = PAD_X + logo_w + GAP, PAD_Y + (content_h - th) / 2  # text ink top-left
TX, TY = LX - s * xmin, LY + s * ymax  # baseline origin for scale(s,-s)

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W:.0f}" height="{H:.0f}" viewBox="0 0 {W:.0f} {H:.0f}" fill="none">
  <rect x="0" y="0" width="{W:.1f}" height="{H:.1f}" rx="{radius:.1f}" fill="{BG}"/>
  <image x="{logo_x:.1f}" y="{logo_y:.1f}" width="{logo_w:.1f}" height="{logo_h:.1f}" href="data:image/png;base64,{b64}"/>
  <g fill="{INK}" transform="translate({TX:.2f},{TY:.2f}) scale({s:.5f},{-s:.5f})">
    <path d="{' '.join(d_parts)}"/>
  </g>
</svg>
'''
with open(OUT, "w", encoding="utf-8") as f:
    f.write(svg)
print("wrote", OUT, f"{W:.0f}x{H:.0f}", "| suggested README width:", round(W * 0.62))
