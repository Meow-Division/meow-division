# gen/itemicons.py — puts the item icons into the game: each art/icons/items2/<token id>.png (1024 px, transparent) is
# cut to what it shows, centred on a square with the same margin for every icon (so they line up in the inventory),
# and saved as live/assets/it_<token id>.png at 256 px. Files in items2 that are not item ids (sources, old tries)
# are skipped. Run: python gen/itemicons.py
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'art' / 'icons' / 'items2'
OUT = ROOT / 'live' / 'assets'
SIZE = 256
FILL = 0.88  # the icon's longer side takes this share of the square

ids = re.findall(r"\{ id: '([a-z0-9_]+)', kind:", (ROOT / 'live' / 'economy.js').read_text(encoding='utf-8'))
done, missing = [], []
for item in ids:
    f = SRC / f'{item}.png'
    if not f.exists():
        missing.append(item)
        continue
    im = Image.open(f).convert('RGBA')
    a = im.getchannel('A').point(lambda v: 0 if v < 8 else v)  # stray near-invisible specks do not count as content
    clear = Image.new('RGBA', im.size, (0, 0, 0, 0))
    clear.paste(im, mask=a)  # colour under full transparency zeroed: no tint in any viewer
    box = a.getbbox()
    if not box:
        sys.exit(f'{f.name} is empty')
    art = clear.crop(box)
    w, h = art.size
    side = round(max(w, h) / FILL)
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.alpha_composite(art, ((side - w) // 2, (side - h) // 2))
    sq.resize((SIZE, SIZE), Image.LANCZOS).save(OUT / f'it_{item}.png', optimize=True)
    done.append(item)

print(f'{len(done)} icons written to live/assets')
if missing:
    print('no icon yet:', ' '.join(missing))
