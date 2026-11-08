# NEAR HACKATHON: what this repository must satisfy

Source of truth: https://nearhackathon.com/HACKATHON.md (re-read it before submitting; dates and rules may change).
This file is our distilled copy, checked against the live version on 2026-11-08. Where they differ, the live file wins.

## Dates (UTC)

| Event | When |
| --- | --- |
| Code window opens (announcement, Q-001) | 2026-10-19 |
| Hackathon starts, submissions open | 2026-11-01T00:00:00Z |
| Development ends, submission deadline, repo must be public | 2026-11-14T23:59:00Z |
| Judging | 2026-11-16 to 2026-11-18 |
| Keep the hosted demo up | until 2026-11-18, ideally 2026-11-25 |

## Our entry

| Field | Value |
| --- | --- |
| Project | Meow Division (the game at https://game.meowdivision.fun) |
| Tracks | `games` (primary), `agents`. `nfts` only if NFT cat heroes actually ship. |
| GitHub | organisation https://github.com/Meow-Division |
| Game account (mainnet) | `meowdivision.near` (contracts and NPC wallets live under it) |
| Prize account | the human's personal account. Ask; never fill in or invent. |
| Demo post | from the game's own X account; the human posts it |
| Submission values | project name, lead name, email, team size, prize account, idea text, consent: all come from the human, never generated |

## What the judges and the AI screening look for

- Claude Code and Codex screen every project first (Q-017): "reproducibility check, feature verification, structured report, preliminary score". Humans decide. So the README must let a machine clone, run and verify the features without guessing.
- README: "what the product is, the problem it solves, and how to try it as 'do X - see Y' steps a judge can follow. No marketing."
- Games track: "Judged on the game loop, not the token - bonus if players never notice the chain." Hints: AGENT NPCS, SOCIAL LOGIN, NEAR INTENTS, NEP-245.
- The organisers' example prompt for `games` (tracks/09-games.md) asks for, and we deliver:
  - items as NEP-245 multi tokens, "one contract holds every item type";
  - merchants as agents "with its own wallet and inventory", prices set "from its stock and recent demand";
  - pricing rules "in one readable file", merchant reasoning shown in a tooltip;
  - a fast-forward mode that "simulates a week of trading in a minute" so judges can "watch the economy move";
  - "No seed phrases, no wallet popups, no gas prompts in the normal game loop";
  - a design that says what players do "every 30 seconds, every 5 minutes and every session".
- Agents track: "agents that earn, spend, negotiate". Walt (merchant) and the game account hold real wallets and move real items; Intents for payments.
- Name every ecosystem tool we use in the README (NEAR Intents, NEAR AI Cloud, HOT near-connect, FastNEAR RPC if used).
- Local-only demos are allowed, but a hosted demo "is a plus". Ours is hosted; the README still has to work locally.

## Code provenance (disclosure, Q-001 to Q-005, Q-015)

- Everything in this repository was written inside the window: our prototype "Zombie Horde" (baldingalex.fun) started on 2026-10-21, its git history on 2026-10-30, the announcement was 2026-10-19.
- We still disclose it. The first commit of this repo is the import of that prototype, titled `import: Zombie Horde prototype (our own code, 2026-10-21..2026-11-07)`. Everything after it is hackathon work, and the README "Provenance" section says so and links the commit.
- Q-005: list third-party code in README "Built with": libraries, Telegram's web-app SDK copy, AI tools used for code and art (Claude Code, Codex image generation), the NEAR agent skills.
- Q-015: if the team submits a second project, both READMEs name each other.
- One submission per project, one per repository. Never a second POST.

## Never without the human's explicit confirmation (verbatim from HACKATHON.md)

- Send the submission. Print the full JSON payload first and wait for a yes. A second submission of the same repository is rejected, so there is one attempt per project. Mistakes are fixed by requesting changes, not by submitting again.
- Post anything on X or another network on their behalf.
- Make the repository public, push, or force-push.
- Sign transactions, spend tokens or deploy to mainnet.
- Commit secrets. Keys belong in environment variables, never in the repository.

The repository enforces the last four with a Claude Code hook (`.claude/hooks/guard.mjs`) and permission deny rules. Codex has no hooks: it follows the same list by reading AGENTS.md.

## Secrets

- Live only in `.env` files and systemd `EnvironmentFile`s on the server. `.env.example` lists names, never values.
- Never in git history. `node scripts/check-secrets.mjs` scans the tree and the staged diff; CI runs it too.
- Known secrets of this project, by name only: `NEAR_SIGNER_KEY` (function-call key of the game's server signer), `NEAR_AI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `SESSION_SECRET`.

## Submission (only after the human says yes to the printed payload)

`POST https://nearhackathon.com/api/applications`, `Content-Type: application/json`, body under 12000 bytes, exactly these fields:

| Field | Rule |
| --- | --- |
| requestId | UUID made once (`node -e 'console.log(crypto.randomUUID())'`), reused on retries |
| projectName | 2-80 chars |
| leadName | 2-80 chars |
| email | valid, max 160 chars, at most 2 submissions per email |
| size | one of `1`, `2 - 4`, `4 - 6`, `6 - 8`, `8+`, exactly as written |
| tracks | array of track ids, each once |
| nearAddress | 2-64 chars, lowercase, `^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$` |
| projectUrl | public repo URL, max 300 chars, unique |
| demoUrl | public X post URL, max 300 chars |
| idea | 20-2000 chars: problem, product, how NEAR fits |
| consent | `true` only after the human agreed to the notice, read verbatim: "I agree that the organizers may use these details to review our submission and contact us about this hackathon." |

No other fields. `website` is a spam trap: any value rejects the submission. Do not commit the payload (personal data).

Responses: 201 saved; 400 fix `fields` and resend with the same requestId; 403 submissions closed or cross-site, stop; 409 already submitted or email limit, stop and tell the human; 413 shorten `idea`; 503 wait a minute, same requestId.

Mistakes after a 201 go through https://nearhackathon.com/request-changes (the human sends it), never a second submission.

## README contract (what `README.md` must contain, in this order)

1. One paragraph: what Meow Division is, the problem (players own nothing in most games; here loot, kits and the merchant's stock are real tokens, and the player never sees the chain), and what NEAR does in it.
2. "Try it in 3 minutes": numbered "do X, see Y" steps against the hosted demo. Include the judge fast-forward mode and how to see the loot on a real wallet.
3. "Run it locally": prerequisites with versions, `npm ci`, `npm test`, `npm start`, the URL, and what the judge should see. No step may depend on a secret; the game must run in guest mode with no `.env`.
4. "How NEAR is used": contract address, NEP-245 item ids, NEP-297 events, NEP-413 login, function-call key, Intents, NEAR AI. One table of on-chain vs off-chain state.
5. "Architecture": one diagram or list of the deterministic simulation, replay verification, and the chain bridge.
6. "Verify the features": a checklist the AI screening can tick (run tests, open URLs, read events on an explorer).
7. "Provenance" and "Built with" (see disclosure above). License line (MIT).
8. Team and links. No marketing language, no superlatives.

## Demo post (the human posts it; we draft it)

- Says the project was built at NEAR HACKATHON, tags `@NEARProtocol` and `#NEARHackathon` (optionally `@NearLegion`, `@NearBuilders`), has the demo video attached.
- First line: the player's problem in plain words. One complete moment: a real action to a visible result (a run ends, the loot lands on the wallet, Walt's price moves). Say concretely what NEAR enables. End with the demo and repo links and a real question.
