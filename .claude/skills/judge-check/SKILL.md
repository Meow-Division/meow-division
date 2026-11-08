---
name: judge-check
description: Play the hackathon's AI screening against this repository: fresh clone, follow README literally, verify each claimed feature, report gaps. Use before making the repo public and after any README change.
---
Act as a reviewer who has never seen the project and may only use what README.md says.

1. Fresh clone into a scratch directory (`git clone <local path> <scratch>/judge`); do not use the working tree.
2. Follow "Run it locally" word for word. Note every step that needs knowledge not written there (a tool, an env var, a port). Each one is a finding.
3. Run every command the README names; record the exact output. A failing or missing command is a finding.
4. Follow "Try it in three minutes" against https://game.meowdivision.fun with Playwright (desktop and a phone viewport). For each step, confirm the "see Y" part happened; attach a screenshot path.
5. Tick "Verify the features" one by one; for chain claims, read the explorer or RPC (`near contract call-function as-read-only …`) and quote the result.
6. Check the disclosure: Provenance names the prototype and the first commit; Built with lists the libraries actually imported (grep `import`, `require`, `cdn`); LICENSE exists; no secrets in history (`node scripts/check-secrets.mjs`, `git log -p | node scripts/check-secrets.mjs` style scan of history if time allows).
7. Check tone: any sentence in README that is a claim about quality rather than a fact is a finding.
8. Report in this order: blockers (a judge cannot run or verify), gaps (claimed but not shown), nits. Then fix what is in the repo and re-run from step 2.
