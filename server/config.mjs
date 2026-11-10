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
// the account the server signs for: the items contract itself (its limited key, docs/chain.md)
export const SIGNER_ACCOUNT = env.NEAR_SIGNER_ACCOUNT || ITEMS;
export const signerKey = () => env.NEAR_SIGNER_KEY || '';
// wallets made in the game are `<name>.near`: names under mainnet's registrar
export const WALLET_PARENT = 'near';
// how many the server makes a day in all, and for one address (the contract keeps its own cap, set by the owner)
export const WALLET_DAILY_CAP = int(env.WALLET_DAILY_CAP, 20);
export const WALLET_IP_DAILY_CAP = int(env.WALLET_IP_DAILY_CAP, 3);
// how long POST /api/wallet/create waits for the new key to show in a final block before it answers (the tests: short)
export const WALLET_KEY_WAIT = { ms: int(env.WALLET_KEY_WAIT_MS, 20e3), step: 1000 };
