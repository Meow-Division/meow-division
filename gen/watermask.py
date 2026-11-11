# gen/watermask.py: the campaign map's water mask, live/assets/mask_water.png (live/campaign.js water()). Run from the repo:
#   python gen/watermask.py [preview.png]
# Red is the bay's water, green the surf round the rocks; the picture is the mask's box on art/campaign/map_src.png (the box,
# x y w h, is printed: campaign.js WATER keeps it). The water: the map's blue below the bridges' horizon, its big patches only,
# the small holes in it (the drawn ripples) filled; the surf: the white next to it, in the inlet only (not the ship or the
# towers). With a path, an overlay of both over the map's bay is saved there to look at.
import sys
from PIL import Image
import numpy as np, cv2
from scipy import ndimage as nd

a = np.asarray(Image.open('art/campaign/map_src.png').convert('RGB'))
hsv = cv2.cvtColor(a, cv2.COLOR_RGB2HSV_FULL).astype(float)
h, s, v = hsv[..., 0] * 360 / 256, hsv[..., 1] / 255, hsv[..., 2] / 255
H, W = v.shape
yy, xx = np.mgrid[0:H, 0:W]
region = (yy >= 258) & (xx >= 740) & ~((xx > 1290) & (yy > 760))  # under the horizon, not the clouds bottom right
water = region & (h >= 188) & (h <= 222) & (s >= 0.42) & (v >= 0.40)
lab, n = nd.label(water)
sizes = nd.sum(water, lab, range(1, n + 1))
m = np.isin(lab, 1 + np.nonzero(sizes > 2500)[0])
holes = nd.binary_fill_holes(m) & ~m
hl, hn = nd.label(holes)
hs = nd.sum(holes, hl, range(1, hn + 1))
m = m | np.isin(hl, 1 + np.nonzero(hs <= 600)[0])  # the ripples drawn on it, not the rocks or the ships
m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)) > 0
near = cv2.dilate(m.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))) > 0
fz = (xx >= 760) & (xx <= 1265) & (yy >= 520) & (yy <= 905) & ~((xx >= 1150) & (yy <= 565)) & ~((xx >= 1040) & (yy >= 838))
foam = fz & near & ~m & (s < 0.32) & (v > 0.72)
foam = cv2.dilate(foam.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
foam &= fz & (~m | ((s < 0.45) & (v > 0.6)))
wa = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 0.8)
fa = cv2.GaussianBlur(foam.astype(np.float32), (0, 0), 0.7)
ys, xs = np.nonzero((wa > 0.02) | (fa > 0.02))
x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
print('box', x0, y0, x1 - x0, y1 - y0)
rgb = np.zeros((H, W, 3), np.uint8)
rgb[..., 0] = np.clip(wa * 255 + 0.5, 0, 255)
rgb[..., 1] = np.clip(fa * 255 + 0.5, 0, 255)
Image.fromarray(rgb[y0:y1, x0:x1]).save('live/assets/mask_water.png', optimize=True)
if len(sys.argv) > 1:
    ov = a.astype(float) * (1 - 0.6 * wa[..., None]) + np.array([255, 0, 60]) * 0.6 * wa[..., None]
    ov = ov * (1 - 0.8 * fa[..., None]) + np.array([0, 255, 0]) * 0.8 * fa[..., None]
    Image.fromarray(ov.astype(np.uint8)[y0:y1, x0:x1]).save(sys.argv[1])
