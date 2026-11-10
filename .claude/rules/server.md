---
paths:
  - "server/**"
---
# Server (`server/`): Node 22+, ESM, zero npm dependencies

- One process (`server.mjs`), sections marked with `// ---- title ----` banners: config, NEAR helpers, sessions, accounts, replay pool, rate limit, HTTP, co-op glue, `start()`. New concerns get their own module (`chain.mjs`, `ledger.mjs`, `market.mjs`), imported by `server.mjs`; no second entry point.
- API shape: JSON in, JSON out. Success is a plain object; failure is `{ error: 'short lowercase message', ...extra }` with the right status (400 bad input, 401 no session, 409 refused by rules, 410 gone, 413 too big, 429 slow down, 502/503 upstream). `send()` adds `cache-control: no-store` and `nosniff`.
- Auth: Bearer token = HMAC over `{ a, e }` with `DATA/secret`, checked with `timingSafeEqual`. NEP-413 login: nonce single-use with TTL, recipient is our domain, the key must be a FullAccess key (`view_access_key`, finality `final`). Guests get a device token from the same signer; a guest token binds to a wallet once.
- Persistence is JSON files under `DATA_DIR` with write-to-temp-then-rename and a per-account promise lock (`withAcc`). No database. Jobs (`DATA/jobs`) survive restarts and are resumed.
- Every run is paid from the replay's outcome, never from the page's claim. Tickets are single use, bound to a `rev`; `409 'stale'` to other revs. Time checks: a run cannot be faster than real time minus `SLACK`.
- Chain work (`chain.mjs`): one RPC client with timeouts and a fallback URL; idempotency by `run_id`/`request_id`; a failed mint is queued and retried, the player sees "will arrive". The signer key comes from `NEAR_SIGNER_KEY` and is a function-call key; the module refuses to start with a full-access key.
- Config (`config.mjs`): every account id, URL and limit read from env with mainnet defaults, exported once. Nothing else reads `process.env`.
- Rate limits are per network per minute in memory (`ipnet.mjs`: an IPv4 address, an IPv6 /64, IPv4-mapped as IPv4); when `TRUST_PROXY=1`, the address is the last `X-Forwarded-For` entry. Nonces are capped per network too.
- Logging: `console.log/warn/error` with a tag first and ids, never tokens, keys, signatures or whole saves.
- `server/test.mjs` boots the server on a random port with a stand-in RPC and a temp `DATA_DIR`; every new route gets a case there, every refusal path too.
- The Telegram bot (`tgbot.mjs`) is a separate process with its own env; it never touches game data. There is no Telegram login anywhere.
