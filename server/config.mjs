// server/config.mjs — the NEAR side of the server's settings, read once from the environment with mainnet defaults (the
// names are in .env.example): the RPC URLs, the account ids, the limits on wallets made in the game. The signer's key
// is read here only to be handed to near.mjs; nothing prints it.
const env = process.env;
const list = (s) =>
  String(s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const int = (v, d) => (Number.isInteger(+v) && +v >= 0 && String(v).trim() !== '' ? +v : d);

// NEAR_RPC: comma-separated URLs tried in order; else NEAR_RPC_URL then NEAR_RPC_FALLBACK_URL; else these two
export const RPCS = list(env.NEAR_RPC).length
  ? list(env.NEAR_RPC)
  : list(env.NEAR_RPC_URL).length
    ? [...list(env.NEAR_RPC_URL), ...list(env.NEAR_RPC_FALLBACK_URL)]
    : ['https://rpc.mainnet.fastnear.com', 'https://rpc.mainnet.near.org'];
export const ITEMS = env.NEAR_ITEMS_CONTRACT || 'items.meowdivision.near';
// the players' items sent to their wallets (server/chain.mjs): on only with CHAIN_ITEMS=1 (after the contract's 0.2.1)
export const CHAIN_ITEMS = env.CHAIN_ITEMS === '1';
// ms a change just made on chain still counts as on its way when the stash is set to the wallet (the final view lags)
export const CHAIN_LAG_MS = int(env.CHAIN_LAG_MS, 20e3);
// ms after a trade before Walt's wallet is set to his shelf (one look for a burst of trades)
export const CHAIN_MIRROR_MS = int(env.CHAIN_MIRROR_MS, 30e3);
// the account the server signs for: the items contract itself (its limited key, docs/chain.md)
export const SIGNER_ACCOUNT = env.NEAR_SIGNER_ACCOUNT || ITEMS;
export const signerKey = () => env.NEAR_SIGNER_KEY || '';
// Walt's wallet (server/chain.mjs): his shelf held there, his key (a function-call key for market_give only, set by
// scripts/chain-launch.mjs) hands the purchases over; no key, the game's key mints them
export const WALT_ACCOUNT = env.NEAR_WALT_ACCOUNT || 'walt.meowdivision.near';
export const waltKey = () => env.NEAR_WALT_KEY || '';
// the players' market (server/market.mjs): its treasury's key, a full-access key of an implicit account that holds only
// the money in transit (USDC on its way to the sellers, the market's fee); none, the market shows its lots but takes
// and sells none. MARKET_ACCOUNT: the treasury's account (default: the key's implicit one)
export const marketKey = () => env.MARKET_KEY || '';
export const MARKET_ACCOUNT = env.MARKET_ACCOUNT || '';
// NEAR Intents' 1Click Swap API (the buyers' coins to USDC on NEAR); a partner key from partners.near-intents.org lowers
// its fee, none works too
export const oneClickKey = () => env.ONECLICK_API_KEY || '';
// the Telegram bot's token (server/tg.mjs: a player's Telegram told of their market trades); none, no messages
export const tgToken = () => env.TG_TOKEN || env.TELEGRAM_BOT_TOKEN || '';
export const ONECLICK_BASE = env.ONECLICK_BASE || 'https://1click.chaindefuser.com';
// NEAR AI Cloud (server/nearai.mjs): Walt's words (waltai.mjs) and the market watch (watch.mjs); off without a key.
// The key is read here only to be handed to nearai.mjs; nothing prints it
export const nearAiKey = () => env.NEAR_AI_API_KEY || '';
export const NEAR_AI_BASE = env.NEAR_AI_BASE_URL || 'https://cloud-api.near.ai/v1';
export const NEAR_AI_MODEL = env.NEAR_AI_MODEL || 'deepseek-ai/DeepSeek-V4.1-Flash-1017';
// tokens a day the server may spend there in all (a call that could go past it is not made)
export const NEAR_AI_DAILY_TOKENS = int(env.NEAR_AI_DAILY_TOKENS, 300e3);
// the market watch's language (its words are for the people who balance the game)
export const WATCH_LANG = env.WATCH_LANG || 'Russian';
// wallets made in the game are `<name>.near`: names under mainnet's registrar
export const WALLET_PARENT = 'near';
// how many the server makes a day in all, and for one address (the contract keeps its own cap, set by the owner)
export const WALLET_DAILY_CAP = int(env.WALLET_DAILY_CAP, 20);
export const WALLET_IP_DAILY_CAP = int(env.WALLET_IP_DAILY_CAP, 3);
// how long POST /api/wallet/create waits for the new key to show in a final block before it answers (the tests: short)
export const WALLET_KEY_WAIT = { ms: int(env.WALLET_KEY_WAIT_MS, 20e3), step: 1000 };
