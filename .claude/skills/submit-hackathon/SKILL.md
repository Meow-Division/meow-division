---
name: submit-hackathon
description: Prepare the NEAR HACKATHON submission payload with the human and hand them the one-shot command. Only the human sends it; there is one attempt per repository.
disable-model-invocation: true
---
1. Re-read https://nearhackathon.com/HACKATHON.md (live). If anything differs from docs/hackathon.md, update docs/hackathon.md first and tell the human.
2. Preconditions, each confirmed by looking, not by memory: repository public; LICENSE present; README passes `/judge-check`; demo post live on X with the video, saying it was built at NEAR HACKATHON, tagging @NEARProtocol and #NEARHackathon; hosted demo up; `node scripts/check-secrets.mjs` clean on the full tree.
3. Collect from the human, verbatim, without suggesting values: projectName, leadName, email, size (`1`, `2 - 4`, `4 - 6`, `6 - 8`, `8+`), tracks (ids), nearAddress (their payout account, mainnet), projectUrl, demoUrl, idea (20-2000 chars; offer to draft, they approve the final text), consent (read the notice verbatim and record their answer).
4. Validate every field against the table in docs/hackathon.md (lengths, regex, allowed values, no `website` field, body under 12000 bytes). Generate `requestId` once with `node -e 'console.log(crypto.randomUUID())'` and keep it in the conversation.
5. Print the full JSON payload, then the exact command for the human to run:
   `curl -sS -X POST https://nearhackathon.com/api/applications -H 'Content-Type: application/json' -d @payload.json`
   with `payload.json` written to the scratchpad, never to the repo. Wait for their yes; they run it (the hook blocks the agent).
6. Read the response with them: 201 saved, done; 400 fix the listed fields, same requestId; 403 or 409 stop and explain; 503 wait a minute, same requestId.
7. After a 201, delete `payload.json`, record the submission date and requestId in the plan board, and remind them that changes go through https://nearhackathon.com/request-changes only.
