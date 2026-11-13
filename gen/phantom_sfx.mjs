// gen/phantom_sfx.mjs — the Copper Phantom's shot made with ElevenLabs' sound effects (as the radio's: gen/radio_sfx.mjs): a
// suppressed AR-15, one shot. Candidates into the folder given (default art/sfx/phantom_N.mp3); the one picked is cut and
// copied to live/audio/phantom.mp3 by hand, its place in it written to live/audio/phantom.json.
//   node --env-file=.env.local gen/phantom_sfx.mjs [out dir]
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'),
  OUT = process.argv[2] || join(ROOT, 'art/sfx');
const TEXT = [
  'A single gunshot from a suppressed AR-15 rifle with a silencer, close up: a short dry muffled crack with the metallic clack of the bolt cycling. One shot only, no echo, no voice, no music.',
  'One single shot of a silenced 5.56 assault rifle recorded close: a sharp muted "pft" thump and a mechanical action click, dry, outdoors, no reverb tail. Only one shot.',
  'Suppressed carbine, single shot, close microphone: tight low thud with a hiss of gas and the bolt clacking. Very short and dry. Only one shot, no voice.',
];
const el = new ElevenLabsClient();
mkdirSync(OUT, { recursive: true });
for (let k = 0; k < TEXT.length; k++) {
  const audio = await el.textToSoundEffects.convert({
    text: TEXT[k],
    modelId: 'eleven_text_to_sound_v3',
    durationSeconds: 0.6,
    promptInfluence: 0.7,
  });
  const chunks = [];
  for await (const c of audio) chunks.push(c);
  const f = join(OUT, `phantom_${k + 1}.mp3`);
  writeFileSync(f, Buffer.concat(chunks));
  console.log(f, Buffer.concat(chunks).length);
}
