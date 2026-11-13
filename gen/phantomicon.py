# gen/phantomicon.py — the Phantom's two pictures from its render (gen/blender/phantomgun.py icon art/guns3d/phantom/icon.png): tipped
# up to the right as the item pictures lean, with the dark ink edge they have, then
#   art/icons/items2/phantom.png  (1024 px square: gen/itemicons.py makes the stash's live/assets/it_phantom.png of it)
#   live/assets/i_phantom.png     (cut to what it shows, 640 px wide: the gun pictures the lobby, the workshop and the co-op show)
# Run: python gen/phantomicon.py
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
im = Image.open(ROOT / 'art' / 'guns3d' / 'phantom' / 'icon.png').convert('RGBA')
im = im.crop(im.getchannel('A').getbbox())
pad = 60
big = Image.new('RGBA', (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
big.alpha_composite(im, (pad, pad))
big = big.rotate(16, resample=Image.BICUBIC, expand=True)
a = big.getchannel('A').point(lambda v: 255 if v > 40 else 0)
ink = a.filter(ImageFilter.MaxFilter(17)).filter(ImageFilter.GaussianBlur(1.2))  # the edge: ~8 px round it at 1024
back = Image.new('RGBA', big.size, (26, 22, 22, 255))
back.putalpha(ink)
art = Image.new('RGBA', big.size, (0, 0, 0, 0))
art.alpha_composite(back)
art.alpha_composite(big)
art = art.crop(art.getchannel('A').getbbox())
side = max(art.size)
sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
sq.alpha_composite(art, ((side - art.width) // 2, (side - art.height) // 2))
sq.resize((1024, 1024), Image.LANCZOS).save(ROOT / 'art' / 'icons' / 'items2' / 'phantom.png')
w = 640
art.resize((w, round(art.height * w / art.width)), Image.LANCZOS).save(ROOT / 'live' / 'assets' / 'i_phantom.png', optimize=True)
print('phantom pictures written')
