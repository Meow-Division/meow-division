// gen/radio_sfx.mjs — the radio's sounds round Nova's lines made with ElevenLabs' sound effects (2026-11-10: the human
// found the old squelch, a burst of noise cut in 6 ms, sounding like a whip): candidates into art/voice/sfx/<name>_N.mp3,
// one picked by ear or by its shape and copied to art/voice/sfx/radio_off.mp3, which gen/radio.py lays after each line.
//   node --env-file=.env.local gen/radio_sfx.mjs [name…]   (no names: every one below)
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'),
  OUT = join(ROOT, 'art/voice/sfx');
const SFX = {
  off_a:
    'Walkie-talkie push-to-talk button released at the end of a transmission: a short soft squelch tail, a gentle burst of radio static that cuts off cleanly. No voice, no beep.',
  off_b:
    'Military handheld two-way radio, end of transmission: brief muffled static hiss "kshh" fading quickly into silence. No voice.',
  off_c:
    'Handheld radio roger beep at the end of a transmission: a short soft electronic chirp followed by a faint click. No voice.',
};
const el = new ElevenLabsClient(),
  names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SFX);
mkdirSync(OUT, { recursive: true });
for (const n of names)
  for (let k = 1; k <= 2; k++) {
    const audio = await el.textToSoundEffects.convert({
      text: SFX[n],
      modelId: 'eleven_text_to_sound_v3',
      durationSeconds: 0.6,
      promptInfluence: 0.6,
    });
    const buf = Buffer.from(await new Response(audio).arrayBuffer()),
      f = join(OUT, `${n}_${k}.mp3`);
    writeFileSync(f, buf);
    console.log(`${n}_${k}: ${(buf.length / 1024).toFixed(0)} KB`);
  }
