# Generate the README title image: a Mars-green (#018B8D) rounded card with the app logo +
# "API YES" in Excalifont (the app's hand-drawn English face). Pairs with the logo's Hermès orange.
# Run:  python gen-title.py   (needs Pillow; the conda `base` env has it)
from PIL import Image, ImageDraw, ImageFont

FONT = "src/renderer/public/fonts/Excalifont-Regular.woff2"
LOGO = "assets/logo.png"
OUT = "img/title.png"

SS = 2  # supersample, then downscale for smooth anti-aliased edges
F = 300            # text size (render scale)
LOGO_H = 470       # logo height (render scale)
GAP = 12           # logo↔text gap (the logo art has its own transparent padding)
PAD_X, PAD_Y = 90, 72
RADIUS = 80
BORDER = 0

TEAL = (1, 139, 141, 255)        # #018B8D  马尔斯绿
CREAM = (255, 247, 234, 255)     # warm off-white text
BORDER_COL = (1, 110, 112, 255)  # subtle darker teal

font = ImageFont.truetype(FONT, F)
logo = Image.open(LOGO).convert("RGBA")
print("logo mode/size:", logo.mode, logo.size, "| corner alpha:", logo.getpixel((2, 2)))
lw = round(LOGO_H * logo.width / logo.height)
logo = logo.resize((lw, LOGO_H), Image.LANCZOS)

# measure text ink box
probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
l, t, r, b = probe.textbbox((0, 0), "API YES", font=font, anchor="la")
tw, th = r - l, b - t

content_h = max(LOGO_H, th)
panel_w = PAD_X + lw + GAP + tw + PAD_X
panel_h = content_h + 2 * PAD_Y

img = Image.new("RGBA", (panel_w, panel_h), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([0, 0, panel_w - 1, panel_h - 1], radius=RADIUS, fill=TEAL,
                    outline=BORDER_COL if BORDER else None, width=BORDER)

logo_y = PAD_Y + (content_h - LOGO_H) // 2
img.paste(logo, (PAD_X, logo_y), logo)

tx = PAD_X + lw + GAP
ty = PAD_Y + (content_h - th) // 2
d.text((tx - l, ty - t), "API YES", font=font, fill=CREAM, anchor="la")

final = img.resize((round(panel_w / SS), round(panel_h / SS)), Image.LANCZOS)
final.save(OUT)
print("wrote", OUT, final.size, "| suggested README width:", round(final.size[0] * 0.62))
