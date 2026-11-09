// gen/chainargs.mjs — writes the exact JSON arguments for the items contract's mainnet set-up into contract/mainnet/:
// `new` (the init call), `register_tokens` (every item, trophy and kit in live/economy.js, named from live/lang_en.js)
// and `set_recipes` (every recipe in live/economy.js), plus the token id list the read-only checks use. The human
// passes these files to near-cli with `file-args` (contract/mainnet/DEPLOY.md), so no JSON is typed by hand and
// nothing on chain can drift from the game's own numbers. test/chainargs.test.mjs fails when a file is stale.
// Run: node gen/chainargs.mjs          (writes the files)
//      node gen/chainargs.mjs --check  (exit 1 if a file differs from what would be written)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = path.join(ROOT, 'live');
export const OUT_DIR = path.join(ROOT, 'contract', 'mainnet');

// The packed build (gen/build.mjs) copies live/ to the site root, so live/assets/it_<id>.png is served here.
// No media_hash: the site resizes the icons and sends a .webp twin under the same URL to browsers that accept it,
// so no single byte hash would match what a wallet downloads.
const MEDIA_URL = 'https://game.meowdivision.fun/assets/';
const CONTRACT_NAME = 'Meow Division items';
// Mirrors MAX_BATCH in contract/src/lib.rs: register_tokens and set_recipes refuse more per call.
const MAX_BATCH = 50;
// Mirrors check_id in contract/src/lib.rs.
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;

const require = createRequire(import.meta.url);
const E = require(path.join(LIVE, 'economy.js'));

// English item names: the en pack is the base every other pack translates.
function englishNames() {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(LIVE, 'i18n.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(LIVE, 'lang_en.js'), 'utf8'), ctx);
  return ctx.I18N.packs.en.item;
}

// The mainnet account ids, read from .env.example (the documented defaults), so they are written in one place.
function accounts() {
  const env = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const get = (name) => {
    const m = env.match(new RegExp(`^${name}=(\\S+)$`, 'm'));
    if (!m) throw new Error(`.env.example has no ${name}`);
    return m[1];
  };
  return {
    game: get('NEAR_GAME_ACCOUNT'),
    items: get('NEAR_ITEMS_CONTRACT'),
    walt: get('NEAR_WALT_ACCOUNT'),
  };
}

function checkId(id, what) {
  if (!ID.test(id)) throw new Error(`bad ${what} for the contract: ${id}`);
}

function tokenSpec(item, names) {
  const name = names[item.id];
  if (typeof name !== 'string' || !name) throw new Error(`live/lang_en.js has no item.${item.id}`);
  if (!fs.existsSync(path.join(LIVE, 'assets', `it_${item.id}.png`))) throw new Error(`no icon it_${item.id}.png`);
  checkId(item.id, 'token id');
  // Fields left out are null on chain (Option in contract/src/metadata.rs). decimals "0": items are whole.
  return {
    token_id: item.id,
    base: { name, id: item.id, decimals: '0' },
    token: {
      title: name,
      media: `${MEDIA_URL}it_${item.id}.png`,
      extra: JSON.stringify({ kind: item.kind, rarity: item.rarity }),
    },
  };
}

function part([tokenId, amount], known, recipeId) {
  if (!known.has(tokenId)) throw new Error(`recipe ${recipeId} uses an unknown item ${tokenId}`);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error(`recipe ${recipeId}: ${tokenId} × ${amount}`);
  return { token_id: tokenId, amount: String(amount) };
}

function recipe(r, known) {
  checkId(r.id, 'recipe id');
  return {
    id: r.id,
    inputs: r.inputs.map((p) => part(p, known, r.id)),
    outputs: [part(r.output, known, r.id)],
  };
}

// One call takes at most MAX_BATCH entries; a longer list goes into numbered files, sent in order.
function batches(name, key, list) {
  const out = {};
  const count = Math.ceil(list.length / MAX_BATCH);
  for (let i = 0; i < count; i++) {
    const file = count === 1 ? `${name}.json` : `${name}_${i + 1}.json`;
    out[file] = { [key]: list.slice(i * MAX_BATCH, (i + 1) * MAX_BATCH) };
  }
  return out;
}

// Every file this tool writes: file name → args object.
export function chainArgs() {
  const names = englishNames();
  const acc = accounts();
  const tokens = E.ITEMS.map((it) => tokenSpec(it, names));
  const known = new Set(tokens.map((t) => t.token_id));
  if (known.size !== tokens.length) throw new Error('a token id appears twice in live/economy.js');
  const recipes = E.RECIPES.map((r) => recipe(r, known));
  return {
    'new.json': { owner_id: acc.game, game_signer_id: acc.items, walt_id: acc.walt, name: CONTRACT_NAME },
    ...batches('register_tokens', 'tokens', tokens),
    ...batches('set_recipes', 'recipes', recipes),
    'token_ids.json': { token_ids: tokens.map((t) => t.token_id) },
  };
}

export const render = (args) => JSON.stringify(args, null, 2) + '\n';

function main() {
  const files = chainArgs();
  const check = process.argv.includes('--check');
  const stale = [];
  if (!check) fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [file, args] of Object.entries(files)) {
    const at = path.join(OUT_DIR, file);
    const text = render(args);
    const bytes = Buffer.byteLength(text);
    const was = fs.existsSync(at) ? fs.readFileSync(at, 'utf8') : null;
    let note = '';
    if (was !== text) {
      stale.push(file);
      note = check ? '  STALE' : '  written';
    }
    if (!check && was !== text) fs.writeFileSync(at, text);
    console.log(`${file.padEnd(24)} ${String(bytes).padStart(6)} bytes${note}`);
  }
  // A file from an earlier, longer split would be sent by mistake: name it.
  const extra = fs.existsSync(OUT_DIR)
    ? fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.json') && !(f in files))
    : [];
  for (const f of extra) console.log(`${f.padEnd(24)} not written by this tool: delete it`);
  if (check && (stale.length || extra.length)) {
    console.log('fails: run node gen/chainargs.mjs');
    process.exit(1);
  }
  console.log('ok');
}

// Run as a script, not when test/chainargs.test.mjs imports chainArgs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
