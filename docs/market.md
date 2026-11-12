# The players' market

Players trade the game's items with each other for real money, on the site (`/market`) and in the game (Walt's
window, the Market tab: the same page in a frame). The site opens on the shelf: every lot on sale as its own card, and
nothing that isn't sold. Each lot has its own address, `/market/lot/<id>`: the link a seller sends to a buyer (the
sell window gives it right away, "My items" has it on every lot). `/market/@<account>` is one seller's lots,
`/market/<item>` one item's, `/market/my` and `/market/activity` the tabs; nginx serves `market.html` for all of them
(`scripts/setup-service.sh`). The order book (Стакан) stays as the second view for buying the cheapest pieces of an
item across lots. The server is `server/market.mjs`; the page is `live/market-page.js`.

## How a trade goes

1. **A lot.** The seller picks an item from the stash, how many and a price a piece in dollars. The server takes the
   items off the stash and burns them on the seller's wallet with the game's key (`game_burn`, op `mlist-<lot>`). The
   contract is unchanged. A cancel mints the pieces no order holds back (`mcancel-…`).
2. **An order.** The buyer asks for n of an item: from one lot (a card's Buy, a lot's link: `quote {lot}`, that lot
   at its price) or from the order book (the cheapest lots of other players). The pieces are held for the order. The
   server asks 1Click for an `EXACT_OUTPUT` quote: the order's dollars as USDC, credited to the market's treasury inside
   NEAR Intents (`recipientType: INTENTS`; on 2026-11-12 1Click stopped quoting any delivery out to a NEAR account, and
   inside Intents every coin quotes), from the buyer's coin. The buyer gets a deposit address on the coin's chain (QR and timer), or
   pays USDC, USDT or NEAR straight from a NEAR wallet (one transaction: storage for the address, NEAR wrapped, the
   transfer; its hash goes to 1Click). Orders hold their lots 10 minutes (45 for chains that confirm slowly).
3. **Paid.** The server asks 1Click about every open order every few seconds. On `SUCCESS` the items are minted to the
   buyer (`mbuy-<order>`) and each seller's 97.5% is queued as a USDC payout: the treasury withdraws it from NEAR
   Intents to the seller's NEAR account (`intents.near` `ft_withdraw`; the seller's USDC storage paid first when they
   lack it). A withdraw that bounces comes back to the treasury's balance and is tried again. The market keeps 2.5%.
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
  `scripts/market-key.sh account treasury.meowdivision.near`. It holds money in transit and the fees, as USDC inside
  NEAR Intents: what is owed to sellers leaves within minutes of a sale. `bash scripts/market-key.sh` shows the USDC in
  Intents, what is owed and what is free to take; the fees are taken out of Intents with the treasury's key (any NEAR
  Intents app, signed in as treasury.meowdivision.near). The server pays its own USDC storage once and opens payments only after that.
- A payout is never sent twice: one in flight at a restart, or one whose outcome stayed unknown, waits as `stuck` for a
  look by hand.

## API

`GET /api/market` (every lot on sale, every item's asks by price and seller, the last trades, 14 days of prices,
totals),
`GET /api/market/tokens` (1Click's coins). Signed in: `GET /api/market/mine`, `GET /api/market/order?id=`,
`POST /api/market/list {id, n, price}`, `cancel {lot}`, `quote {id, n, max?, lot?, asset, refundTo?}`, `submit {id, tx}`,
`drop {id}` (an unpaid order given up).

## Not yet

Offers at one's own price (bids), the market's fee swept to `meowdivision.near`, the cats collection.
