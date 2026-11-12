// gen/voice.mjs — the voice lines made with ElevenLabs (docs/voice.md): each line's English with how it is said as audio
// tags ([serious], [matter-of-fact] …), in its speaker's voice — Nova: the library's "Lauren - Friendly, Comforting and
// Soft"; Copper and Walt: the voices the human picked (2026-11-10) — model eleven_v4, into art/voice/raw/<who>_NN.mp3.
// `python gen/radio.py` then makes the game's files (live/audio/voice). A line's words without its tags must be its
// English subtitle (live/lang_en.js voice.<id>): checked first, a line that differs is not made.
//   node --env-file=.env.local gen/voice.mjs [ids…]   (no ids: every line; ids like nova.12 copper.1)
//   --keep   lines whose raw file is there already are left alone; --check: only the words checked, nothing made; --dry:
//   what would be said, printed
//   --lang uk   the Ukrainian (the human's, 2026-11-12: "voice all the missing lines", Walt's Ukrainian voice given): each
//   line's Ukrainian subtitle (live/lang_uk.js voice.<id>) in its speaker's Ukrainian voice (UK below; Nova's and Copper's
//   the ones the human made the first Ukrainian lines with, docs/voice.md), the English line's audio tags put before the
//   same sentences (when the sentences don't pair up, its first tag before all), into art/voice/raw/uk/<who>_NN.mp3; then
//   `python gen/radio.py uk/nova_25 …` and the line in live/voice.js DUB.uk
// The key: ELEVENLABS_API_KEY, from .env.local (never in the code, never printed). A library voice not in the account is
// said straight from the library; --add adds it to the account first (voices.share: the key needs voices_write).
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'),
  RAW = join(ROOT, 'art/voice/raw'),
  MODEL = 'eleven_v4';

// the speakers: voice id, its library name (to add it when the account lacks it), the voice settings (v4 takes only
// stability and similarity: the tags carry the rest)
const VOICES = {
  nova: {
    id: 'DODLEQrClDo8wCz460ld',
    name: 'Lauren - Friendly, Comforting and Soft',
    stability: 0.5,
    similarity: 0.75,
  },
  copper: { id: 'SDARFhQygpPvpLh7Ad1B', name: 'Odd Todd - Nerdy, Pompous Professor', stability: 0.4, similarity: 0.75 },
  walt: { id: '7lJ2JuXZKHyck5zlS7XQ', name: 'Romulus - Deep, Mysterious', stability: 0.5, similarity: 0.75 },
};

// the Ukrainian voices (--lang uk)
const UK = { nova: 'JOQst3wrnXwBfeTEW2ts', copper: '11JUpgNlQsWfppULB2T8', walt: 'WtDqMP4cPOGB6kDiLZgi' };

// the lines, in the order a player hears them (nova.3 and nova.2 are no longer said: not made). Nova is on a mission:
// brisk, never slow (the human, 2026-11-10)
const LINES = {
  'nova.1':
    '[serious] Copper, this is Nova. [firm] Orders stand: clear the base and bring our man Walt out alive. [matter-of-fact] Supplies are at the drop zone. Move out.',
  'nova.19': "[brisk] You're in position. [matter-of-fact] The mission supplies are by the van. Take them.",
  'copper.1': '[calm] Roger that, Nova. Moving out.',
  'nova.24': '[brisk, fast-paced] These are your skills. Each level, take a new one or upgrade one you have.',
  'nova.20': '[alert] Zombies ahead. [firm] Take them out.',
  'nova.4': '[matter-of-fact] Magnet dropped. Take it. It pulls in every crystal around you.',
  'nova.5': '[brisk] Crystals buy skills. Pick one. [serious] Make it count.',
  'nova.21': '[matter-of-fact] Keep moving. Head for the parking lot.',
  'nova.6':
    "[cautious] There are a lot of them on the parking lot. [serious] Don't take them head-on. [matter-of-fact] There's a bomb on the ground ahead. Use it.",
  'nova.7': '[warm] Good work. [matter-of-fact] One of them dropped a medkit. Pick it up and patch yourself up.',
  'nova.22': "[impressed] I see you don't take the easy way. [warm] Grab the medkit and patch yourself up.",
  'nova.8': '[matter-of-fact] Dropping supplies before you go into the building. Grab them.',
  'nova.9':
    "[matter-of-fact] I sent you a clover. Every attack skill has a partner, and the clover is your drone's. [intrigued] Max out the drone with it and it turns into something worse.",
  'nova.10': '[matter-of-fact] Entrance is clear. Walt is inside. Go in. [serious] Eyes open.',
  'copper.2':
    '[calm, quiet] Nova, I see Walt. [matter-of-fact] And there are a hell of a lot of zombies in here. [focused] Starting the sweep.',
  'nova.23': '[concerned] Be careful. [reassuring] You can do this.',
  'nova.11': '[urgent] Big one coming. [firm] Hold the line.',
  'nova.12':
    "[serious] Area's secure, and Walt is safe. Good work, Copper. [matter-of-fact] Welcome to NEAR Base. This is home now.",
  'walt.1':
    "[relieved] Hey Copper, thanks for getting me out. [warm] I've got my old contacts back, so now I can sell you all sorts of things and buy what you bring. [friendly] Come over if you need anything.",
  'nova.13':
    "[matter-of-fact] One more thing. Connect a NEAR wallet. [serious] Without it, your gear doesn't follow you.",
  'nova.14':
    "[serious] The Mushroom Monster in the suburbs is our biggest threat now. [concerned] Its spores are spreading toward the base. [firm] Kill it. [matter-of-fact] Bring back what it drops, plus any planks and screws you find. [dry] The range doesn't build itself.",
  'nova.15': "[urgent] Evac is open. [serious] Leave with what you've got, or stay and finish the job. [firm] Decide.",
  'nova.16': "[relieved] The Monster is down. [concerned] But the spores got you, Copper. [serious] You're infected.",
  'nova.17':
    "[serious] Before the outbreak the lab ran an antivirus program. [firm] Go there and find it. [softly] It's your only cure.",
  'nova.18': '[pleased] Range is open. [matter-of-fact] Test your weapons there before you take them outside.',
  // NEAR Base's tutorial (2026-11-11: hub.js, market.js lesson): Walt teaches the cleaver's sale, Nova the buildings
  'walt.2':
    "[friendly] Let's see what you brought. That cleaver, I'll take it. [matter-of-fact] Pick it on the left, then hold Sell.",
  'walt.3': '[warm] Pleasure doing business. [casual] Now go see Nova, she was asking about you.',
  'nova.25':
    '[brisk] Copper, to get stronger you need upgrades, for you and for your weapons. [matter-of-fact] For that the base needs a generator, a workbench and a medbay. Start with the generator. Find the parts on a raid, or buy them from Walt if he has them.',
  'nova.26':
    '[pleased] Good, we have power. [brisk] Next, the workbench. Clear the room first. Walk up to the junk and hit the gear.',
  'nova.27':
    "[brisk] Room's clear. [matter-of-fact] The workbench needs nuts and bolts, screws, duct tape, a plank and some scrap metal. Check Walt's shelf. If he's out, the suburb has them.",
  'nova.28':
    '[satisfied] The workbench is up. [matter-of-fact] You upgrade your weapons there. New guns you buy from Walt. [brisk] Next, the medbay. Clear the glass room first.',
  'nova.29': '[brisk] The glass room is clear. [matter-of-fact] The medbay needs two antiseptics and three bandages.',
  'nova.30':
    '[warm] The medbay works. Now you can upgrade yourself too. [confident] The rest of the base is yours to build, Copper. You know how.',
  'nova.31': '[alert] That one dropped the parts we need for the base. [firm] Grab them.',
};

// the subtitles (live/lang_en.js, lang_uk.js through a stand-in I18N)
const require = createRequire(import.meta.url);
const PACK = {};
globalThis.I18N = { pack: (id, p) => (PACK[id] = p) };
require(join(ROOT, 'live/lang_en.js'));
require(join(ROOT, 'live/lang_uk.js'));
const subIn = (lg, id) => {
  const [who, n] = id.split('.'),
    v = PACK[lg] && PACK[lg].voice;
  return v && v[who] && v[who][n];
};
const sub = (id) => subIn('en', id);
const words = (s) => s.replace(/\[[^\]]*\]\s*/g, '').trim();

const args = process.argv.slice(2),
  keep = args.includes('--keep'),
  ADD = args.includes('--add'),
  li = args.indexOf('--lang'),
  LANG = li >= 0 ? args[li + 1] : 'en',
  ids = args.filter((a, i) => !a.startsWith('--') && !(li >= 0 && i === li + 1));
if (LANG !== 'en' && LANG !== 'uk') {
  console.error('--lang: en or uk');
  process.exit(1);
}
const file = (id) => {
  const [who, n] = id.split('.');
  return join(RAW, LANG === 'en' ? '' : LANG, `${who}_${String(n).padStart(2, '0')}.mp3`);
};
// a text's sentences (each with its stop)
const sentences = (t) => (t.match(/[^.!?…]+[.!?…]+["»”]?|[^.!?…]+$/g) || [t]).map((x) => x.trim()).filter(Boolean);
// the Ukrainian words with the English line's tags before the same sentences (unpaired: its first tag before all)
function tagged(line, text) {
  const chunks = [...line.matchAll(/(\[[^\]]*\])\s*([^[]*)/g)].map((m) => [m[1], m[2].trim()]),
    at = [];
  let n = 0;
  for (const [tag, w] of chunks) {
    at[n] = tag;
    n += sentences(w).length;
  }
  const us = sentences(text);
  if (us.length !== n) return (chunks[0] ? chunks[0][0] + ' ' : '') + text;
  return us.map((x, i) => (at[i] ? at[i] + ' ' : '') + x).join(' ');
}
// what is said: the English line as written, or the language's subtitle with its tags
const say = (id) => (LANG === 'en' ? LINES[id] : tagged(LINES[id], subIn(LANG, id)));
const todo = ids.length ? ids : Object.keys(LINES);
let bad = 0;
for (const id of todo) {
  if (!LINES[id]) {
    console.error(id + ': no such line');
    bad++;
  } else if (LANG !== 'en') {
    if (!subIn(LANG, id)) {
      console.error(`${id}: no ${LANG} subtitle`);
      bad++;
    }
  } else if (words(LINES[id]) !== sub(id)) {
    console.error(`${id}: the words differ from its subtitle\n  line:     ${words(LINES[id])}\n  subtitle: ${sub(id)}`);
    bad++;
  }
}
if (bad) process.exit(1);
if (args.includes('--dry')) {
  for (const id of todo) console.log(`${id}: ${say(id)}`); // (what would be said, nothing made)
  process.exit(0);
}
if (args.includes('--check')) {
  console.log(todo.length + ' lines match their subtitles');
  process.exit(0);
}

const el = new ElevenLabsClient();
// a speaker's voice in the account: as it is, or added from the library under its name
const ready = {};
async function voiceOf(who) {
  if (ready[who]) return ready[who];
  if (LANG === 'uk') return (ready[who] = UK[who]); // (the human's own voices in the account)
  const V = VOICES[who];
  try {
    await el.voices.get(V.id);
    return (ready[who] = V.id);
  } catch (e) {
    if (e.statusCode !== 400 && e.statusCode !== 404) throw e;
  }
  if (!ADD) return (ready[who] = V.id); // (a library voice said straight from the library)
  const r = await el.voices.getShared({ search: V.id, pageSize: 10 }),
    lib = r.voices.find((v) => v.voiceId === V.id);
  if (!lib) throw new Error(`${who}: voice ${V.id} is neither in the account nor in the library`);
  const added = await el.voices.share(lib.publicOwnerId, lib.voiceId, { newName: V.name });
  console.log(`${who}: added "${V.name}" to the account`);
  return (ready[who] = added.voiceId || V.id);
}

mkdirSync(join(RAW, LANG === 'en' ? '' : LANG), { recursive: true });
let chars = 0;
for (const id of todo) {
  const out = file(id);
  if (keep && existsSync(out)) continue;
  const who = id.split('.')[0],
    V = VOICES[who];
  const text = say(id);
  if (LANG !== 'en') console.log(`${id}: ${text}`);
  const audio = await el.textToSpeech.convert(await voiceOf(who), {
    text,
    modelId: MODEL,
    outputFormat: 'mp3_44100_128',
    languageCode: LANG,
    voiceSettings: { stability: V.stability, similarityBoost: V.similarity },
  });
  const buf = Buffer.from(await new Response(audio).arrayBuffer());
  writeFileSync(out, buf);
  chars += text.length;
  console.log(`${id} → ${out.slice(ROOT.length + 1).replace(/\\/g, '/')} (${(buf.length / 1024).toFixed(0)} KB)`);
}
console.log(`done: about ${chars} characters`);
