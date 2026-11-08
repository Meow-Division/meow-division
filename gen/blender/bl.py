# Run a Blender script headless: python gen/blender/bl.py <script.py> [args...]
# Blender: the portable 4.5 through the junction C:/Users/IA-Iv/blender45 (its own folder's name has characters Blender's command
# line mangles), or $BLENDER; the project root is this repository. Prints Blender's output, minus its banner noise; exits with its code.
import os, subprocess, sys
try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception: pass

ZH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BL = os.environ.get('BLENDER') or r'C:\Users\IA-Iv\blender45\blender.exe'
if len(sys.argv) < 2: sys.exit(__doc__ or 'usage: python gen/blender/bl.py <script.py> [args...]')
here = os.path.abspath(os.getcwd()); script = os.path.abspath(sys.argv[1])
rel = os.path.relpath(script, here) if script.lower().startswith(here.lower()) else None
target = os.path.join(ZH, rel) if rel else script
env = dict(os.environ, ZH_ROOT=ZH, PYTHONUTF8='1')
# one Blender at a time on this machine (one GPU, 4 GB): several agents share it, so each run waits for the lock
import msvcrt, time
lk = open(os.path.join(os.environ.get('TEMP', '.'), 'zh_blender.lock'), 'a+'); t0 = time.time()
while True:
    try: lk.seek(0); msvcrt.locking(lk.fileno(), msvcrt.LK_NBLCK, 1); break
    except OSError: time.sleep(0.5)
if time.time() - t0 > 2: print(f'(waited {time.time() - t0:.0f}s for another Blender run)')
p = subprocess.run([BL, '-b', '--factory-startup', '--python-exit-code', '3', '--python', target, '--'] + sys.argv[2:],
                   cwd=ZH, env=env, capture_output=True, text=True, encoding='utf-8', errors='replace')
skip = ('Blender 4.5', 'Read prefs', 'Color management', 'Fra:', 'Saved: ', 'Time: ', 'Blender quit', 'register_class')
for line in (p.stdout + p.stderr).splitlines():
    if line.strip() and not line.startswith(skip): print(line)
sys.exit(p.returncode)
