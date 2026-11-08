@AGENTS.md

## Claude Code specifics

- `.claude/rules/*.md` add path-scoped detail (sim, server, contract, client, text); they load when you touch those files.
- `.claude/hooks/guard.mjs` blocks pushes, mainnet transactions, the submission POST, X posts and `.env` edits, and runs the secret scan before every commit. A block is final: hand the command to the human, do not look for another way to run it.
- Skills: `/ship` (deploy to game.meowdivision.fun), `/sim-change` (checklist for rules changes), `/judge-check` (play the AI screening against the README), `/submit-hackathon` (human-run submission procedure), `/x-post` (draft the demo post).
- The human runs Claude Code in bypass-permissions mode and expects finished, locally checked work to be deployed right away. Decide technical trade-offs yourself; the hard rules in AGENTS.md are the only stops.
- Talk to the human in Russian, short and plain. Pages and plans for the human are minimal and visual (icons, one to three tabs). Code, comments, docs and commits are English.
- Plan board: https://claude.ai/artifact/FhYhApfaaPRSJfCAFEtNPC. Decisions page: https://claude.ai/artifact/Jt583FXFQk1qGKENGbqsPW. Update the board's status when a task lands.
- Codex is used for image generation and sometimes code; it reads AGENTS.md, not this file or `.claude/`. Anything Codex must know goes into AGENTS.md or `docs/`.
