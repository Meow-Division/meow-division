---
paths:
  - "live/*.js"
  - "live/*.html"
  - "live/*.css"
---
# Client (`live/`): plain browser scripts, no bundler

- Scripts load in the order of `SCRIPTS` in `live/index.html` (`<script async=false>`); a new module goes into `SCRIPTS`, `WATCH` (dev live-reload), and, if the server needs it, `SIM_FILES` in `server/server.mjs`. `gen/build.mjs` leaves out `*.cjs`, `editor.js`, `heroeditor.js`.
- One UPPERCASE global per file, set in an IIFE. Modules talk through those globals and small event callbacks; no hidden shared mutable state between files.
- Asset versions: dev is always fresh; a packed build stamps everything with one `?v=`; a picture redrawn after a build needs its own `v` in `assets.js`; a hot-patched script needs a `window.__VER` entry. Pictures are PNG in `live/assets/` with `.webp` twins made by the build; names use the existing prefixes (`i_` icons, `iso_`/`bld_` props, `lob_` lobby, `x_` fx, `ui_`).
- Player-facing text only via `I18N.t('section.key')`; all four packs updated together; `node gen/langcheck.mjs` must pass (same keys, same `{slots}`, no Cyrillic in `live/*.js|html|css`).
- No chain words in the UI (mint, NFT, token, gas, transaction, sign). Wallet actions appear as "connect", "sent to your wallet", "yours". Nothing chain-related interrupts a run.
- UI kit: `.panel` and `.btn` (chamfered, custom properties `--c --ed --fill --rim`), variants `.orange .gold .ghost`, cards `.lv`. Screens are template literals shown with `show(html, 'cls')`; `esc()` for outside text. No inline styles, no second kit.
- Layout works on a phone in landscape, inside the Telegram frame (safe-area CSS variables `--sl --st --sr --sb`, `--uar`) and at 2.4:1. Overlays go through `fit()` so cards never scroll. Test at 738×393 and 915×412.
- Performance: the run draws through `scene.js` batches; new effects respect `SCENE.fxk` and the FX budgets; no per-frame allocations in hot paths (scratch buffers); nothing heavy on the main thread during a run (ground painting is a Worker).
- Touch: left half moves, right half aims; new in-run buttons also react to `pointerup` (a tap while a stick is held sends no click).
- Wallet (`wallet.js`): one wallet window per user tap (`selectWallet` + `connect({ signMessageParams })`); never a second popup without a tap; no auto-fullscreen while connecting.
- Hub mode (`hub.js`): Copper walks the base with the same sim step for movement but no spawns; interaction = stand near a person or building and press/tap once; every building shows its needs list from `ECONOMY`.
- Dev-only features (`?dev`, `?lab`, editors) stay out of the packed build and never change behaviour for players.
