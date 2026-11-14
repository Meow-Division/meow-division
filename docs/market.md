# The players' market

Players trade the game's items with each other for real money, on the site (`/market`) and in the game (Walt's
window, the Market tab: the same page in a frame). The site opens on the shelf: every lot on sale as its own card, and
nothing that isn't sold. Each lot has its own address, `/market/lot/<id>`: the link a seller sends to a buyer (the
sell window gives it right away, "My items" has it on every lot). `/market/@<account>` is one seller's lots,
`/market/<item>` one item's, `/market/my` and `/market/activity` the tabs; nginx serves `market.html` for all of them
(`scripts/setup-service.sh`). The order book (Стакан) stays as the second view for buying the cheapest pieces of an
item across lots. The server is `server/market.mjs`; the page is `live/market-page.js`.

The page speaks the game's four languages (en, ru, uk, es). Its texts are packs of their own,
`live/lang_market.<lang>.js` (the items' names, where a kind comes from, every line by its key), loaded by `market.html`
before the page; the page and its HTML hold no text themselves. `test/marketlang.test.mjs` keeps the four packs to the
same keys, slots and markup. The language is the one picked in the header, else the browser's; in the game's frame it
is the game's (`?lang=`). A market that gives no answer is said so (a line with a retry button, the Live dots off, no
buying on old prices), and in the game, with the page out of reach, the tab shows a line of the game's instead of the
frame.

## How a trade goes

1. **A lot.** The seller picks an item from the stash, how many and a price a piece in dollars — tokens alone: what a
   raid carried out or this market sold back, never the plain pile bought from Walt (`rules.js` tokens, 2026-11-14:
   his shelf bought out can't be flipped here). The server takes the
   items off the stash and burns them on the seller's wallet with the game's key (`game_burn`, op `mlist-<lot>`). The
   contract is unchanged. The lot is on sale only once that burn is confirmed (a few seconds; until then the seller
   sees it as "being listed" and nobody can buy it); a burn the wallet refuses (the items were sent away first) takes
   the lot down. A cancel mints the pieces no order holds back (`mcancel-…`).
2. **An order.** The buyer asks for n of an item: from one lot (a card's Buy, a lot's link: `quote {lot}`, that lot
   at its price) or from the order book (the cheapest lots of other players). The pieces are held for the order. The
   server asks 1Click for an `EXACT_OUTPUT` quote: the order's dollars as USDC, credited to the market's treasury inside
   NEAR Intents (`recipientType: INTENTS`; on 2026-11-12 1Click stopped quoting any delivery out to a NEAR account, and
   inside Intents every coin quotes), from the buyer's coin. The buyer gets a deposit address on the coin's chain (QR and timer), or
   pays USDC, USDT or NEAR straight from a NEAR wallet (one transaction: storage for the address, NEAR wrapped, the
   transfer; its hash goes to 1Click). The address takes the payment for 10 minutes (45 for chains that confirm
   slowly). The pieces are held 3 minutes with no deposit seen, whatever the coin; once 1Click reports a deposit they
   stay held until the address's deadline (and 30 minutes more while the swap itself is running). A hash the buyer
   submits holds nothing by itself.
3. **Paid.** The server asks 1Click about every open order every few seconds. On `SUCCESS` the items are minted to the
   buyer (`mbuy-<order>`) and each seller's 97.5% is queued as a USDC payout: the treasury withdraws it from NEAR
   Intents to the seller's NEAR account (`intents.near` `ft_withdraw`; the seller's USDC storage paid first when they
   lack it). A withdraw that bounces comes back to the treasury's balance and is tried again. The market keeps 2.5%.
4. **Not paid.** `REFUNDED` or `FAILED`, or the hold ran out: the lots go back on sale. 1Click returns the
   coins to the refund address (or, when none was given, to the buyer's own NEAR Intents account). An order is still
   watched for a day after it lets go (every minute while its address can still be paid or a deposit is reported, then
   once an hour): a payment that lands late is filled from the same pieces, or paid back in USDC. An order paid for a
   lot that was taken down as unbacked is paid back the same way.

## Limits on one buyer

An order costs nothing until it is paid, so what one account can keep from the others is bounded (`server/market.mjs`
constants): 2 open orders, counted from the moment they are asked for; together at most 2 000 pieces and $5 000 held;
3 minutes of hold with no deposit. Unpaid orders that held lots and were given up or ran out are counted for an hour:
the first three cost nothing, the fourth makes the buyer wait 30 s before the next order (`slow down`, `wait` seconds),
and each one after doubles that, up to 30 minutes. Bids hold no lots and are not counted.

## Bids (buying at one's own price)

The human's design (2026-11-12): a buyer sets a price a piece for one item (a graphics card) or for any item, and how
many; the book shows it. A $5 bid for a graphics card next to a $0.20 floor can only be filled with a graphics card.

The buy side of the book is a bid form; clicking a selling price in the book picks a purchase instead (everything
from the floor up to it), and Clear goes back to the bid (no "buy now / your price" switch).

1. **A bid is paid first**, as a purchase is: `quote {id, n, bid}` (`id` an item or `all`, `bid` cents a piece) makes an
   order of kind `bid` for n × bid, nothing held. Paid (`SUCCESS`, late too), it opens as a bid; the money waits in
   the treasury until a seller sells into it. The page refuses a bid at or over the cheapest piece others sell (buy
   it instead). 20 open bids a buyer at most.
2. **Selling into bids**, the dearest first: a bid row clicked in the book sells down to its price; `sell {fills}`
   names each bid and the item it takes (`[{bid, it, n}]`; a bid for an item takes that item, a bid for any item any
   of the seller's, the page picking the cheapest the item bids under it don't want; the book of all items lets the
   seller keep items back). The bids are taken first, then the items burn off the seller's wallet (`msell-<sale>-<item>`).
   Only when every burn is confirmed do the items mint to the bidders (`mbid-<sale>-<bidder>`) and the seller's 97.5%
   join the payouts; until then the sale shows as in progress (`mine.sales`, `st: 'wait'`). A burn the wallet refuses
   calls the sale off: the pieces go back to the bids (a bid taken down meanwhile: its share back to its bidder), what
   did burn is minted back (`msellback-…`), nothing is paid. A bid gone or taken meanwhile: `bids changed`, nothing
   sold.
3. **Taking a bid down** (`unbid {id}`, "My items"): what is left comes back as a USDC payout (`refund`).

The money in open bids is owed: `scripts/market-key.sh` shows it on its own line and leaves it out of what is free to
take. Finished bids are kept a week for "My items".

## Money

- Prices are in whole cents; what moves on chain is micro-USDC (a cent is 10 000).
- The market has no minimum of its own: the least purchase is one cent (MIN_CENTS). The chain's cost of a payout
  (NET_MICRO, 0.3 cents) is paid by whoever it goes to: it comes out of a seller's payout and out of the money of a
  bid its bidder takes down; a refund the buyer did not ask for goes back whole. Some chains have 1Click minimums (BNB Chain $1000, Tron $100, a Bitcoin bridge minimum
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
- A payout is never sent twice. The hash of its transaction is written to disk before the transaction leaves; one in
  flight at a restart, or one whose outcome stayed unknown, is followed by that hash: found on chain, it is done or (if
  it failed there) goes back in the queue; never seen by the chain, it goes back only after 48 hours, when the
  transaction can no longer be taken. Only a payout left in flight by a version from before the hashes waits as
  `stuck` for a look by hand. Its memo carries the payout's id.
- A payout not paid is never forgotten: one refused for want of balance is tried again with a growing wait, one refused
  for another reason stays as `fail` (a debt, in the log) until someone has looked. Only payouts sent are dropped
  after a week.

## State and restarts

`DATA_DIR/market.json`, written to a temp file, synced and renamed. Every change is written down before the awaits
that carry it out (a lot before its items are taken, a sale before its burns, the items owed to a stash before they are
handed over), so a restart at any point finishes what was cut short: the market asks the chain queue what became of
the burns it was waiting for (`chain.mjs` `op`). On SIGTERM the server stops taking market calls (`503 restarting`),
waits for the ones running, the payout being sent and the file, at most 25 s. A file that can't be read is copied
aside (`market.json.bad-…`) and never overwritten: the market stays shut (`503 market closed`) until it is fixed;
only a missing file starts an empty market.

## API

`GET /api/market` (the 40 cheapest lots of each item and `lotsTotal`, every item's asks by price and seller (200 levels
at most), the open bids, the last trades, 14 days of prices, totals; `?lot=<id>` and `?seller=<account>` add that lot
and that seller's lots whatever the bound left out; built once per change),
`GET /api/market/tokens` (1Click's coins). Signed in: `GET /api/market/mine`, `GET /api/market/order?id=`,
`POST /api/market/list {id, n, price}`, `cancel {lot}`, `quote {id, n, max?, lot?, bid?, asset, refundTo?}`,
`submit {id, tx}`, `drop {id}` (an unpaid order given up), `sell {fills}` (into bids), `unbid {id}`.

## Not yet

The market's fee swept to `meowdivision.near`, the cats collection.
