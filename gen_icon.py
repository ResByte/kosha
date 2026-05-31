"""Generate Kosha app icon — 1024x1024 PNG."""
from PIL import Image, ImageDraw, ImageFont
import math

SIZE = 1024
RADIUS = 180  # rounded corner radius

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# ── Background: deep indigo-to-amber gradient ─────────────────────────────────
grad = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
grad_draw = ImageDraw.Draw(grad)
top    = (30,  22,  74)   # deep indigo
bottom = (139, 78,  19)   # warm amber-brown
for y in range(SIZE):
    t = y / SIZE
    r = int(top[0] + (bottom[0] - top[0]) * t)
    g = int(top[1] + (bottom[1] - top[1]) * t)
    b = int(top[2] + (bottom[2] - top[2]) * t)
    grad_draw.line([(0, y), (SIZE, y)], fill=(r, g, b, 255))

# Rounded-rect mask
mask = Image.new("L", (SIZE, SIZE), 0)
mask_draw = ImageDraw.Draw(mask)
mask_draw.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=RADIUS, fill=255)
img.paste(grad, (0, 0), mask)

draw = ImageDraw.Draw(img)


# ── "K" letterform — drawn as thick bezier-like polylines ────────────────────
S = 1.28
cx, cy = SIZE // 2, SIZE // 2 + 20
stroke = int(88 * S)
ivory  = (255, 245, 210, 255)   # warm cream — main K color
ivory2 = (240, 225, 185, 255)   # slightly deeper for upper diagonal
white  = (255, 255, 255, 255)

# K geometry
left   = cx - int(165 * S)
right  = cx + int(175 * S)
top_y  = cy - int(260 * S)
bot_y  = cy + int(280 * S)
mid_y  = cy - int(15 * S)

# Vertical bar of K
def thick_line(draw, x0, y0, x1, y1, width, color):
    """Draw an anti-aliased thick line using an ellipse-capped polygon."""
    dx, dy = x1 - x0, y1 - y0
    length = math.hypot(dx, dy)
    if length == 0:
        return
    ux, uy = -dy / length, dx / length
    hw = width / 2
    pts = [
        (x0 + ux * hw, y0 + uy * hw),
        (x1 + ux * hw, y1 + uy * hw),
        (x1 - ux * hw, y1 - uy * hw),
        (x0 - ux * hw, y0 - uy * hw),
    ]
    draw.polygon(pts, fill=color)
    draw.ellipse([x0 - hw, y0 - hw, x0 + hw, y0 + hw], fill=color)
    draw.ellipse([x1 - hw, y1 - hw, x1 + hw, y1 + hw], fill=color)

# Vertical stroke
thick_line(draw, left, top_y, left, bot_y, stroke, ivory)

# Upper diagonal of K (mid → top-right)
thick_line(draw, left + stroke * 0.35, mid_y, right, top_y + 30, stroke, ivory2)

# Lower diagonal of K (mid → bottom-right)
thick_line(draw, left + stroke * 0.35, mid_y, right, bot_y - 30, stroke, ivory)

# Small serif notch at mid-join (white accent)
notch = stroke * 0.55
thick_line(draw, left - 4, mid_y - notch, left + stroke * 0.5, mid_y, int(stroke * 0.45), white)

# ── Hash mark — tiny, top-right corner, subtle ───────────────────────────────
hx, hy = cx + int(235 * S), cy - int(235 * S)
hs = int(54 * S)
ht = int(10 * S)
hash_color = (255, 255, 255, 140)
# two horizontal bars
draw.rounded_rectangle([hx - hs, hy - ht, hx + hs, hy + ht], radius=ht, fill=hash_color)
draw.rounded_rectangle([hx - hs, hy + hs//2 - ht, hx + hs, hy + hs//2 + ht], radius=ht, fill=hash_color)
# two vertical bars
draw.rounded_rectangle([hx - hs//2 - ht, hy - hs*0.6, hx - hs//2 + ht, hy + hs*1.1], radius=ht, fill=hash_color)
draw.rounded_rectangle([hx + hs//2 - ht, hy - hs*0.6, hx + hs//2 + ht, hy + hs*1.1], radius=ht, fill=hash_color)


# ── Save ──────────────────────────────────────────────────────────────────────
out = "icon.png"
img.save(out, "PNG")
print(f"Saved {out} ({SIZE}x{SIZE})")
