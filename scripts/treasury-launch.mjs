// scripts/treasury-launch.mjs — the players' market's treasury as a named account (docs/market.md): serves
// scripts/treasury-launch.html on http://127.0.0.1:8961/, where the human connects the wallet of meowdivision.near and
// approves one transaction: create treasury.meowdivision.near, fund it with 0.5 NEAR, add two full-access keys (the
// human's own, the one meowdivision.near has, so the treasury is theirs in their wallet; and the server's MARKET_KEY
// public half, for the sellers' USDC payouts). No key is held here; the page reads the chain itself.
// Then on the server: bash scripts/market-key.sh account treasury.meowdivision.near
//   node scripts/treasury-launch.mjs   (treasury-launch.bat)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'treasury-launch.html');
http
  .createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(PAGE));
    }
    res.writeHead(404);
    res.end();
  })
  .listen(8961, '127.0.0.1', () => console.log('treasury launch: http://127.0.0.1:8961/'));
