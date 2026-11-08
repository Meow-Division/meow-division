---
paths:
  - "live/lang_*.js"
  - "docs/voice.md"
  - "README.md"
---
# Words

- Four packs: `lang_en.js` (source), `lang_ru.js`, `lang_uk.js`, `lang_es.js`. Same keys, same `{slots}`, same meaning. Add to all four in the same commit. `node gen/langcheck.mjs` checks it.
- Plain, short, human. No exclamation marks in system text. No marketing. No machine phrasing ("Successfully completed the operation" → "Done").
- Names: the game is Meow Division; the cat is Copper; the agent is Nova; the merchant is Walt; the base is NEAR Base. Never "Zombie Horde" in player-facing text.
- Nova speaks in orders: short, strict, no jokes (`docs/voice.md` has all their lines and the Russian). Walt is warm and practical. Subtitles match the recorded English word for word.
- No chain jargon anywhere a player reads: not mint, burn, NFT, token, gas, transaction, sign, on-chain. Say "connect a wallet", "sent to your wallet", "yours to keep", "sold", "built".
- Item and building names come from `docs/design.md`; ids never change when a name does.
- Russian is checked by the human before release; Ukrainian and Spanish follow the Russian register (informal "ты"/"tú" to the player, as the prototype does).
- README is for a judge and a machine: facts, numbered steps, what to see. No adjectives about quality.
