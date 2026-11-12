# The players' market

Players trade the game's items with each other for real money, on the site (`/market.html`) and in the game (Walt's
window, the Market tab: the same page in a frame). The server is `server/market.mjs`; the page is `live/market-page.js`.

## How a trade goes

1. **A lot.** The seller picks an item from the stash, how many and a price a piece in dollars. The server takes the
   items off the stash and burns them on the seller's wallet with the game's key (`game_burn`, op `mlist-<lot>`). The
   contract is unchanged. A cancel mints the pieces no order holds back (`mcancel-…`).
2. **An order.** The buyer asks for n of an item. The cheapest lots of other players fill it and are held for the
   order. The server asks 1Click for an `EXACT_OUTPUT` quote: the order's dollars as USDC on NEAR, delivered to the
   market's treasury, from the buyer's coin. The buyer gets a deposit address on the coin's chain (QR and timer), or
   pays USDC, USDT or NEAR straight from a NEAR wallet (one transaction: storage for the address, NEAR wrapped, the
   transfer; its hash goes to 1Click). Orders hold their lots 10 minutes (45 for chains that confirm slowly).
3. **Paid.** The server asks 1Click about every open order every few seconds. On `SUCCESS` the items are minted to the
   buyer (`mbuy-<order>`) and each seller's 97.5% is queued as a USDC payout from the treasury (`storage_deposit` +
   `ft_transfer` in one transaction). The market keeps 2.5%.
4. **Not paid.** `REFUNDED` or `FAILED`, or no deposit by the deadline: the lots go back on sale. 1Click returns the
   coins to the refund address (or, when none was given, to the buyer's own NEAR Intents account). An order is still
   watched for a day after it lets go: a payment that lands late is filled from the same pieces, or paid back in USDC.

## Money

- Prices are in whole cents; what moves on chain is micro-USDC (a cent is 10 000).
- The least purchase is $1. Some chains have 1Click minimums (BNB Chain $1000, Tron $100, a Bitcoin bridge minimum
  near $5); the page shows those coins as "from $N".
- 1Click's own fee is in the coin amount the buyer sends; the market's 2.5% comes out of the seller's share.
- The treasury is `treasury.meowdivision.near` with two full-access keys: the human's own (the one meowdivision.near
  has: the treasury is theirs in their wallet; the fees pay for rewards and costs) and the server's (`MARKET_KEY`, made
  on the server by `scripts/market-key.sh make`, never printed, used for the sellers' payouts). Made by
  `treasury-launch.bat` (one transaction from meowdivision.near, with 0.5 NEAR for gas), then
  `scripts/market-key.sh account treasury.meowdivision.near`. It holds money in transit and the fees: what is owed to
  sellers leaves within minutes of a sale. The server pays its own USDC storage once and opens payments only after that.
- A payout is never sent twice: one in flight at a restart, or one whose outcome stayed unknown, waits as `stuck` for a
  look by hand.

## API

`GET /api/market` (every item's asks by price and seller, the last trades, 14 days of prices, totals),
`GET /api/market/tokens` (1Click's coins). Signed in: `GET /api/market/mine`, `GET /api/market/order?id=`,
`POST /api/market/list {id, n, price}`, `cancel {lot}`, `quote {id, n, max?, asset, refundTo?}`, `submit {id, tx}`,
`drop {id}` (an unpaid order given up).

## Not yet

Offers at one's own price (bids), the market's fee swept to `meowdivision.near`, the cats collection.
