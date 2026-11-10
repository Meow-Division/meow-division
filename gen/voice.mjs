// gen/voice.mjs — the voice lines made with ElevenLabs (docs/voice.md): each line's English with how it is said as audio
// tags ([serious], [matter-of-fact] …), in its speaker's voice — Nova: the library's "Lauren - Friendly, Comforting and
// Soft"; Copper and Walt: the voices the human picked (2026-11-10) — model eleven_v4, into art/voice/raw/<who>_NN.mp3.
// `python gen/radio.py` then makes the game's files (live/audio/voice). A line's words without its tags must be its
// English subtitle (live/lang_en.js voice.<id>): checked first, a line that differs is not made.
//   node --env-file=.env.local gen/voice.mjs [ids…]   (no ids: every line; ids like nova.12 copper.1)
//   --keep   lines whose raw file is there already are left alone; --check: only the words checked, nothing made
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
};

// the English subtitles (live/lang_en.js through a stand-in I18N)
const require = createRequire(import.meta.url);
let EN = null;
globalThis.I18N = { pack: (id, p) => id === 'en' && (EN = p) };
require(join(ROOT, 'live/lang_en.js'));
const sub = (id) => {
  const [who, n] = id.split('.');
  return EN.voice[who] && EN.voice[who][n];
};
const words = (s) => s.replace(/\[[^\]]*\]\s*/g, '').trim();
const file = (id) => {
  const [who, n] = id.split('.');
  return join(RAW, `${who}_${String(n).padStart(2, '0')}.mp3`);
};

const args = process.argv.slice(2),
  keep = args.includes('--keep'),
  ADD = args.includes('--add'),
  ids = args.filter((a) => !a.startsWith('--'));
const todo = ids.length ? ids : Object.keys(LINES);
let bad = 0;
for (const id of todo) {
  if (!LINES[id]) {
    console.error(id + ': no such line');
    bad++;
  } else if (words(LINES[id]) !== sub(id)) {
    console.error(`${id}: the words differ from its subtitle\n  line:     ${words(LINES[id])}\n  subtitle: ${sub(id)}`);
    bad++;
  }
}
if (bad) process.exit(1);
if (args.includes('--check')) {
  console.log(todo.length + ' lines match their subtitles');
  process.exit(0);
}

const el = new ElevenLabsClient();
// a speaker's voice in the account: as it is, or added from the library under its name
const ready = {};
async function voiceOf(who) {
  if (ready[who]) return ready[who];
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

mkdirSync(RAW, { recursive: true });
let chars = 0;
for (const id of todo) {
  const out = file(id);
  if (keep && existsSync(out)) continue;
  const who = id.split('.')[0],
    V = VOICES[who];
  const audio = await el.textToSpeech.convert(await voiceOf(who), {
    text: LINES[id],
    modelId: MODEL,
    outputFormat: 'mp3_44100_128',
    languageCode: 'en',
    voiceSettings: { stability: V.stability, similarityBoost: V.similarity },
  });
  const buf = Buffer.from(await new Response(audio).arrayBuffer());
  writeFileSync(out, buf);
  chars += LINES[id].length;
  console.log(`${id} → ${out.slice(ROOT.length + 1).replace(/\\/g, '/')} (${(buf.length / 1024).toFixed(0)} KB)`);
}
console.log(`done: about ${chars} characters`);
