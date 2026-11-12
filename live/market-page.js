// live/market-page.js — the players' market on the site (market.html; the server's side: server/market.mjs). The shelf:
// every lot on sale as its own card (only what is sold); a lot opens over it with its own address, /market/lot/<id>, the
// link a seller sends to a buyer; /market/<item> and /market/@<account> narrow the shelf, /market/my and /market/activity
// are the tabs (nginx serves market.html for all of them). The order book (Стакан): every item's lots by price, the last
// trades, two weeks of prices. GET /api/market, refreshed every few seconds. Signed in (the game's own session in this browser, or a wallet through NEAR Connect here, the same NEP-413
// login), a player puts items from their stash up for sale (POST /api/market/list) and buys: the cheapest lots of other
// players are held for the order and NEAR Intents (1Click) gives an address on the coin's chain to pay to
// (POST /api/market/quote); or the NEAR wallet pays USDC, USDT or NEAR straight from here. The page follows the order
// until the item is in the stash. Offers at one's own price (bids) are not in this version.
'use strict';
(function () {
  const API = '/api',
    WKEY = 'meow-division-wallet', // (the game's session: live/wallet.js)
    LOGIN = {
      recipient: 'game.meowdivision.fun',
      message: 'Meow Division: sign in to keep your progress under this account',
    },
    RPC = 'https://rpc.mainnet.fastnear.com';
  // ---------- the game's 31 items (live/economy.js), names from the language packs ----------
  const ITEMS = [
    ['gears', 'material', 1],
    ['tape', 'material', 1],
    ['fuel', 'material', 1],
    ['cans', 'material', 1],
    ['bandages', 'material', 1],
    ['bulbs', 'material', 1],
    ['tools', 'material', 2],
    ['catfood', 'material', 2],
    ['antiseptic', 'material', 2],
    ['chips', 'material', 2],
    ['gpu', 'material', 3],
    ['vaccine', 'material', 3],
    ['usb', 'material', 3],
    ['nuts', 'material', 1],
    ['screws', 'material', 1],
    ['planks', 'material', 1],
    ['scrap', 'material', 1],
    ['wires', 'material', 1],
    ['springs', 'material', 2],
    ['battery', 'material', 2],
    ['fabric', 'material', 1],
    ['t_butcher', 'trophy', 4],
    ['t_pustule', 'trophy', 4],
    ['t_screamer', 'trophy', 4],
    ['t_tank', 'trophy', 4],
    ['t_shroom', 'trophy', 4],
    ['k_medkit', 'kit', 2],
    ['k_grenades', 'kit', 2],
    ['k_magnet', 'kit', 2],
    ['k_vest', 'kit', 3],
    ['k_vaccine', 'kit', 3],
  ].map(([id, kind, r]) => ({ id, kind, r }));
  const NAMES = {
    en: {
      gears: 'Gears',
      tape: 'Duct tape',
      fuel: 'Fuel',
      cans: 'Canned food',
      bandages: 'Bandages',
      bulbs: 'Light bulbs',
      tools: 'Tools',
      catfood: 'Cat food',
      antiseptic: 'Antiseptic',
      chips: 'Microchips',
      gpu: 'Graphics card',
      vaccine: 'Vaccine sample',
      usb: 'Flash drive',
      nuts: 'Nuts and bolts',
      screws: 'Screws',
      planks: 'Planks',
      scrap: 'Scrap metal',
      wires: 'Wires',
      springs: 'Springs',
      battery: 'Car battery',
      fabric: 'Fabric',
      t_butcher: "Butcher's cleaver",
      t_pustule: 'Acid sac',
      t_screamer: "Banshee's locket",
      t_tank: 'Armour plate',
      t_shroom: 'Shroom cap',
      k_medkit: 'Medkit',
      k_grenades: 'Grenades',
      k_magnet: 'Magnet',
      k_vest: 'Armour vest',
      k_vaccine: 'Vaccine',
    },
    ru: {
      gears: 'Шестерёнки',
      tape: 'Изолента',
      fuel: 'Топливо',
      cans: 'Консервы',
      bandages: 'Бинты',
      bulbs: 'Лампы',
      tools: 'Инструменты',
      catfood: 'Кошачий корм',
      antiseptic: 'Антисептик',
      chips: 'Микросхемы',
      gpu: 'Видеокарта',
      vaccine: 'Образец вакцины',
      usb: 'Флешка',
      nuts: 'Гайки и болты',
      screws: 'Саморезы',
      planks: 'Доски',
      scrap: 'Металлолом',
      wires: 'Провода',
      springs: 'Пружины',
      battery: 'Аккумулятор',
      fabric: 'Ткань',
      t_butcher: 'Тесак Мясника',
      t_pustule: 'Кислотный мешок',
      t_screamer: 'Медальон Крикуньи',
      t_tank: 'Бронепластина',
      t_shroom: 'Шляпка гриба',
      k_medkit: 'Аптечка',
      k_grenades: 'Гранаты',
      k_magnet: 'Магнит',
      k_vest: 'Бронежилет',
      k_vaccine: 'Вакцина',
    },
  };
  const FROM = {
    material: { ru: 'Падает с зомби и из ящиков в рейдах', en: 'Dropped by zombies and found in crates on raids' },
    trophy: { ru: 'Падает с босса, один на победу', en: 'Dropped by a boss, one per win' },
    kit: { ru: 'Собирается на верстаке из материалов', en: 'Crafted at the workbench from materials' },
  };
  const L = {
    ru: {
      'nav.game': 'Игра',
      'nav.market': 'Маркет',
      'coll.items': 'Предметы',
      'coll.itemsSub': 'Из игры · 31 вид',
      'acct.in': 'Войти',
      'acct.out': 'Выйти',
      'items.h1': 'Предметы Meow Division',
      'items.lead':
        'Материалы, трофеи боссов и наборы из рейдов Коппера. Предметы лежат на вашем кошельке, торговать ими можно здесь или в игре.',
      'chip.intents': 'Купить через NEAR Intents',
      'ingame.b': 'Тот же рынок есть в игре:',
      'ingame.s': 'окно Уолта, вкладка «Рынок».',
      'st.floor': 'Цена от',
      'st.vol': 'Оборот за 24 ч',
      'st.listed': 'На продаже',
      'st.owners': 'Продавцов',
      'st.fee': 'Комиссия',
      'st.sold': 'Продано за 24 ч',
      'tr.onlyYours': 'Сейчас на продаже только ваши лоты.',
      'ob.bids': 'Покупают',
      'ob.noBids': 'Заявок на покупку пока нет',
      'ob.bestBid': 'заявка',
      'ob.anyItem': 'Купят любой предмет по этой цене',
      'sw.h': 'Выкуп снизу стакана: самые дешёвые лоты всех предметов одной покупкой',
      'sw.tip': 'Нажмите на строку стакана: возьмём всё от флора до этой цены.',
      'sw.levels': 'По ценам',
      'sw.get': 'Вы получите',
      'tab.market': 'Рынок',
      'tab.mine': 'Мои предметы',
      'tab.activity': 'История',
      'mode.shop': 'Витрина',
      'mode.book': 'Стакан',
      'kind.all': 'Все',
      'kind.material': 'Материалы',
      'kind.trophy': 'Трофеи',
      'kind.kit': 'Наборы',
      'rar.1': 'Обычный',
      'rar.2': 'Необычный',
      'rar.3': 'Редкий',
      'rar.4': 'Трофей',
      search: 'Найти предмет',
      sort: 'Порядок',
      'sort.cheap': 'Сначала дешёвые',
      'sort.dear': 'Сначала дорогие',
      'sort.new': 'Сначала новые',
      'card.buy': 'Купить',
      'card.book': 'Открыть стакан',
      'pay.min': 'мин. $1',
      'card.none': 'Нет лотов',
      'card.sell': 'Продать',
      'rail.h': 'Сделки',
      'ob.floor': 'мин. цена',
      'ob.have': 'У вас',
      'ob.last': 'Последняя',
      'ob.listed': 'В продаже',
      'ob.sold7': 'Продано за 7 дней',
      'ob.sellers': 'Продавцов',
      'ob.book': 'Стакан',
      'ob.asks': 'Продают',
      'ob.price': 'Цена',
      'ob.qty': 'Шт.',
      'ob.sum': 'Сумма',
      'ob.who': 'Кто',
      'ob.spread': 'разница',
      'ob.tipA': 'Купить до этой цены',
      'ob.chart': 'Цена за 14 дней',
      'ob.noAsks': 'Никто не продаёт',
      'ob.yours': 'Это ваш лот',
      'ob.you': 'вы',
      'ob.noChart': 'Сделок ещё не было: график появится после первой продажи',
      'tr.buy': 'Купить',
      'tr.sell': 'Продать',
      'tr.qty': 'Сколько',
      'tr.onSale': 'в продаже',
      'tr.take': 'Заберём самые дешёвые лоты',
      'tr.total': 'Итого',
      'tr.go': 'Купить через NEAR Intents',
      'tr.coins': 'Платите USDT, ETH, SOL, BTC и ещё 200+ монетами из 30+ сетей',
      'tr.min': 'Минимальная покупка $1, добавьте штук.',
      'tr.none': 'Сейчас этот предмет никто не продаёт. Загляните позже или выставьте свой, если он у вас есть.',
      'tr.each': 'Цена за шт.',
      'tr.have': 'у вас',
      'tr.sum': 'Сумма',
      'tr.fee': 'Комиссия маркета 2,5%',
      'tr.get': 'Вы получите',
      'tr.list': 'Выставить на продажу',
      'tr.payout':
        'Выплата в USDC на ваш кошелёк NEAR сразу после покупки. Пока лот выставлен, предмета нет в тайнике.',
      'tr.noOwn': 'У вас нет этого предмета.',
      'tr.setFloor': 'мин. цена',
      'tr.trades': 'Сделки по предмету',
      'tr.noTrades': 'Сделок ещё не было',
      'tr.signin': 'Войдите, чтобы покупать и продавать: предметы приходят на ваш кошелёк NEAR.',
      'tr.off': 'Оплата скоро откроется. Пока можно смотреть цены.',
      'mine.stash': 'На кошельке',
      'mine.stashSub': 'Нажмите на предмет, чтобы продать',
      'mine.lots': 'Мои лоты',
      'mine.orders': 'Мои покупки',
      'mine.pays': 'Выплаты',
      'mine.paysSub': 'USDC на ваш кошелёк NEAR',
      'mine.note':
        'Пока предмет выставлен, он не лежит в тайнике и в рейд не попадёт. Снять лот можно в любой момент, предмет сразу вернётся.',
      'mine.signin': 'Войдите, чтобы видеть свои предметы, лоты и покупки.',
      'mine.cancel': 'Снять',
      'mine.each': 'за шт.',
      'mine.noLots': 'Лотов пока нет. Нажмите на предмет слева.',
      'mine.noOrders': 'Покупок ещё не было.',
      'mine.noPays': 'Выплат пока нет.',
      'mine.lotsSum': 'на сумму',
      'mine.held': 'в оплате',
      'mine.empty': 'Тайник пуст. Предметы приносят рейды в игре.',
      'os.wait': 'Ждём оплату',
      'os.done': 'Куплено',
      'os.refunded': 'Деньги вернулись',
      'os.failed': 'Не прошло',
      'os.gone': 'Время вышло',
      'os.dropped': 'Отменена',
      'os.back': 'Деньги возвращаются',
      'os.new': 'Готовим адрес',
      'ps.q': 'В пути',
      'ps.done': 'Отправлено',
      'ps.fail': 'Ошибка, разбираемся',
      'pw.sale': 'за продажу',
      'pw.refund': 'возврат',
      'ev.sale': 'Продажа',
      'th.ev': 'Событие',
      'th.item': 'Предмет',
      'th.price': 'Цена',
      'th.qty': 'Шт.',
      'th.from': 'От',
      'th.to': 'Кому',
      'th.when': 'Когда',
      'ago.m': 'мин назад',
      'ago.h': 'ч назад',
      'ago.d': 'дн назад',
      'ago.now': 'только что',
      'act.none': 'Продаж ещё не было.',
      'pay.title': 'Оплата',
      'pay.with': 'Чем платить',
      'pay.more': 'монеты из 30+ сетей',
      'pay.intents': 'Купить через NEAR Intents',
      'pay.wallet': 'С кошелька NEAR',
      'pay.other': 'Другая монета',
      'pay.from$': 'от',
      'pay.approx': 'около',
      'pay.get': 'Получить адрес для оплаты',
      'pay.getting': 'Готовим адрес…',
      'pay.send': 'Отправьте ровно',
      'pay.any': 'С любого кошелька или биржи на этот адрес, в сети',
      'pay.any2': 'NEAR Intents обменяет монету и оплатит лот.',
      'pay.copy': 'Скопировать',
      'pay.copied': 'Адрес скопирован',
      'pay.memo': 'Мемо (обязательно)',
      'pay.refund': 'Куда вернуть деньги, если обмен не пройдёт (необязательно)',
      'pay.refundPh': 'Ваш адрес в сети',
      'pay.refundDef': 'Без адреса деньги вернутся на ваш счёт NEAR Intents',
      'pay.s1': 'Ждём перевод',
      'pay.s2': 'NEAR Intents меняет',
      'pay.s2to': 'на USDC',
      'pay.s2s': 'Продавец получает 97,5%',
      'pay.s3': 'Предмет у вас',
      'pay.s3s': 'Он уже в тайнике игры',
      'pay.walletHint':
        'Кошелёк попросит подтвердить один перевод. NEAR сначала обернётся в wNEAR, потом NEAR Intents обменяет монету на USDC. Предмет придёт в тайник после оплаты.',
      'pay.how': 'Как платить',
      'pay.intentsSub': '200+ монет из любой сети',
      'pay.onNear': 'монеты в сети NEAR',
      'pay.bal': 'есть',
      'pay.low': 'не хватает',
      'pay.from': 'Спишем с',
      'pay.go': 'Оплатить',
      'pay.connect': 'Подключите кошелёк NEAR',
      'pay.fine':
        '<b>Цена окончательная.</b> Комиссию маркета 2,5% платит продавец. Комиссия NEAR Intents уже в сумме монеты. Адрес ждёт оплату до конца таймера; если обмен не прошёл, деньги вернутся.',
      'pay.doneK': 'Покупка прошла',
      'pay.done': 'Готово!',
      'pay.doneSub': 'Предмет на вашем кошельке и в тайнике игры.',
      'pay.close': 'Закрыть',
      'pay.seen': 'Перевод замечен, меняем…',
      'pay.late': 'Время оплаты вышло. Если вы всё же отправили монеты, они вернутся.',
      'pay.refundedM': 'Обмен не прошёл, деньги вернулись на адрес возврата.',
      'err.below minimum': 'Для этой монеты минимум',
      'err.not enough on sale': 'Столько уже не продают, обновили стакан.',
      'err.too many open orders': 'У вас уже есть две неоплаченные покупки. Оплатите или отмените одну.',
      'err.intents out of reach': 'NEAR Intents не отвечает, попробуйте через минуту.',
      'err.coin refused': 'Эту монету сейчас не принимают, выберите другую.',
      'err.payments off': 'Оплата пока выключена.',
      'err.not enough': 'Столько этого предмета у вас нет.',
      'err.wallet out of reach': 'Кошелёк не ответил, попробуйте ещё раз.',
      'err.sign in again': 'Войдите заново.',
      'err.held by a purchase': 'Лот сейчас в оплате у покупателя.',
      'err.too many lots': 'Слишком много лотов, снимите какие-нибудь.',
      'err.no such lot': 'Этот лот уже купили или сняли с продажи.',
      'err.your own lot': 'Это ваш лот.',
      title: 'Маркет Meow Division',
      'lot.you': 'Ваш лот',
      'lot.open': 'Открыть',
      'lot.seller': 'Продавец',
      'lot.floor': 'Мин. цена',
      'lot.last': 'Последняя продажа',
      'lot.goneH': 'Лота нет',
      'lot.gone': 'Этот лот уже купили или сняли с продажи.',
      'lot.all': 'Все лоты',
      'lot.allOf': 'Все лоты:',
      'lot.allN': 'все',
      'lot.heldH': 'Этот лот сейчас оплачивает покупатель',
      'lot.held': 'Пока идёт оплата, лот закреплён за ним. Если оплата не придёт вовремя, лот вернётся на витрину.',
      'pay.holdH': 'Лот закреплён за вами:',
      'pay.hold': 'Пока идёт оплата, его никто не купит.',
      'pay.making': 'Готовим заказ…',
      'pay.confirm': 'Подтвердите в кошельке…',
      'pay.sentH': 'Перевод отправлен',
      'pay.goingH': 'Оплата получена, покупка завершается',
      'pay.going':
        'NEAR Intents меняет монету на USDC, обычно это 1–3 минуты. Лот закреплён за вами. Окно можно закрыть: предмет придёт в тайник сам, а страница скажет, когда всё готово.',
      'pay.goingFine': 'Идёт',
      'pay.bg': 'Закрыть, покупка завершится сама',
      'note.bought': 'Куплено',
      'note.boughtS': 'Предмет в тайнике.',
      'note.sold': 'Продано',
      'note.soldS': 'отправлено на ваш кошелёк',
      'pend.h': 'Идёт оплата',
      'pend.wait': 'Ждём перевод. Лот закреплён за вами.',
      'pend.going': 'Оплата получена, покупка завершается (1–3 минуты).',
      'pend.open': 'Открыть',
      'lot.under':
        'Весь лот дешевле $1, а покупка от $1. Этот предмет можно взять в «Стакане»: туда сложатся несколько лотов.',
      'lot.share': 'Скопировать ссылку',
      'lot.link': 'Ссылка',
      'lot.copied': 'Ссылка скопирована',
      'lot.mine': 'Это ваш лот. Отправьте ссылку покупателю или снимите лот, предмет вернётся в тайник.',
      'lot.by': 'Лоты продавца',
      'lot.myLots': 'Мои лоты',
      'lot.myAll': 'Ссылка на все мои лоты',
      'lot.count': 'На продаже:',
      'empty.h': 'Сейчас ничего не продаётся',
      'empty.p': 'Предметы приносят рейды в игре. Есть свои? Выставьте их во вкладке «Мои предметы».',
      'empty.sell': 'Продать свои',
      'empty.clear': 'Показать все лоты',
      'sell.doneK': 'ГОТОВО',
      'sell.doneSub': 'Ссылка ниже открывает этот лот. Отправьте её покупателю.',
      'sell.open': 'Открыть лот',
      'err.any': 'Не получилось',
      'toast.listed': 'Лот выставлен',
      'toast.cancel': 'Лот снят, предмет вернулся в тайник',
      'toast.login': 'Вы вошли',
      'toast.out': 'Вы вышли',
      'foot.demo':
        'Предметы — токены NEP-245 на items.meowdivision.near. Оплата через NEAR Intents (1Click), выплаты в USDC на NEAR.',
      'foot.fee': 'Комиссия маркета 2,5%',
      none: 'Ничего не нашлось',
      h24: 'за 24 ч',
      h24s: '24 ч',
      'il.item': 'Предмет',
      pcs: 'шт.',
      'all.row': 'Все',
      'all.h': 'Все предметы',
      'all.from': 'Лоты всех предметов в одном стакане, сложены по цене',
      'all.kinds': 'Видов',
      'all.chart': 'Оборот за 14 дней',
      'ob.what': 'Что',
      'all.sell': 'Выберите, что продать:',
      'all.pick': 'Выберите, что купить (от самых дешёвых):',
      'all.trades': 'Сделки по всем предметам',
    },
    en: {
      'nav.game': 'Game',
      'nav.market': 'Market',
      'coll.items': 'Items',
      'coll.itemsSub': 'From the game · 31 kinds',
      'acct.in': 'Sign in',
      'acct.out': 'Sign out',
      'items.h1': 'Meow Division Items',
      'items.lead':
        'Materials, boss trophies and kits from Copper’s raids. Items sit in your wallet, and you can trade them here or inside the game.',
      'chip.intents': 'Buy through NEAR Intents',
      'ingame.b': 'The same market is in the game:',
      'ingame.s': 'Walt’s window, the Market tab.',
      'st.floor': 'Floor',
      'st.vol': '24 h volume',
      'st.listed': 'Listed',
      'st.owners': 'Sellers',
      'st.fee': 'Fee',
      'st.sold': 'Sold, 24 h',
      'tr.onlyYours': 'Only your own listings are up right now.',
      'ob.bids': 'Buying',
      'ob.noBids': 'No buy orders yet',
      'ob.bestBid': 'best bid',
      'ob.anyItem': 'Buys any item at this price',
      'sw.h': 'Sweep from the bottom: the cheapest listings of every item, in one purchase',
      'sw.tip': 'Click a row in the book: everything from the floor up to that price.',
      'sw.levels': 'By price',
      'sw.get': 'You get',
      'tab.market': 'Market',
      'tab.mine': 'My items',
      'tab.activity': 'Activity',
      'mode.shop': 'Shelf',
      'mode.book': 'Order book',
      'kind.all': 'All',
      'kind.material': 'Materials',
      'kind.trophy': 'Trophies',
      'kind.kit': 'Kits',
      'rar.1': 'Common',
      'rar.2': 'Uncommon',
      'rar.3': 'Rare',
      'rar.4': 'Trophy',
      search: 'Find an item',
      sort: 'Order',
      'sort.cheap': 'Cheapest first',
      'sort.dear': 'Most expensive first',
      'sort.lots': 'Most listings',
      'sort.hot': 'Most sold',
      'card.buy': 'Buy',
      'card.book': 'Open the order book',
      'pay.min': 'min. $1',
      'card.none': 'Nothing listed',
      'card.sell': 'Sell',
      'rail.h': 'Trades',
      'ob.floor': 'floor',
      'ob.have': 'You have',
      'ob.last': 'Last trade',
      'ob.listed': 'Listed',
      'ob.sold7': 'Sold in 7 days',
      'ob.sellers': 'Sellers',
      'ob.book': 'Order book',
      'ob.asks': 'Selling',
      'ob.price': 'Price',
      'ob.qty': 'Qty',
      'ob.sum': 'Total',
      'ob.who': 'Who',
      'ob.spread': 'spread',
      'ob.tipA': 'Buy up to this price',
      'ob.chart': 'Price, 14 days',
      'ob.noAsks': 'Nobody is selling',
      'ob.yours': 'That’s your listing',
      'ob.you': 'you',
      'ob.noChart': 'No trades yet: the chart starts with the first sale',
      'tr.buy': 'Buy',
      'tr.sell': 'Sell',
      'tr.qty': 'How many',
      'tr.onSale': 'listed',
      'tr.take': 'We take the cheapest listings',
      'tr.total': 'Total',
      'tr.go': 'Buy through NEAR Intents',
      'tr.coins': 'Pay with USDT, ETH, SOL, BTC and 200+ more coins on 30+ networks',
      'tr.min': 'The minimum buy is $1, add a few more.',
      'tr.none': 'Nobody is selling this item right now. Look in later, or list yours if you have it.',
      'tr.each': 'Price each',
      'tr.have': 'you have',
      'tr.sum': 'Amount',
      'tr.fee': 'Market fee 2.5%',
      'tr.get': 'You get',
      'tr.list': 'List for sale',
      'tr.payout': 'Paid in USDC to your NEAR wallet as soon as someone buys. A listed item is not in your stash.',
      'tr.noOwn': 'You don’t have this item.',
      'tr.setFloor': 'floor',
      'tr.trades': 'Trades of this item',
      'tr.noTrades': 'No trades yet',
      'tr.signin': 'Sign in to buy and sell: the items go to your NEAR wallet.',
      'tr.off': 'Payments open soon. For now you can watch the prices.',
      'mine.stash': 'In your wallet',
      'mine.stashSub': 'Tap an item to sell it',
      'mine.lots': 'My listings',
      'mine.orders': 'My purchases',
      'mine.pays': 'Payouts',
      'mine.paysSub': 'USDC to your NEAR wallet',
      'mine.note':
        'A listed item leaves your stash and can’t go on a raid. You can take a listing down at any time and the item comes straight back.',
      'mine.signin': 'Sign in to see your items, listings and purchases.',
      'mine.cancel': 'Cancel',
      'mine.each': 'each',
      'mine.noLots': 'No listings yet. Tap an item on the left.',
      'mine.noOrders': 'No purchases yet.',
      'mine.noPays': 'No payouts yet.',
      'mine.lotsSum': 'worth',
      'mine.held': 'being paid for',
      'mine.empty': 'Your stash is empty. Raids in the game bring items.',
      'os.wait': 'Waiting for payment',
      'os.done': 'Bought',
      'os.refunded': 'Refunded',
      'os.failed': 'Failed',
      'os.gone': 'Expired',
      'os.dropped': 'Cancelled',
      'os.back': 'Money on its way back',
      'os.new': 'Getting the address',
      'ps.q': 'On its way',
      'ps.done': 'Sent',
      'ps.fail': 'Failed, we’re on it',
      'pw.sale': 'for a sale',
      'pw.refund': 'refund',
      'ev.sale': 'Sale',
      'th.ev': 'Event',
      'th.item': 'Item',
      'th.price': 'Price',
      'th.qty': 'Qty',
      'th.from': 'From',
      'th.to': 'To',
      'th.when': 'When',
      'ago.m': 'min ago',
      'ago.h': 'h ago',
      'ago.d': 'd ago',
      'ago.now': 'just now',
      'act.none': 'No sales yet.',
      'pay.title': 'Payment',
      'pay.with': 'Pay with',
      'pay.more': 'coins on 30+ networks',
      'pay.intents': 'Buy through NEAR Intents',
      'pay.wallet': 'From your NEAR wallet',
      'pay.other': 'Another coin',
      'pay.from$': 'from',
      'pay.approx': 'about',
      'pay.get': 'Get the payment address',
      'pay.getting': 'Getting the address…',
      'pay.send': 'Send exactly',
      'pay.any': 'From any wallet or exchange to this address, on',
      'pay.any2': 'NEAR Intents swaps the coin and pays for the listing.',
      'pay.copy': 'Copy',
      'pay.copied': 'Address copied',
      'pay.memo': 'Memo (required)',
      'pay.refund': 'Where to send the money back if the swap fails (optional)',
      'pay.refundPh': 'Your address on',
      'pay.refundDef': 'With no address, refunds go to your NEAR Intents account',
      'pay.s1': 'Waiting for the transfer',
      'pay.s2': 'NEAR Intents swaps',
      'pay.s2to': 'to USDC',
      'pay.s2s': 'The seller gets 97.5%',
      'pay.s3': 'The item is yours',
      'pay.s3s': 'It’s already in your game stash',
      'pay.walletHint':
        'Your wallet asks you to confirm one transfer. NEAR is wrapped to wNEAR first, then NEAR Intents swaps the coin to USDC. The item lands in your stash after the payment.',
      'pay.how': 'How to pay',
      'pay.intentsSub': '200+ coins from any network',
      'pay.onNear': 'coins on NEAR',
      'pay.bal': 'have',
      'pay.low': 'not enough',
      'pay.from': 'Paid from',
      'pay.go': 'Pay',
      'pay.connect': 'Connect your NEAR wallet',
      'pay.fine':
        '<b>The price is final.</b> The seller pays the 2.5% market fee. The NEAR Intents fee is already in the coin amount. The address waits for the payment until the timer runs out; if the swap fails, the money comes back.',
      'pay.doneK': 'Purchase complete',
      'pay.done': 'Done!',
      'pay.doneSub': 'The item is in your wallet and your game stash.',
      'pay.close': 'Close',
      'pay.seen': 'Transfer seen, swapping…',
      'pay.late': 'The time to pay ran out. If you sent the coins anyway, they come back.',
      'pay.refundedM': 'The swap failed and the money went back to the refund address.',
      'err.below minimum': 'The minimum for this coin is',
      'err.not enough on sale': 'That many are no longer listed; the book is updated.',
      'err.too many open orders': 'You already have two unpaid purchases. Pay for one or cancel it.',
      'err.intents out of reach': 'NEAR Intents isn’t answering, try again in a minute.',
      'err.coin refused': 'This coin isn’t taken right now, pick another.',
      'err.payments off': 'Payments are off for now.',
      'err.not enough': 'You don’t have that many of this item.',
      'err.wallet out of reach': 'The wallet didn’t answer, try again.',
      'err.sign in again': 'Sign in again.',
      'err.held by a purchase': 'A buyer is paying for this listing right now.',
      'err.too many lots': 'Too many listings, take a few down.',
      'err.no such lot': 'This listing has been bought or taken down.',
      'err.your own lot': 'This is your listing.',
      title: 'Meow Division Market',
      'lot.you': 'Your listing',
      'lot.open': 'Open',
      'lot.seller': 'Seller',
      'lot.floor': 'Lowest price',
      'lot.last': 'Last sale',
      'lot.goneH': 'Listing gone',
      'lot.gone': 'This listing has been bought or taken down.',
      'lot.all': 'All listings',
      'lot.allOf': 'All listings:',
      'lot.allN': 'all',
      'lot.heldH': 'A buyer is paying for this listing right now',
      'lot.held':
        'While they pay, it is held for them. If the payment doesn’t arrive in time, the listing goes back on sale.',
      'pay.holdH': 'Held for you:',
      'pay.hold': 'While you pay, nobody else can buy it.',
      'pay.making': 'Making the order…',
      'pay.confirm': 'Confirm in your wallet…',
      'pay.sentH': 'Transfer sent',
      'pay.goingH': 'Payment received, finishing the purchase',
      'pay.going':
        'NEAR Intents is swapping the coin to USDC, usually 1–3 minutes. The listing is held for you. You can close this window: the item lands in your stash by itself, and the page tells you when it’s done.',
      'pay.goingFine': 'Going for',
      'pay.bg': 'Close, it finishes by itself',
      'note.bought': 'Bought',
      'note.boughtS': 'The item is in your stash.',
      'note.sold': 'Sold',
      'note.soldS': 'sent to your wallet',
      'pend.h': 'Paying',
      'pend.wait': 'Waiting for the transfer. The listing is held for you.',
      'pend.going': 'Payment received, finishing the purchase (1–3 minutes).',
      'pend.open': 'Open',
      'lot.under':
        'The whole listing is under $1, and a purchase starts at $1. Buy this item in the Order book: it takes several listings at once.',
      'lot.share': 'Copy link',
      'lot.link': 'Link',
      'lot.copied': 'Link copied',
      'lot.mine':
        'This is your listing. Send the link to a buyer, or take it down and the item goes back to your stash.',
      'lot.by': 'Listings by',
      'lot.myLots': 'My listings',
      'lot.myAll': 'Link to all my listings',
      'lot.count': 'For sale:',
      'empty.h': 'Nothing is for sale right now',
      'empty.p': 'Items come from raids in the game. Have some? List them on the My items tab.',
      'empty.sell': 'Sell mine',
      'empty.clear': 'Show all listings',
      'sell.doneK': 'DONE',
      'sell.doneSub': 'The link below opens this listing. Send it to a buyer.',
      'sell.open': 'Open the listing',
      'err.any': 'That didn’t work',
      'toast.listed': 'Listed',
      'toast.cancel': 'Listing cancelled, the item is back in your stash',
      'toast.login': 'Signed in',
      'toast.out': 'Signed out',
      'foot.demo':
        'Items are NEP-245 tokens on items.meowdivision.near. Payment through NEAR Intents (1Click), payouts in USDC on NEAR.',
      'foot.fee': 'Market fee 2.5%',
      none: 'Nothing found',
      h24: 'in 24 h',
      h24s: '24 h',
      'il.item': 'Item',
      pcs: 'pcs',
      'all.row': 'All',
      'all.h': 'All items',
      'all.from': 'Every item’s listings in one book, stacked by price',
      'all.kinds': 'Kinds',
      'all.chart': 'Volume, 14 days',
      'ob.what': 'What',
      'all.sell': 'Pick what to sell:',
      'all.pick': 'Pick what to buy (cheapest first):',
      'all.trades': 'Trades of all items',
    },
  };
  // coins shown as tiles (1Click asset ids); the rest of 1Click's list is in "Another coin"
  const TILES = [
    ['nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', '#2775ca', 'Base', 'B', '#0052ff'],
    ['nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near', '#26a17b', 'Ethereum', 'E', '#627eea'],
    ['nep141:eth.omft.near', '#627eea', 'Ethereum'],
    ['nep141:sol.omft.near', '#9945ff', 'Solana'],
    ['nep141:btc.omft.near', '#f7931a', 'Bitcoin'],
    ['nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near', '#2775ca', 'Solana', 'S', '#9945ff'],
    ['nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near', '#26a17b', 'Tron', 'T', '#eb0029'],
    ['nep141:zec.omft.near', '#e5a93d', 'Zcash'],
  ];
  const NETS = {
    eth: 'Ethereum',
    base: 'Base',
    arb: 'Arbitrum',
    op: 'Optimism',
    sol: 'Solana',
    btc: 'Bitcoin',
    ton: 'TON',
    tron: 'Tron',
    bsc: 'BNB Chain',
    pol: 'Polygon',
    avax: 'Avalanche',
    zec: 'Zcash',
    doge: 'Dogecoin',
    xrp: 'XRP Ledger',
    ltc: 'Litecoin',
    bch: 'Bitcoin Cash',
    dash: 'Dash',
    sui: 'Sui',
    aptos: 'Aptos',
    stellar: 'Stellar',
    cardano: 'Cardano',
    gnosis: 'Gnosis',
    bera: 'Bera',
    near: 'NEAR',
    monad: 'Monad',
    starknet: 'Starknet',
    scroll: 'Scroll',
    xlayer: 'XLayer',
    plasma: 'Plasma',
  };
  // paying from the NEAR wallet: these three on NEAR (NEAR itself is wrapped to wNEAR on the way)
  const WALLET = [
    {
      a: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
      ct: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
      s: 'USDC',
      c: '#2775ca',
    },
    { a: 'nep141:usdt.tether-token.near', ct: 'usdt.tether-token.near', s: 'USDT', c: '#26a17b' },
    { a: 'nep141:wrap.near', ct: 'wrap.near', s: 'NEAR', c: '#1c1d19', near: true },
  ];

  // ---------- state ----------
  let lang = 'ru';
  try {
    lang = localStorage.getItem('md-market-lang') || (/^(ru|uk|be|kk)/.test(navigator.language || '') ? 'ru' : 'en');
  } catch (e) {}
  // inside the game (Walt's window, his Market tab: market.html?embed=1&lang=): no site header, the game's language, the
  // game's own wallet window for signing in, and the game told when the stash changed (a lot put up, an item bought)
  const QS = new URLSearchParams(location.search),
    EMBED = QS.has('embed') && window.parent !== window;
  if (EMBED) {
    document.documentElement.classList.add('embed');
    if (L[QS.get('lang')]) lang = QS.get('lang');
  }
  const tellGame = (what) => EMBED && window.parent.postMessage({ md: 'market-' + what }, location.origin);
  if (!L[lang]) lang = 'ru';
  const S = {
    view: 'market',
    mode: 'shop',
    kind: 'all',
    rar: new Set(),
    q: '',
    sort: 'cheap',
    cur: 'usd',
    sel: 'all', // (the order book opens on every item; one item only by its link, /market/<item>)
    side: 'buy',
    bq: 1,
    sq: 1,
    sp: null,
    it: null, // the shelf narrowed to one item (/market/<item>)
    seller: null, // or to one seller's lots (/market/@<account>)
    lot: null, // the lot whose window is open (/market/lot/<id>)
    back: '', // where closing it goes
  };
  // (the page always opens on the shelf with every kind: the view picked last time is not kept)
  let MK = null, // GET /api/market
    TOK = [], // GET /api/market/tokens
    ME = null,
    MINE = {}, // the stash (GET /api/save: save.items)
    MY = { lots: [], orders: [], sold: [], bought: [], pays: [] };
  const BOOK = {};
  let ACT = [],
    LOTS = []; // the shelf: every lot on sale, in dollars

  const url = (r) => '/market' + (r ? '/' + r : '');
  const modded = (e) => e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button > 0;

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const t = (k) => (L[lang] && L[lang][k]) || L.ru[k] || k;
  const nm = (id) => NAMES[lang][id] || id;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const nearUsd = () => (TOK.find((x) => x.a === 'nep141:wrap.near') || {}).usd || 3.4;
  const usd = (v) =>
    v > 0 && v < 0.01 ? '<$0.01' : '$' + (v < 100 ? v.toFixed(2) : Math.round(v).toLocaleString('en-US'));
  const money = (v) => {
    if (S.cur !== 'near') return usd(v);
    const n = v / nearUsd();
    return 'Ⓝ ' + (n < 1 ? n.toFixed(3) : n < 100 ? n.toFixed(2) : Math.round(n).toLocaleString('en-US'));
  };
  const item = (id) => ITEMS.find((i) => i.id === id);
  const img = (id) => `/assets/it_${id}.png`;
  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const short = (a) => (a && a.length > 24 ? a.slice(0, 8) + '…' + a.slice(-6) : a || '');
  const floor = (id) => (BOOK[id] && BOOK[id].asks[0] ? BOOK[id].asks[0].p : null);
  const listed = (id) => (BOOK[id] ? BOOK[id].asks.reduce((s, a) => s + a.q, 0) : 0);
  const avail = (id) => (BOOK[id] ? BOOK[id].asks.filter((a) => a.who !== ME).reduce((s, a) => s + a.q, 0) : 0);
  const slot = (it, cls = '', extra = '') =>
    `<div class="slot r${it.r} ${cls}">${extra}<img src="${img(it.id)}" alt="" loading="lazy"></div>`;
  const ago = (m) =>
    m < 1
      ? t('ago.now')
      : m < 60
        ? `${m} ${t('ago.m')}`
        : m < 1440
          ? `${Math.floor(m / 60)} ${t('ago.h')}`
          : `${Math.floor(m / 1440)} ${t('ago.d')}`;
  const mins = (at) => Math.max(0, Math.floor((Date.now() - at) / 60e3));
  const who = (a) => (a === ME ? `${short(ME)} (${t('ob.you')})` : short(a));
  const chgHtml = (c) =>
    c == null
      ? '<span class="chg">—</span>'
      : `<span class="chg${c < 0 ? ' neg' : ''}">${c > 0 ? '+' : ''}${c}%</span>`;
  const tile = (cls = '') => `<div class="tile ${cls}"><svg aria-hidden="true"><use href="#ic-grid"/></svg></div>`;
  const on = () => !!(MK && MK.on);
  const MIN = () => ((MK && MK.min) || 100) / 100;
  const FEE = () => ((MK && MK.fee) || 250) / 10000;

  // ---------- the server ----------
  const session = () => {
    try {
      const s = JSON.parse(localStorage.getItem(WKEY) || 'null');
      return s && s.token && typeof s.accountId === 'string' ? s : null;
    } catch (e) {
      return null;
    }
  };
  async function api(method, path, body, ms = 30000) {
    const s = session(),
      r = await fetch(API + path, {
        method,
        signal: AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined,
        headers: { 'content-type': 'application/json', ...(s ? { authorization: 'Bearer ' + s.token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    let j = null;
    try {
      j = await r.json();
    } catch (e) {}
    if (r.status === 401 && s) {
      forget();
    }
    if (!r.ok)
      throw Object.assign(new Error((j && j.error) || 'HTTP ' + r.status), { status: r.status, body: j || {} });
    return j;
  }
  const errText = (e) => {
    const k = e && e.message,
      b = (e && e.body) || {};
    if (k === 'below minimum' && b.min) return `${t('err.below minimum')} $${(b.min / 100).toFixed(2)}`;
    return L[lang]['err.' + k] || t('err.any') + (k ? ': ' + k : '');
  };
  // the market's answer → the books the page draws (dollars; asks by price then seller; the trades newest first)
  function build() {
    ITEMS.forEach((i) => {
      const x = MK && MK.items.find((y) => y.it === i.id);
      if (!x) {
        BOOK[i.id] = { asks: [], bids: [], hist: null, trades: [], sold: 0, chg: null, sellers: 0 };
        return;
      }
      let lastAvg = null;
      const firstAvg = (x.hist.find((h) => h.avg != null) || {}).avg;
      const hist =
        firstAvg == null
          ? null
          : x.hist.map((h) => (lastAvg = h.avg != null ? h.avg : lastAvg != null ? lastAvg : firstAvg) / 100);
      BOOK[i.id] = {
        asks: x.asks.map((a) => ({ p: a.p / 100, q: a.n, who: a.s, id: i.id })),
        bids: (x.bids || []).map((a) => ({ p: a.p / 100, q: a.n, id: i.id })),
        hist,
        vols: x.hist.map((h) => h.vol / 100),
        trades: x.tr.map((r) => ({ p: r.p / 100, q: r.n, from: r.s, to: r.b, min: mins(r.at), id: i.id })),
        sold: x.sold7 || 0,
        chg: x.chg,
        sellers: new Set(x.asks.map((a) => a.s)).size,
      };
    });
    ACT = MK
      ? MK.trades.map((r) => ({ ev: 'sale', id: r.it, p: r.p / 100, q: r.n, from: r.s, to: r.b, min: mins(r.at) }))
      : [];
    LOTS = ((MK && MK.lots) || [])
      .filter((l) => item(l.it))
      .map((l) => ({ id: l.id, s: l.s, it: l.it, n: l.n, held: l.held || 0, p: l.p / 100, at: l.at }));
    // «Все»: every lot of any item (one's own too), cheapest first; the chart is the money traded a day
    const asks = [];
    ITEMS.forEach((i) => BOOK[i.id].asks.forEach((a) => asks.push(a)));
    asks.sort((a, b) => a.p - b.p);
    // (the bids of the book of all items: for any item, as a collection bid on HOT Craft; an item's own bids are its book's)
    const bids = ((MK && MK.allBids) || []).map((a) => ({ p: a.p / 100, q: a.n, id: 'all' }));
    const vols = Array.from({ length: 14 }, (_, d) => ITEMS.reduce((s, i) => s + ((BOOK[i.id].vols || [])[d] || 0), 0));
    BOOK.all = {
      asks,
      bids,
      hist: vols.some((v) => v > 0) ? vols : null,
      trades: ACT,
      sold: ITEMS.reduce((s, i) => s + BOOK[i.id].sold, 0),
      chg: null,
      sellers: MK ? MK.totals.sellers : 0,
    };
  }
  async function loadMarket() {
    try {
      MK = await api('GET', '/market', undefined, 15000);
    } catch (e) {
      return;
    }
    build();
    renderAll();
  }
  let seenMine = null; // (who it was for, the orders waiting and the last sale already told)
  async function loadMine() {
    const s = session();
    ME = s ? s.accountId : null;
    if (!ME) {
      MINE = {};
      MY = { lots: [], orders: [], sold: [], bought: [], pays: [] };
      seenMine = null;
      return;
    }
    try {
      const [sv, my] = await Promise.all([api('GET', '/save'), api('GET', '/market/mine')]);
      MINE = (sv && sv.save && sv.save.items) || {};
      MY = my || MY;
    } catch (e) {
      return;
    }
    // a purchase that came through, a lot sold, since the last look: said even with no window open
    const lastSold = MY.sold[0] ? MY.sold[0].at : 0;
    if (seenMine && seenMine.acc === ME) {
      const done = MY.orders.filter((o) => o.st === 'done' && seenMine.wait.has(o.id));
      if (done.length) {
        tellGame('saved');
        if (!payCtx)
          toast(
            `${t('note.bought')}: ${done.map((o) => `${oName(o.it)} ×${o.n}`).join(', ')}. ${t('note.boughtS')}`,
            7000,
          );
      }
      const sold = MY.sold.filter((x) => x.at > seenMine.sold);
      if (sold.length)
        toast(
          `${t('note.sold')}: ${sold.map((x) => `${nm(x.it)} ×${x.n}`).join(', ')} · ${usd(sold.reduce((a, x) => a + (x.n * x.p) / 100, 0) * (1 - FEE()))} USDC ${t('note.soldS')}`,
          7000,
        );
    }
    seenMine = { acc: ME, wait: new Set(MY.orders.filter((o) => o.st === 'wait').map((o) => o.id)), sold: lastSold };
  }
  async function refresh() {
    await loadMine();
    await loadMarket();
  }
  const forget = () => {
    try {
      localStorage.removeItem(WKEY);
    } catch (e) {}
    ME = null;
    MINE = {};
  };

  // ---------- signing in: NEAR Connect, the same NEP-413 login as the game's (live/wallet.js) ----------
  let connector = null;
  async function lib() {
    if (!connector) {
      const { NearConnector } = await import('/vendor/near-connect-0.11.4.js');
      const nonce = (document.querySelector('script[nonce]') || {}).nonce || undefined;
      connector = new NearConnector({
        network: 'mainnet',
        features: { signMessage: true },
        footerBranding: null,
        cspNonce: nonce,
      });
      await connector.whenManifestLoaded;
    }
    return connector;
  }
  const b64bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  let picking = false;
  async function connect() {
    if (EMBED) return tellGame('login'); // (the game's wallet window; the session lands in this browser's storage)
    if (picking) return;
    picking = true;
    try {
      const [c, ch] = await Promise.all([lib(), api('POST', '/challenge', {})]);
      if (!ch || ch.recipient !== LOGIN.recipient || ch.message !== LOGIN.message) throw new Error('bad challenge');
      const id = await c.selectWallet({ features: { signInAndSignMessage: true } });
      let got = null;
      const take = (e) => (got = e && e.accounts);
      c.on('wallet:signInAndSignMessage', take);
      try {
        await c.connect({
          walletId: id,
          signMessageParams: { message: ch.message, recipient: ch.recipient, nonce: b64bytes(ch.nonce) },
        });
      } finally {
        c.off('wallet:signInAndSignMessage', take);
      }
      const a = (got || []).find((x) => x && x.signedMessage),
        s = a && a.signedMessage;
      if (!s) throw new Error('no signature');
      const r = await api('POST', '/login', {
        accountId: s.accountId || a.accountId,
        publicKey: s.publicKey,
        signature: s.signature,
        nonce: ch.nonce,
      });
      localStorage.setItem(WKEY, JSON.stringify({ token: r.token, accountId: r.accountId }));
      toast(t('toast.login'));
      await refresh();
    } catch (e) {
      if (!/reject|cancel|closed|user/i.test(String(e && e.message))) toast(errText(e));
    } finally {
      picking = false;
    }
  }
  async function signOut() {
    forget();
    try {
      if (connector) await connector.disconnect();
    } catch (e) {}
    toast(t('toast.out'));
    await refresh();
  }
  // the wallet NEAR Connect holds for this account (to pay from it), or null
  async function nearWallet() {
    try {
      const c = await lib(),
        w = await c.wallet();
      const accs = (w && (await w.getAccounts())) || [];
      return accs.some((x) => x.accountId === ME) ? w : null;
    } catch (e) {
      return null;
    }
  }
  async function rpcView(contract, method, args) {
    const r = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'query',
        params: {
          request_type: 'call_function',
          finality: 'final',
          account_id: contract,
          method_name: method,
          args_base64: btoa(JSON.stringify(args)),
        },
      }),
    });
    const j = await r.json();
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(j.result.result)));
  }
  async function balances() {
    const out = {};
    await Promise.all(
      WALLET.map(async (k) => {
        try {
          if (k.near) {
            const r = await fetch(RPC, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'query',
                params: { request_type: 'view_account', finality: 'final', account_id: ME },
              }),
            });
            const j = await r.json();
            out[k.a] = Math.max(0, Number(BigInt(j.result.amount) / 10n ** 18n) / 1e6 - 0.05); // (0.05 NEAR kept for gas and storage)
          } else out[k.a] = Number(await rpcView(k.ct, 'ft_balance_of', { account_id: ME })) / 1e6;
        } catch (e) {
          out[k.a] = 0;
        }
      }),
    );
    return out;
  }

  // ---------- helpers on the books ----------
  // one row a price with every item at it (the book of all items, as HOT Craft's): the pieces, one's own among them, the
  // items there
  function levels(arr) {
    const out = [];
    arr.forEach((o) => {
      const x = out[out.length - 1],
        mine = o.who === ME ? o.q : 0;
      if (x && x.p === o.p) {
        x.q += o.q;
        x.mine += mine;
        if (!x.ids.includes(o.id)) x.ids.push(o.id);
      } else out.push({ p: o.p, q: o.q, mine, ids: [o.id] });
    });
    return out;
  }
  // the price of the n-th piece of others from the bottom of a book (what a sweep of n pieces reaches)
  function capOf(id, n) {
    const u = fill(id, n).used;
    return u.length ? u[u.length - 1][1] : null;
  }
  // the cost of the n cheapest pieces (never one's own lots)
  function fill(id, n) {
    let left = n,
      sum = 0;
    const used = [];
    for (const a of BOOK[id].asks) {
      if (a.who === ME) continue;
      if (!left) break;
      const k = Math.min(left, a.q);
      sum += k * a.p;
      left -= k;
      used.push([k, a.p, a.id || id]);
    }
    return { sum: Math.round(sum * 100) / 100, got: n - left, used };
  }
  function minQ(id) {
    const av = avail(id);
    for (let n = 1; n <= av; n++) if (fill(id, n).sum >= MIN()) return n;
    return Math.max(1, av);
  }
  function visible() {
    let list = ITEMS.filter(
      (i) =>
        (S.kind === 'all' || i.kind === S.kind) &&
        (!S.rar.size || S.rar.has(i.r)) &&
        (!S.q || nm(i.id).toLowerCase().includes(S.q.toLowerCase())),
    );
    const F = (i) => floor(i.id) ?? 1e9;
    if (S.sort === 'cheap') list.sort((a, b) => F(a) - F(b));
    if (S.sort === 'dear') list.sort((a, b) => (floor(b.id) ?? -1) - (floor(a.id) ?? -1));
    if (S.sort === 'lots') list.sort((a, b) => listed(b.id) - listed(a.id));
    if (S.sort === 'hot') list.sort((a, b) => BOOK[b.id].sold - BOOK[a.id].sold);
    return list;
  }

  function applyLang() {
    document.documentElement.lang = lang;
    $$('[data-t]').forEach((el) => (el.textContent = t(el.dataset.t)));
    $$('[data-tp]').forEach((el) => (el.placeholder = t(el.dataset.tp)));
    $$('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    renderAll();
  }

  // ---------- renderers ----------
  function renderStats() {
    const T = (MK && MK.totals) || { floor: null, vol24: 0, sold24: 0, listed: 0, sellers: 0 };
    $('#stats').innerHTML = [
      [t('st.floor'), T.floor != null ? money(T.floor / 100) : '—'],
      [t('st.listed'), T.listed],
      [t('st.owners'), T.sellers],
      [t('st.sold'), T.sold24 || 0],
      [t('st.vol'), money(T.vol24 / 100)],
      [t('st.fee'), (FEE() * 100).toFixed(1).replace('.0', '') + '%'],
    ]
      .map(([k, v]) => `<div class="stat"><small>${k}</small><b class="num">${v}</b></div>`)
      .join('');
    $('#cntMarket').textContent = T.listed;
    $('#cntMine').textContent = ME ? Object.values(MINE).reduce((s, x) => s + x, 0) : '';
    const an = $('#acctName');
    an.textContent = ME ? short(ME) : t('acct.in');
    $('#acct').title = ME ? t('acct.out') : '';
  }
  // the fewest pieces of a lot that make the minimum purchase
  const lotMin = (l) => clamp(Math.ceil((MIN() * 100) / Math.round(l.p * 100) - 1e-9), 1, l.n);
  // the shelf: the lots on sale and nothing else, narrowed by the address and the filters
  function shelf() {
    const q = S.q.toLowerCase();
    const list = LOTS.filter((l) => {
      const i = item(l.it);
      return (
        l.n > 0 &&
        (!S.it || l.it === S.it) &&
        (!S.seller || l.s === S.seller) &&
        (S.kind === 'all' || i.kind === S.kind) &&
        (!S.rar.size || S.rar.has(i.r)) &&
        (!q || nm(l.it).toLowerCase().includes(q) || l.s.includes(q))
      );
    });
    if (S.sort === 'dear') list.sort((a, b) => b.p - a.p || a.at - b.at);
    else if (S.sort === 'new') list.sort((a, b) => b.at - a.at);
    else list.sort((a, b) => a.p - b.p || a.at - b.at);
    return list;
  }
  function renderPending() {
    const el = $('#pending'),
      w = ME ? MY.orders.filter((o) => o.st === 'wait') : [];
    el.hidden = !w.length;
    el.innerHTML = w
      .map(
        (o) =>
          `<div class="hold go">${oPic(o.it)}<div><b>${t('pend.h')}: ${esc(oName(o.it))} ×${o.n} · ${money(o.cents / 100)}</b><span>${o.seen && o.seen !== 'PENDING_DEPOSIT' ? t('pend.going') : t('pend.wait')}</span></div><button type="button" class="btn sm" data-resume="${o.id}">${t('pend.open')}</button></div>`,
      )
      .join('');
  }
  function renderGrid() {
    const list = shelf(),
      narrowed = S.it || S.seller || S.kind !== 'all' || S.rar.size || S.q;
    renderPending();
    renderCrumb();
    $('#grid').innerHTML = list.length
      ? list
          .map((l) => {
            const i = item(l.it),
              own = l.s === ME;
            return `<div class="card${own ? ' own' : ''}">
        <a class="open" href="${url('lot/' + l.id)}" data-lot="${l.id}">
          ${slot(i, '', `<span class="cnt">×${l.n}</span>`)}
          <h3>${esc(nm(l.it))}</h3>
          <div class="row num"><b>${money(l.p)}</b><span>${t('mine.each')}</span></div>
        </a>
        <a class="who" href="${url('@' + l.s)}" data-go="@${esc(l.s)}">${own ? t('lot.you') : esc(short(l.s))}</a>
        ${own ? `<button type="button" class="btn qbuy" data-lot="${l.id}">${t('lot.open')}</button>` : `<button type="button" class="btn-p qbuy" data-buylot="${l.id}" title="${t('tr.go')}"><svg aria-hidden="true"><use href="#near"/></svg>${t('card.buy')}</button>`}
      </div>`;
          })
          .join('')
      : narrowed
        ? `<div class="empty"><p>${t('none')}</p><button type="button" class="btn" data-clear>${t('empty.clear')}</button></div>`
        : `<div class="empty"><b>${t('empty.h')}</b><p>${t('empty.p')}</p>${ME && Object.values(MINE).some((x) => x > 0) ? `<button type="button" class="btn-p" data-go="my">${t('empty.sell')}</button>` : ''}</div>`;
  }
  // the shelf narrowed to one item or one seller: what it is, its link, back to every lot
  function renderCrumb() {
    const el = $('#crumb');
    if (!S.it && !S.seller) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    let html;
    if (S.it) {
      const i = item(S.it),
        b = BOOK[S.it],
        f = floor(S.it),
        last = b && b.trades[0] ? b.trades[0].p : null;
      html = `${slot(i)}<div><b>${esc(nm(S.it))}</b><span class="num">${t('lot.floor')} ${f != null ? money(f) : '—'} · ${t('lot.last')} ${last != null ? money(last) : '—'} · ${t('ob.sold7')}: ${b ? b.sold : 0}</span></div>
        <button type="button" class="btn sm ghost" data-open="${S.it}">${t('mode.book')}</button>`;
    } else
      html = `<div class="tile"><svg aria-hidden="true"><use href="#st-own"/></svg></div><div><b>${S.seller === ME ? t('lot.myLots') : `${t('lot.by')} ${esc(short(S.seller))}`}</b><span class="num">${t('lot.count')} ${LOTS.filter((l) => l.s === S.seller && l.n > 0).length}</span></div>`;
    el.innerHTML = `${html}<button type="button" class="btn sm ghost" data-share="${S.it ? S.it : '@' + esc(S.seller)}">${t('lot.share')}</button><button type="button" class="btn sm ghost" data-go=""><svg aria-hidden="true"><use href="#close"/></svg>${t('lot.all')}</button>`;
    el.hidden = false;
  }
  function renderFeed() {
    $('#feed').innerHTML = ACT.length
      ? ACT.slice(0, 14)
          .map((a) => {
            const i = item(a.id);
            return `<div class="fr${a.min === 0 ? ' new' : ''}" data-go="${a.id}">${slot(i)}<div><b>${t('ev.' + a.ev)} · ${esc(nm(a.id))}</b><span>${esc(short(a.from))} → ${esc(short(a.to))}</span></div><div class="r"><b class="num">${money(a.p)}</b><span>${ago(a.min)}</span></div></div>`;
          })
          .join('')
      : `<p class="fine">${t('act.none')}</p>`;
  }
  function renderList() {
    const list = visible().filter((i) => listed(i.id) > 0 || i.id === S.sel);
    const groups = ['material', 'trophy', 'kit']
      .map((k) => [k, list.filter((i) => i.kind === k)])
      .filter(([, a]) => a.length);
    const price = (f) => (f != null ? `<b class="p">${money(f)}</b>` : '<b class="p none">—</b>');
    const all = `<button type="button" class="irow all" data-sel="all" aria-current="${S.sel === 'all'}">${tile()}<b class="n">${t('all.row')}</b><span>${listed('all')}</span>${price(floor('all'))}<span></span></button>`;
    $('#ilist').innerHTML =
      all +
      (groups.length
        ? groups
            .map(
              ([k, a]) =>
                `<h4>${t('kind.' + k)}</h4>` +
                a
                  .map(
                    (i) =>
                      `<button type="button" class="irow" data-sel="${i.id}" aria-current="${i.id === S.sel}" title="${esc(nm(i.id))}">${slot(i)}<b class="n">${esc(nm(i.id))}</b><span>${listed(i.id)}</span>${price(floor(i.id))}${chgHtml(BOOK[i.id].chg)}</button>`,
                  )
                  .join(''),
            )
            .join('')
        : `<p class="lr-none">${t('none')}</p>`);
  }
  // the chart in real pixels of its box (text stays 11px at any width)
  function chart(hist, W, H) {
    const L0 = 46,
      R0 = 12,
      T0 = 10,
      B0 = 22;
    const cv = (v) => (S.cur === 'near' ? v / nearUsd() : v);
    const d = hist.map(cv);
    const mn = Math.min(...d),
      mx = Math.max(...d);
    const lines = clamp(Math.floor((H - T0 - B0) / 38), 2, 5);
    const raw = (mx - mn) / lines || mx * 0.1 || 0.01,
      p10 = Math.pow(10, Math.floor(Math.log10(raw))),
      m = raw / p10;
    const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p10;
    const lo = Math.max(0, Math.floor(mn / step) * step),
      hi = Math.max(Math.ceil(mx / step) * step, lo + step);
    const x = (i) => L0 + (i * (W - L0 - R0)) / (d.length - 1);
    const y = (v) => T0 + ((hi - v) / (hi - lo)) * (H - T0 - B0);
    const dec = step < 0.01 ? 3 : step < 1 ? 2 : 0;
    const lab = (v) => (S.cur === 'near' ? 'Ⓝ' : '$') + v.toFixed(dec);
    let grid = '';
    for (let v = lo; v <= hi + step / 2; v += step)
      grid += `<line x1="${L0}" x2="${W - R0}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="rgba(255,255,255,.08)"/><text x="${L0 - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${lab(v)}</text>`;
    const mon =
      lang === 'ru'
        ? ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
        : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const every = W > 560 ? 2 : 4,
      today = new Date();
    let xl = '';
    d.forEach((_, i) => {
      const back = d.length - 1 - i;
      if (back % every) return;
      const dt = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
      const s = lang === 'ru' ? `${dt.getDate()} ${mon[dt.getMonth()]}` : `${mon[dt.getMonth()]} ${dt.getDate()}`;
      xl += `<text x="${x(i).toFixed(1)}" y="${H - 5}" text-anchor="${i === d.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'}">${s}</text>`;
    });
    const pts = d.map((v, i) => `${x(i).toFixed(1)} ${y(v).toFixed(1)}`);
    const line = 'M' + pts.join(' L');
    const lx = x(d.length - 1),
      ly = y(d[d.length - 1]);
    return `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('ob.chart')}">
      <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffad3b" stop-opacity=".32"/><stop offset="1" stop-color="#ffad3b" stop-opacity="0"/></linearGradient></defs>
      ${grid}${xl}
      <path d="${line} L${lx.toFixed(1)} ${y(lo).toFixed(1)} L${L0} ${y(lo).toFixed(1)} Z" fill="url(#ga)"/>
      <path d="${line}" fill="none" stroke="#ffad3b" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4" fill="#ffad3b" stroke="#1c1d19" stroke-width="2"/></svg>`;
  }
  function drawChart() {
    const el = $('#chartbox');
    if (!el) return;
    const h = BOOK[S.sel] && BOOK[S.sel].hist;
    if (!h) {
      el.innerHTML = `<p class="fine nochart">${t('ob.noChart')}</p>`;
      return;
    }
    const w = Math.floor(el.clientWidth),
      hh = Math.floor(el.clientHeight);
    if (w > 80 && hh > 60) el.innerHTML = chart(h, w, hh);
  }
  const bookRows = () =>
    innerWidth > 1100 && innerHeight >= 600
      ? clamp(Math.floor((innerHeight - (innerWidth <= 1240 ? 690 : 600) + (EMBED ? 150 : 0)) / 50), 3, 10)
      : 6;
  function renderBook() {
    const all = S.sel === 'all',
      id = S.sel,
      i = item(id),
      b = BOOK[id],
      f = floor(id),
      own = all ? 0 : MINE[id] || 0;
    if (!b) return;
    const N = bookRows() * 2,
      asks = (all ? levels(b.asks) : b.asks).slice(0, N),
      bids = (all ? levels(b.bids) : b.bids).slice(0, N),
      best = b.bids[0] ? b.bids[0].p : null;
    // (a sweep picked from the book of all items: its rows lit, from the floor up to the price it reaches)
    const cap = all && S.side === 'buy' && avail('all') ? capOf('all', S.bq) : null;
    const maxQ = Math.max(1, ...asks.map((a) => a.q), ...bids.map((a) => a.q));
    let c = 0;
    const aCum = asks.map((a) => (c += a.q));
    const tot = Math.max(aCum[aCum.length - 1] || 0, 1);
    const bar = (q, cum) => (all ? Math.max(4, (q / maxQ) * 30).toFixed(1) : ((cum / tot) * 100).toFixed(1));
    const ask = (o, k) =>
      all
        ? `<button type="button" class="lr a all${o.mine === o.q ? ' me' : ''}${cap != null && o.p <= cap + 1e-9 ? ' sel' : ''}" data-lr="a:${k}" data-p="${o.p}" title="${esc(o.ids.map(nm).join(', '))}"><i class="d" style="width:${bar(o.q)}%"></i>${slot(item(o.ids[0]), 'mini')}<span class="p">${money(o.p)}</span><span>${o.q}</span></button>`
        : `<button type="button" class="lr a${o.who === ME ? ' me' : ''}" data-lr="a:${k}" title="${t('ob.tipA')}"><i class="d" style="width:${bar(o.q, aCum[k])}%"></i><span class="p">${money(o.p)}</span><span>${o.q}</span><span>${money(o.p * o.q)}</span><span class="w">${esc(o.who === ME ? t('ob.you') : short(o.who))}</span></button>`;
    const bid = (o) =>
      all
        ? `<div class="lr b all" title="${t('ob.anyItem')}"><i class="d" style="width:${bar(o.q)}%"></i>${tile('mini')}<span class="p">${money(o.p)}</span><span>${o.q}</span></div>`
        : `<div class="lr b"><i class="d" style="width:${Math.max(4, (o.q / maxQ) * 30).toFixed(1)}%"></i><span class="p">${money(o.p)}</span><span>${o.q}</span><span>${money(o.p * o.q)}</span><span class="w"></span></div>`;
    const last = b.trades[0] ? b.trades[0].p : null;
    const trades = b.trades.slice(0, Math.round(1.8 * bookRows() + 1));
    $('#ob').innerHTML = `
      <div class="ob-head">${all ? tile() : slot(i, 'big')}
        <div><div class="nm"><h2>${all ? t('all.h') : esc(nm(id))}</h2>
          <div class="tags">${all ? `<span class="tag">${t('all.kinds')}: ${ITEMS.length}</span>` : `<span class="tag rar r${i.r}">${t('rar.' + i.r)}</span><span class="tag">${t('kind.' + i.kind)}</span>${own ? `<span class="tag">${t('ob.have')}: ${own}</span>` : ''}`}</div></div>
          <p class="from">${all ? t('all.from') : FROM[i.kind][lang]}</p></div>
        <div class="ob-price num"><b>${f != null ? money(f) : '—'}</b><small>${t('ob.floor')}${all || b.chg == null ? '' : ` · ${chgHtml(b.chg)} ${t('h24')}`}</small></div>
      </div>
      <div class="ob-main">
        <div class="box well">
          <div class="box-h"><h3>${t('ob.book')}</h3><span class="legend"><span><i style="background:var(--red)"></i>${t('ob.asks')}</span><span><i style="background:var(--green)"></i>${t('ob.bids')}</span></span></div>
          <div class="ladder">
            ${all ? `<div class="lr h all"><span></span><span class="p">${t('ob.price')}</span><span>${t('ob.qty')}</span></div>` : `<div class="lr h"><span>${t('ob.price')}</span><span>${t('ob.qty')}</span><span>${t('ob.sum')}</span><span class="w">${t('ob.who')}</span></div>`}
            ${asks.length ? asks.map(ask).reverse().join('') : `<p class="lr-none">${t('ob.noAsks')}</p>`}
            <div class="mid num" id="mid"><span>${t('ob.floor')}<b>${f != null ? money(f) : '—'}</b></span><span>${f != null && best != null ? `${t('ob.spread')} ${money(f - best)}` : ''}</span><span>${t('ob.bestBid')}<b class="g">${best != null ? money(best) : '—'}</b></span></div>
            ${bids.length ? bids.map(bid).join('') : `<p class="lr-none">${t('ob.noBids')}</p>`}
          </div>
        </div>
        <div class="box well deals">
          <div class="box-h"><h3>${t(all ? 'all.trades' : 'tr.trades')}</h3><span class="live"><i></i>Live</span></div>
          <div class="mrows">${trades.length ? trades.map((x) => `<div class="tline${x.min === 0 ? ' new' : ''}"><span>${all ? esc(nm(x.id)) : `${esc(who(x.from))} → ${esc(who(x.to))}`}</span><b class="num">${x.q} × ${money(x.p)}</b><span class="num">${ago(x.min)}</span></div>`).join('') : `<p class="fine">${t('tr.noTrades')}</p>`}</div>
        </div>
      </div>
      <div class="box well cbox">
        <div class="box-h"><h3>${t(all ? 'all.chart' : 'ob.chart')}</h3>
          <div class="kv num"><span>${t('ob.last')}<b>${last != null ? money(last) : '—'}</b></span><span>${t('ob.sellers')}<b>${b.sellers}</b></span><span>${t('ob.listed')}<b>${listed(id)}</b></span><span>${t('ob.sold7')}<b>${b.sold}</b></span></div></div>
        <div class="chartbox" id="chartbox"></div>
      </div>`;
    centre();
    drawChart();
  }
  // the junction of selling and buying in the middle of the book's box, always
  function centre() {
    const box = $('#ob .ob-main > .box'),
      mid = $('#mid');
    if (!box || !mid || box.scrollHeight <= box.clientHeight) return;
    box.scrollTop = mid.offsetTop - box.offsetTop - box.clientHeight / 2 + mid.offsetHeight / 2;
  }
  // the sweep's rows lit as its pieces change (no redraw of the book)
  function markSweep() {
    const cap = S.sel === 'all' && S.side === 'buy' && avail('all') ? capOf('all', S.bq) : null;
    $$('#ob .lr.a.all').forEach((el) => el.classList.toggle('sel', cap != null && +el.dataset.p <= cap + 1e-9));
  }
  const stepper = (idv, v, max) =>
    `<div class="step"><button type="button" data-step="-1" aria-label="−">−</button><input id="${idv}" type="number" min="1" max="${max}" value="${v}" inputmode="numeric"><button type="button" data-step="1" aria-label="+">+</button></div>`;
  const coins =
    '<span class="coins"><i style="background:#26a17b">₮</i><i style="background:#627eea">Ξ</i><i style="background:#9945ff">S</i><i style="background:#f7931a">₿</i></span>';
  function renderTrade() {
    const all = S.sel === 'all',
      id = S.sel,
      i = item(id),
      own = all ? 0 : MINE[id] || 0,
      av = avail(id),
      f = floor(id),
      b = BOOK[id];
    if (!b) return;
    const tabs = `<div class="seg full" role="tablist"><button type="button" role="tab" data-side="buy" aria-selected="${S.side === 'buy'}">${t('tr.buy')}</button><button type="button" role="tab" data-side="sell" aria-selected="${S.side === 'sell'}">${t('tr.sell')}</button></div>`;
    const gate = !on()
      ? `<p class="note">${t('tr.off')}</p>`
      : !ME
        ? `<p class="note">${t('tr.signin')}</p><button type="button" class="btn-p wide" data-login>${t('acct.in')}</button>`
        : '';
    let pane;
    if (S.side === 'buy' && all) {
      pane = av
        ? `
        <p class="kicker">${t('sw.h')}</p>
        <div class="fld"><span>${t('tr.qty')}<small>${t('tr.onSale')}: ${av}</small></span>${stepper('bq', clamp(S.bq, 1, av), av)}</div>
        <p class="fine">${t('sw.tip')}</p>
        <div class="mrows"><p class="kicker">${t('sw.levels')}</p><div class="mrows" id="fills"></div></div>
        <p class="kicker">${t('sw.get')}</p><div class="ministash" id="swGet"></div>
        <div class="mrow total"><span>${t('tr.total')}</span><b id="bTot"></b></div>
        <p class="warn" id="bMin" hidden>${t('tr.min')}</p>
        ${gate || `<button type="button" class="btn-p wide" id="buyGo"><svg aria-hidden="true"><use href="#near"/></svg>${t('tr.go')}</button>`}
        <p class="coinsline">${coins}<span>${t('tr.coins')}</span></p>`
        : `<p class="note">${t(listed('all') ? 'tr.onlyYours' : 'ob.noAsks')}</p>`;
    } else if (S.side === 'buy') {
      pane = av
        ? `
        <div class="fld"><span>${t('tr.qty')}<small>${t('tr.onSale')}: ${av}</small></span>${stepper('bq', clamp(S.bq, 1, av), av)}</div>
        <div class="mrows"><p class="kicker">${t('tr.take')}</p><div class="mrows" id="fills"></div></div>
        <div class="mrow total"><span>${t('tr.total')}</span><b id="bTot"></b></div>
        <p class="warn" id="bMin" hidden>${t('tr.min')}</p>
        ${gate || `<button type="button" class="btn-p wide" id="buyGo"><svg aria-hidden="true"><use href="#near"/></svg>${t('tr.go')}</button>`}
        <p class="coinsline">${coins}<span>${t('tr.coins')}</span></p>`
        : `<p class="note">${t(listed(id) ? 'tr.onlyYours' : 'tr.none')}</p>`;
    } else if (!ME || !on()) {
      pane = gate;
    } else if (all) {
      const ids = ITEMS.map((x) => x.id).filter((x) => MINE[x] > 0);
      pane = ids.length
        ? `<p class="kicker">${t('all.sell')}</p><div class="ministash">${ids.map((x) => `<button type="button" data-sell="${x}" title="${esc(nm(x))}">${slot(item(x), '', `<span class="cnt">×${MINE[x]}</span>`)}</button>`).join('')}</div>`
        : `<p class="note">${t('mine.empty')}</p>`;
    } else {
      const sp = S.sp != null ? S.sp : f != null ? f : b.trades[0] ? b.trades[0].p : 1;
      pane = own
        ? `
        <div class="fld"><span>${t('tr.qty')}<small>${t('tr.have')}: ${own}</small></span>${stepper('sq', clamp(S.sq, 1, own), own)}</div>
        <div class="fld"><span>${t('tr.each')}</span><label class="money">$<input id="sp" type="number" step="0.01" min="0.01" value="${(+sp).toFixed(2)}" aria-label="${t('tr.each')}"></label></div>
        <div class="hints">${f != null ? `<button type="button" data-setp="${f}">${t('tr.setFloor')} <b>${usd(f)}</b></button>` : ''}</div>
        <div class="mrows"><div class="mrow"><span>${t('tr.sum')}</span><b id="sSum"></b></div><div class="mrow"><span>${t('tr.fee')}</span><b id="sFee"></b></div></div>
        <div class="mrow total"><span>${t('tr.get')}</span><b id="sGet"></b></div>
        <button type="button" class="btn-p wide" id="sellGo">${t('tr.list')}</button>
        <p class="fine">${t('tr.payout')}</p>`
        : `<p class="note"><b>${t('tr.noOwn')}</b> ${FROM[i.kind][lang]}.</p>`;
    }
    $('#trade').innerHTML = tabs + pane;
    updTrade();
  }
  function updTrade() {
    const id = S.sel;
    const q = $('#bq');
    if (q) {
      const n = clamp(Math.round(+q.value) || 1, 1, avail(id));
      S.bq = n;
      const r = fill(id, n);
      $('#bTot').textContent = money(r.sum);
      if (id === 'all') {
        // (by price: the pieces at each price; what comes: each item and how many)
        const byP = [],
          got = {};
        r.used.forEach(([k, p, x]) => {
          const l = byP[byP.length - 1];
          if (l && l.p === p) l.k += k;
          else byP.push({ p, k });
          got[x] = (got[x] || 0) + k;
        });
        $('#fills').innerHTML = byP
          .map(
            (l) =>
              `<div class="mrow"><span class="num">${l.k} × ${money(l.p)}</span><b class="num">${money(l.k * l.p)}</b></div>`,
          )
          .join('');
        $('#swGet').innerHTML = Object.keys(got)
          .map(
            (x) =>
              `<span title="${esc(nm(x))} ×${got[x]}">${slot(item(x), '', `<span class="cnt">×${got[x]}</span>`)}</span>`,
          )
          .join('');
        markSweep();
      } else
        $('#fills').innerHTML = r.used
          .map(
            ([k, p]) =>
              `<div class="mrow"><span class="num fl">${k} × ${money(p)}</span><b class="num">${money(k * p)}</b></div>`,
          )
          .join('');
      const low = r.sum < MIN();
      $('#bMin').hidden = !low;
      if ($('#buyGo')) $('#buyGo').disabled = low;
    }
    const sq = $('#sq');
    if (sq) {
      const own = MINE[id] || 0,
        n = clamp(Math.round(+sq.value) || 1, 1, own),
        p = +$('#sp').value || 0;
      S.sq = n;
      S.sp = p;
      $('#sSum').textContent = money(p * n);
      $('#sFee').textContent = '−' + money(p * n * FEE());
      $('#sGet').textContent = money(p * n * (1 - FEE()));
      $('#sellGo').disabled = !(p >= 0.01);
    }
  }
  const OST = (o) => t('os.' + o.st);
  // (an order of the book of all items brings several items)
  const oPic = (it) => (item(it) ? slot(item(it)) : tile());
  const oName = (it) => (item(it) ? nm(it) : t('all.h'));
  function renderMine() {
    $('#signin').hidden = !!ME;
    $$('#vMine .two').forEach((el) => (el.hidden = !ME));
    if (!ME) return;
    const ids = Object.keys(MINE).filter((id) => MINE[id] > 0 && item(id));
    $('#stash').innerHTML = ids.length
      ? ids
          .map(
            (id) =>
              `<button type="button" class="sitem" data-sell="${id}">${slot(item(id), '', `<span class="cnt">×${MINE[id]}</span>`)}<span>${esc(nm(id))}</span></button>`,
          )
          .join('')
      : `<p class="fine">${t('mine.empty')}</p>`;
    const sum = MY.lots.reduce((s, l) => s + (l.p / 100) * l.n, 0);
    $('#lotsSum').textContent = MY.lots.length ? `${t('mine.lotsSum')} ${money(sum)}` : '';
    $('#myLots').innerHTML = MY.lots.length
      ? MY.lots
          .map(
            (l) =>
              `<div class="lot">${slot(item(l.it))}<div><b><a class="lk" href="${url('lot/' + l.id)}" data-lot="${l.id}">${esc(nm(l.it))} ×${l.n}</a></b><span class="num"><em>${money(l.p / 100)}</em> ${t('mine.each')}${l.n > l.free ? ` · ${l.n - l.free} ${t('mine.held')}` : ''}</span></div><button type="button" class="btn sm ghost" data-share="lot/${l.id}">${t('lot.link')}</button><button type="button" class="btn sm ghost" data-cancel="${l.id}"${l.free ? '' : ' disabled'}>${t('mine.cancel')}</button></div>`,
          )
          .join('') + `<button type="button" class="btn sm ghost" data-share="@${esc(ME)}">${t('lot.myAll')}</button>`
      : `<p class="fine">${t('mine.noLots')}</p>`;
    $('#myOrders').innerHTML = MY.orders.length
      ? MY.orders
          .map(
            (o) =>
              `<div class="lot">${oPic(o.it)}<div><b>${esc(oName(o.it))} ×${o.n}</b><span class="num"><em>${money(o.cents / 100)}</em> · ${OST(o)}${o.st === 'wait' && o.dep ? ` · ${esc(o.dep.inF || '')} ${esc(o.sym)}` : ''}</span></div>${o.st === 'wait' ? `<button type="button" class="btn sm" data-resume="${o.id}">${t('pay.go')}</button>` : ''}</div>`,
          )
          .join('')
      : `<p class="fine">${t('mine.noOrders')}</p>`;
    $('#myPays').innerHTML = MY.pays.length
      ? MY.pays
          .map(
            (p) =>
              `<div class="lot"><div class="tile"><svg aria-hidden="true"><use href="#st-fee"/></svg></div><div><b class="num">${(p.micro / 1e6).toFixed(2)} USDC</b><span>${t('pw.' + p.why)} · ${t('ps.' + p.st)}</span></div>${p.tx ? `<a class="btn sm ghost" href="https://nearblocks.io/txns/${encodeURIComponent(p.tx)}" target="_blank" rel="noopener">tx</a>` : ''}</div>`,
          )
          .join('')
      : `<p class="fine">${t('mine.noPays')}</p>`;
  }
  function renderActivity() {
    const acc = (a) =>
      a ? `<span class="acc${a === ME ? ' me' : ''}">${esc(who(a))}</span>` : '<span class="acc">—</span>';
    $('#actRows').innerHTML = ACT.length
      ? ACT.map((a) => {
          const i = item(a.id);
          return `<tr>
      <td><span class="ev ${a.ev}"><i></i>${t('ev.' + a.ev)}</span></td>
      <td><div class="it">${slot(i)}<span>${esc(nm(a.id))}</span></div></td>
      <td class="pr">${money(a.p)}</td><td>${a.q}</td><td>${acc(a.from)}</td><td>${acc(a.to)}</td><td>${ago(a.min)}</td>
      <td class="tx"><a href="https://nearblocks.io/address/items.meowdivision.near" target="_blank" rel="noopener" aria-label="tx"><svg><use href="#ext"/></svg></a></td></tr>`;
        }).join('')
      : `<tr><td colspan="8" class="fine">${t('act.none')}</td></tr>`;
  }
  function renderAll() {
    if (!BOOK.all) build();
    renderStats();
    renderGrid();
    renderFeed();
    renderList();
    // (the trade box is redrawn only when the player isn't typing in it)
    const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('#trade');
    renderBook();
    if (!typing) renderTrade();
    renderMine();
    renderActivity();
  }

  // ---------- navigation ----------
  function setView(v) {
    S.view = v;
    $$('[data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    $('#vMarket').hidden = v !== 'market';
    $('#vMine').hidden = v !== 'mine';
    $('#vActivity').hidden = v !== 'activity';
    $('#modeSeg').hidden = v !== 'market';
  }
  function setMode(m) {
    S.mode = m;
    $$('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    $('#modeShop').hidden = m !== 'shop';
    $('#modeBook').hidden = m !== 'book';
  }
  function selectItem(id, side, scroll) {
    S.sel = id;
    if (side) S.side = side;
    S.bq = minQ(id);
    S.sq = 1;
    S.sp = null;
    setView('market');
    setMode('book');
    renderList();
    renderBook();
    renderTrade();
    const row = $(`#ilist [data-sel="${id}"]`),
      box = $('#ilist');
    if (row && box) {
      const r = row.getBoundingClientRect(),
        b = box.getBoundingClientRect();
      if (r.top < b.top || r.bottom > b.bottom) box.scrollTop += r.top - b.top - 40;
      if (r.left < b.left || r.right > b.right) box.scrollLeft += r.left - b.left - 40;
    }
    if (scroll) $('#modeBook').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function takeRow(k) {
    const id = S.sel,
      b = BOOK[id];
    if (id === 'all') {
      const n = levels(b.asks)
        .slice(0, k + 1)
        .reduce((a, x) => a + x.q - x.mine, 0);
      if (!n) return toast(t('ob.yours'));
      S.side = 'buy';
      S.bq = n;
      renderTrade();
      return;
    }
    const a = b.asks[k];
    if (a.who === ME) {
      toast(t('ob.yours'));
      return;
    }
    S.side = 'buy';
    S.bq = b.asks
      .slice(0, k + 1)
      .filter((x) => x.who !== ME)
      .reduce((s, x) => s + x.q, 0);
    renderTrade();
  }
  function refilter() {
    renderGrid();
    renderList();
  }

  // ---------- addresses: /market, /market/lot/<id>, /market/@<account>, /market/<item>, /market/my, /market/activity ----
  // (in the game's frame the address stays as it is; the links copied are the site's)
  let R = '', // the route shown
    lotPushed = false; // (the lot's window came with an address of its own: closing it goes back)
  const routeOf = (path) => {
    const m = /^\/market\/(.+)$/.exec(path);
    return m ? decodeURIComponent(m[1]).replace(/\/+$/, '') : '';
  };
  function go(r, replace) {
    if (!EMBED) {
      const p = url(r);
      if (location.pathname !== p) history[replace ? 'replaceState' : 'pushState'](null, '', p);
    }
    route(r);
  }
  function route(r) {
    R = r;
    const lot = /^lot\/([\w-]{1,40})$/.exec(r),
      seller = /^@([a-z0-9._-]{2,64})$/.exec(r);
    if (!lot && S.lot) close(true);
    if (lot) {
      if (MK) openLot(lot[1]); // (else the market's first answer opens it)
      return;
    }
    S.it = item(r) ? r : null;
    S.seller = seller ? seller[1] : null;
    setView(r === 'my' ? 'mine' : r === 'activity' ? 'activity' : 'market');
    if (S.it && S.mode === 'book') selectItem(S.it);
    document.title = (S.it ? nm(S.it) + ' · ' : S.seller ? short(S.seller) + ' · ' : '') + t('title');
    renderGrid();
  }
  addEventListener('popstate', () => route(routeOf(location.pathname)));
  // a link to copy: a lot, an item's lots, a seller's lots
  async function share(r) {
    const link = location.origin + url(r);
    let ok = false;
    try {
      await navigator.clipboard.writeText(link);
      ok = true;
    } catch (e) {}
    if (!ok)
      try {
        const ta = document.createElement('textarea');
        ta.value = link;
        document.body.append(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch (e) {}
    toast(ok ? `${t('lot.copied')}: ${link}` : link);
  }
  const winHead = (title) =>
    `<div class="win-h"><div><h2>${title}</h2></div><button type="button" class="x" data-close aria-label="close"><svg><use href="#close"/></svg></button></div>`;
  // from a window to another address (a seller's or an item's lots)
  function leave(r) {
    payCtx = null;
    S.lot = null;
    lotPushed = false;
    layer.innerHTML = '';
    layer.onclick = layer.oninput = layer.onchange = null;
    go(r);
  }
  // one lot over the shelf: the item, the seller, the price a piece, how many to take; its link
  function openLot(id) {
    const l = LOTS.find((x) => x.id === id);
    S.lot = id;
    payCtx = null;
    if (!l || !l.n) {
      document.title = t('title');
      openWin(
        winHead(l ? esc(nm(l.it)) : t('lot.goneH')) +
          `<div class="win-b">${l ? `<div class="hold">${slot(item(l.it))}<div><b>${t('lot.heldH')}</b><span>${t('lot.held')}</span></div></div>` : `<p class="note">${t('lot.gone')}</p>`}<button type="button" class="btn-p wide" data-close>${t('lot.all')}</button></div>`,
      );
      layer.onclick = (e) => e.target.closest('[data-close]') && close();
      return;
    }
    const i = item(l.it),
      own = l.s === ME,
      b = BOOK[l.it],
      f = floor(l.it),
      last = b && b.trades[0] ? b.trades[0].p : null,
      lo = lotMin(l);
    let n = lo;
    document.title = `${nm(l.it)} ×${l.n} · ${usd(l.p)} · ${t('title')}`;
    const low = () => n * l.p < MIN() - 1e-9;
    const body = () => `
      <div class="lotw">
        ${slot(i, 'big', `<span class="cnt">×${l.n}</span>`)}
        <div class="lotw-i">
          <div class="tags"><span class="tag rar r${i.r}">${t('rar.' + i.r)}</span><span class="tag">${t('kind.' + i.kind)}</span></div>
          <p class="from">${FROM[i.kind][lang]}</p>
          <div class="mrows">
            <div class="mrow"><span>${t('lot.seller')}</span><a class="lk" href="${url('@' + l.s)}" data-go="@${esc(l.s)}">${own ? t('lot.you') : esc(short(l.s))}</a></div>
            <div class="mrow"><span>${t('tr.each')}</span><b class="num gold">${money(l.p)}</b></div>
            <div class="mrow"><span>${t('lot.floor')}</span><b class="num">${f != null ? money(f) : '—'}</b></div>
            <div class="mrow"><span>${t('lot.last')}</span><b class="num">${last != null ? money(last) : '—'}</b></div>
          </div>
        </div>
      </div>
      ${
        own
          ? `<p class="note">${t('lot.mine')}</p><button type="button" class="btn wide" data-cancel="${l.id}"${l.n ? '' : ' disabled'}>${t('mine.cancel')}</button>`
          : `<div class="fld"><span>${t('tr.qty')}<small>${t('tr.onSale')}: ${l.n}</small></span><div class="pq"><button type="button" data-lq="-1" aria-label="−"${n <= lo ? ' disabled' : ''}>−</button><b class="num">${n} ${t('pcs')}</b><button type="button" data-lq="1" aria-label="+"${n >= l.n ? ' disabled' : ''}>+</button>${l.n > lo ? `<button type="button" class="all" data-lq="max">${t('lot.allN')} ${l.n}</button>` : ''}</div></div>
        <div class="mrow total"><span>${t('tr.total')}</span><b class="num">${money(n * l.p)}</b></div>
        ${low() ? `<p class="warn">${t(l.n * l.p < MIN() - 1e-9 ? 'lot.under' : 'tr.min')}</p>` : ''}
        ${on() ? `<button type="button" class="btn-p wide" id="lotBuy"${low() ? ' disabled' : ''}><svg aria-hidden="true"><use href="#near"/></svg>${ME ? t('tr.go') : t('acct.in')}</button>` : `<p class="note">${t('tr.off')}</p>`}
        <p class="coinsline">${coins}<span>${t('tr.coins')}</span></p>`
      }
      <div class="lotw-f">
        <button type="button" class="btn sm ghost" data-share="lot/${l.id}">${t('lot.share')}</button>
        <a class="lk" href="${url(l.it)}" data-go="${l.it}">${t('lot.allOf')} ${esc(nm(l.it))}</a>
      </div>`;
    openWin(winHead(esc(nm(l.it))) + '<div class="win-b"></div>');
    const paint = () => ($('.win-b', layer).innerHTML = body());
    paint();
    layer.oninput = layer.onchange = null;
    layer.onclick = async (e) => {
      const g = (x) => e.target.closest(x);
      let el;
      if ((el = g('[data-lq]'))) {
        n = el.dataset.lq === 'max' ? l.n : clamp(n + +el.dataset.lq, lo, l.n);
        paint();
        return;
      }
      if (g('#lotBuy')) {
        if (!ME) return connect();
        openPay(l.it, n, l);
        return;
      }
      if ((el = g('[data-share]'))) {
        share(el.dataset.share);
        return;
      }
      if ((el = g('[data-go]'))) {
        if (modded(e)) return;
        e.preventDefault();
        leave(el.dataset.go);
        return;
      }
      if ((el = g('[data-cancel]'))) {
        el.disabled = true;
        try {
          await api('POST', '/market/cancel', { lot: l.id });
          tellGame('saved');
          toast(t('toast.cancel'));
          close();
        } catch (er) {
          toast(errText(er));
          el.disabled = false;
        }
        return;
      }
      if (g('[data-close]')) close();
    };
  }
  // putting an item up: how many, the price a piece, what comes back after the fee; then the lot's link to send
  function openSell(id) {
    if (!ME) return connect();
    if (!on()) return toast(t('err.payments off'));
    const i = item(id),
      own = MINE[id] || 0;
    if (!i || !own) return toast(t('err.not enough'));
    const f = floor(id),
      b = BOOK[id],
      last = b && b.trades[0] ? b.trades[0].p : null;
    let q = 1,
      p = f != null ? f : last,
      busy = false,
      err = '',
      done = null;
    payCtx = null;
    const sums = () => {
      const el = $('#sellSum', layer);
      if (!el) return;
      const v = (p || 0) * q;
      el.innerHTML = `<div class="mrow"><span>${t('tr.sum')}</span><b class="num">${money(v)}</b></div><div class="mrow"><span>${t('tr.fee')}</span><b class="num">−${money(v * FEE())}</b></div><div class="mrow total"><span>${t('tr.get')}</span><b class="num">${money(v * (1 - FEE()))}</b></div>`;
      $('#sellGo2', layer).disabled = busy || !(p >= 0.01);
    };
    const body = () =>
      done
        ? `<div class="banner">${slot(i, 'big')}<small>${t('sell.doneK')}</small><h2>${t('toast.listed')}</h2><p class="num">${esc(nm(id))} ×${done.n} · ${usd(done.p / 100)} ${t('mine.each')}</p><p>${t('sell.doneSub')}</p></div>
        <div class="addr">${esc(location.origin + url('lot/' + done.id))}</div>
        <button type="button" class="btn-p wide" data-share="lot/${done.id}">${t('lot.share')}</button>
        <button type="button" class="btn wide" data-golot="${done.id}">${t('sell.open')}</button>`
        : `<div class="payitem well">${slot(i)}<div><b>${esc(nm(id))}</b><span>${t('tr.have')}: ${own}</span></div></div>
        <div class="fld"><span>${t('tr.qty')}</span><div class="pq"><button type="button" data-sq="-1" aria-label="−"${q <= 1 ? ' disabled' : ''}>−</button><b class="num">${q} ${t('pcs')}</b><button type="button" data-sq="1" aria-label="+"${q >= own ? ' disabled' : ''}>+</button>${own > 1 ? `<button type="button" class="all" data-sq="max">${t('lot.allN')} ${own}</button>` : ''}</div></div>
        <div class="fld"><span>${t('tr.each')}</span><label class="money">$<input id="sp2" type="number" step="0.01" min="0.01" inputmode="decimal" value="${p != null ? (+p).toFixed(2) : ''}" placeholder="0.00" aria-label="${t('tr.each')}"></label></div>
        ${f != null ? `<div class="hints"><button type="button" data-setp="${f}">${t('tr.setFloor')} <b>${usd(f)}</b></button></div>` : ''}
        <div class="mrows" id="sellSum"></div>
        ${err ? `<p class="warn">${esc(err)}</p>` : ''}
        <button type="button" class="btn-p wide" id="sellGo2">${t('tr.list')}</button>
        <p class="fine">${t('tr.payout')}</p>`;
    const paint = () => {
      $('.win-b', layer).innerHTML = body();
      sums();
    };
    openWin(winHead(`${t('tr.sell')}: ${esc(nm(id))}`) + '<div class="win-b"></div>');
    paint();
    layer.onchange = null;
    layer.oninput = (e) => {
      if (e.target.id === 'sp2') {
        p = +e.target.value || 0;
        sums();
      }
    };
    layer.onclick = async (e) => {
      const g = (x) => e.target.closest(x);
      let el;
      if ((el = g('[data-sq]'))) {
        q = el.dataset.sq === 'max' ? own : clamp(q + +el.dataset.sq, 1, own);
        paint();
        return;
      }
      if ((el = g('[data-setp]'))) {
        p = +el.dataset.setp;
        paint();
        return;
      }
      if (g('#sellGo2')) {
        if (!(p >= 0.01)) return;
        busy = true;
        err = '';
        sums();
        try {
          const r = await api('POST', '/market/list', { id, n: q, price: Math.round(p * 100) });
          MY = r.mine || MY;
          done = r.lot;
          tellGame('saved');
          await refresh();
        } catch (er) {
          err = errText(er);
        }
        busy = false;
        paint();
        return;
      }
      if ((el = g('[data-share]'))) {
        share(el.dataset.share);
        return;
      }
      if ((el = g('[data-golot]'))) {
        layer.innerHTML = '';
        S.back = R;
        lotPushed = !EMBED;
        go('lot/' + el.dataset.golot);
        return;
      }
      if (g('[data-close]')) close();
    };
  }

  // ---------- overlays ----------
  const layer = $('#layer');
  let lastFocus = null,
    timerId = 0,
    pollId = 0,
    payCtx = null;
  function openWin(html) {
    lastFocus = document.activeElement;
    layer.innerHTML = `<div class="scrim" data-close></div><div class="win" role="dialog" aria-modal="true">${html}</div>`;
    const first = layer.querySelector('.win button:not(.x), .win input');
    (first || layer.querySelector('.x')).focus();
  }
  // fromRoute: the address changed first (the browser's back button), so it is not touched here
  function close(fromRoute) {
    clearInterval(timerId);
    clearTimeout(pollId);
    // an order with no payment on its way: given up, its lots free again for others
    if (
      payCtx &&
      payCtx.order &&
      payCtx.order.st === 'wait' &&
      !payCtx.sent &&
      (!payCtx.order.seen || payCtx.order.seen === 'PENDING_DEPOSIT')
    )
      api('POST', '/market/drop', { id: payCtx.order.id }).catch(() => {});
    payCtx = null;
    layer.innerHTML = '';
    layer.onclick = null;
    layer.oninput = null;
    layer.onchange = null;
    if (S.lot) {
      S.lot = null;
      if (fromRoute !== true) {
        if (lotPushed && !EMBED) history.back();
        else go(S.back || '', true);
      }
      lotPushed = false;
    }
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    refresh();
  }
  let toastId;
  function toast(msg, ms = 3200) {
    let el = $('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.append(el);
    }
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastId);
    toastId = setTimeout(() => (el.hidden = true), ms);
  }
  function drawQR(cv, text) {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    const n = q.getModuleCount(),
      m = 2,
      c = cv.getContext('2d');
    cv.width = cv.height = n + m * 2;
    c.fillStyle = '#f6f2ea';
    c.fillRect(0, 0, n + m * 2, n + m * 2);
    c.fillStyle = '#1c1d19';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) c.fillRect(x + m, y + m, 1, 1);
  }
  const tokIcon = (k) =>
    `<span class="ti" style="background:${k.c || '#3a3d35'};${k.near ? 'box-shadow:inset 0 0 0 1.5px #ffad3b' : ''}">${k.near ? '<svg width="16" height="16" style="color:#ffad3b"><use href="#near"/></svg>' : esc((k.s || '?')[0])}${k.n ? `<small style="background:${k.nc}">${k.n}</small>` : ''}</span>`;
  const fmtAmt = (v) =>
    v >= 100 ? v.toFixed(2) : v >= 1 ? v.toFixed(4) : v >= 0.001 ? v.toFixed(6) : v.toPrecision(3);
  // the coins for tiles: 1Click's list joined with the tiles' looks
  function tileCoins() {
    return TILES.map(([a, c, net, n, nc]) => {
      const x = TOK.find((y) => y.a === a);
      return x ? { ...x, c, net, n, nc } : null;
    }).filter(Boolean);
  }
  const otherCoins = () =>
    TOK.filter((x) => x.c !== 'near' && !x.a.startsWith('1cs_')).sort(
      (a, b) => a.s.localeCompare(b.s) || a.c.localeCompare(b.c),
    );

  // ---------- the payment window ----------
  // lot: that one lot at its price (a card's Buy, a lot's window); none: the cheapest pieces (the order book)
  async function openPay(id, n, lot) {
    if (!ME) return connect();
    if (!on()) return toast(t('err.payments off'));
    if (!TOK.length) {
      try {
        TOK = (await api('GET', '/market/tokens')).tokens || [];
      } catch (e) {}
    }
    const sumOf = (k) => (lot ? Math.round(k * lot.p * 100) / 100 : fill(id, k).sum);
    let total = sumOf(n);
    const i = item(id) || null;
    const lo = lot ? lotMin(lot) : Math.min(minQ(id), n),
      hi = lot ? lot.n : avail(id);
    const P = (payCtx = {
      how: 'intents',
      tok: tileCoins()[0] || otherCoins()[0],
      order: null,
      busy: false,
      err: '',
      bal: null,
      w: null,
      sent: false,
    });
    const head = `<div class="win-h"><div><span class="nametab"><svg aria-hidden="true"><use href="#near"/></svg>NEAR Intents</span><h2>${t('pay.title')}</h2></div><button type="button" class="x" data-close aria-label="close"><svg><use href="#close"/></svg></button></div>`;
    const minOf = (k) => (k && k.min ? k.min / 100 : 0);
    const enough = (k) => P.how !== 'wallet' || (P.bal && P.bal[k.a] >= (total * 1.02) / (k.near ? nearUsd() : 1));
    const approx = (k) => fmtAmt((total * 1.015) / (k.usd || 1));
    const body = () => {
      const o = P.order,
        list = P.how === 'intents' ? tileCoins() : WALLET;
      const coinBtn = (k, j) => {
        const low = P.how === 'intents' ? minOf(k) > total : !enough(k);
        const sub =
          P.how === 'intents'
            ? minOf(k) > total
              ? `${t('pay.from$')} $${minOf(k)}`
              : `${k.s} · ${k.net || NETS[k.c] || k.c}`
            : P.bal
              ? enough(k)
                ? `${k.s} · ${t('pay.bal')} ${fmtAmt(P.bal[k.a] || 0)}`
                : `${k.s} · ${t('pay.low')}`
              : k.s;
        const amt = P.how === 'intents' ? approx(k) : fmtAmt((total * 1.015) / (k.near ? nearUsd() : 1));
        return `<button type="button" class="tok" data-tok="${j}" aria-pressed="${P.tok && k.a === P.tok.a}"${low || o ? ' disabled' : ''}>${tokIcon(k)}<div><b class="num">≈${amt}</b><span>${esc(sub)}</span></div></button>`;
      };
      const others =
        P.how === 'intents'
          ? `<label class="field"><span>${t('pay.other')}</span><select id="other"${o ? ' disabled' : ''}><option value="">—</option>${otherCoins()
              .map(
                (k) =>
                  `<option value="${esc(k.a)}"${P.tok && P.tok.a === k.a && !tileCoins().some((x) => x.a === k.a) ? ' selected' : ''}${minOf(k) > total ? ' disabled' : ''}>${esc(k.s)} · ${esc(NETS[k.c] || k.c)}</option>`,
              )
              .join('')}</select></label>`
          : '';
      // once the money is on its way: only what happens now
      const going = o && o.st === 'wait' && (P.sent || (o.seen && o.seen !== 'PENDING_DEPOSIT'));
      if (going)
        return `
        <div class="payitem well">${i ? slot(i) : tile()}<div><b>${esc(i ? nm(id) : t('all.h'))}</b><span>${o.n} ${t('pcs')}</span></div><span class="sum num">${money(o.cents / 100)}</span></div>
        <div class="hold go"><i class="spin" aria-hidden="true"></i><div><b>${o.seen && o.seen !== 'PENDING_DEPOSIT' ? t('pay.goingH') : t('pay.sentH')}</b><span>${t('pay.going')}</span></div></div>
        ${steps(o)}
        <p class="fine">${t('pay.goingFine')} <span class="timer num"><svg aria-hidden="true"><use href="#clock"/></svg><span id="timer"></span></span></p>
        <button type="button" class="btn wide" data-close>${t('pay.bg')}</button>`;
      const held =
        o && o.st === 'wait'
          ? `<div class="hold"><svg aria-hidden="true"><use href="#clock"/></svg><div><b>${t('pay.holdH')} <span class="num" id="timer"></span></b><span>${t('pay.hold')}</span></div></div>`
          : '';
      let tail;
      if (P.how === 'wallet') {
        tail = !P.w
          ? `<button type="button" class="btn-p wide" id="wconnect"><svg aria-hidden="true"><use href="#wallet"/></svg>${t('pay.connect')}</button>`
          : `<div class="mrow"><span>${t('pay.from')} ${esc(short(ME))}</span><b class="num">${o && o.dep ? esc(o.dep.inF) : '≈' + fmtAmt((total * 1.015) / (P.tok.near ? nearUsd() : 1))} ${esc(P.tok.s)}</b></div>
            <p class="fine">${t('pay.walletHint')}</p>
            ${held}
            <button type="button" class="btn-p wide" id="wpay"${enough(P.tok) && !P.busy && !(o && o.st !== 'wait') && !P.sent ? '' : ' disabled'}><svg aria-hidden="true"><use href="#wallet"/></svg>${P.busy ? (o ? t('pay.confirm') : t('pay.making')) : `${t('pay.go')} ${esc(P.tok.s)}`}</button>`;
      } else if (!o) {
        tail = `<label class="field"><span>${t('pay.refund')}</span><input id="refund" autocomplete="off" spellcheck="false" value="${esc(P.refund || '')}" placeholder="${t('pay.refundPh')} ${esc(P.tok ? P.tok.net || NETS[P.tok.c] || P.tok.c : '')}"></label>
          <p class="fine">${t('pay.refundDef')}</p>
          <button type="button" class="btn-p wide" id="getAddr"${P.busy || !P.tok ? ' disabled' : ''}><svg aria-hidden="true"><use href="#near"/></svg>${P.busy ? t('pay.getting') : t('pay.get')}</button>`;
      } else {
        tail = `<div class="deposit"><canvas id="qr" width="29" height="29" aria-label="QR"></canvas><div style="display:grid;gap:8px">
            <div class="mrow"><span>${t('pay.send')}</span><b class="num">${esc(o.dep.inF)} ${esc(o.sym)}</b></div>
            <div class="addr" id="addr">${esc(o.dep.addr)}</div>
            ${o.dep.memo ? `<div class="mrow"><span>${t('pay.memo')}</span><b class="num">${esc(o.dep.memo)}</b></div>` : ''}
            <div class="fld"><button type="button" class="btn sm ghost" id="copy">${t('pay.copy')}</button></div></div></div>
          <p class="fine">${t('pay.any')} ${esc(NETS[o.chain] || o.chain)}. ${t('pay.any2')}</p>
          ${held}
          ${steps(o)}`;
      }
      return `
        <div class="payitem well">${i ? slot(i) : tile()}<div><b>${esc(i ? nm(id) : t('all.h'))}</b>${o ? `<span>${o.n} ${t('pcs')}</span>` : `<div class="pq"><button type="button" data-pq="-1" aria-label="−"${n <= lo ? ' disabled' : ''}>−</button><b class="num">${n} ${t('pcs')}</b><button type="button" data-pq="1" aria-label="+"${n >= hi ? ' disabled' : ''}>+</button><span>${t('pay.min')}</span></div>`}</div><span class="sum num">${money(total)}</span></div>
        <div class="howbox">
          <h3>${t('pay.how')}</h3>
          <div class="how" role="radiogroup" aria-label="${t('pay.how')}">
            <button type="button" class="howc" role="radio" data-how="intents" aria-checked="${P.how === 'intents'}"${o ? ' disabled' : ''}><i class="hi"><svg aria-hidden="true"><use href="#near"/></svg></i><span><b>${t('pay.intents')}</b><small>${t('pay.intentsSub')}</small></span><em class="dot"></em></button>
            <button type="button" class="howc" role="radio" data-how="wallet" aria-checked="${P.how === 'wallet'}"${o ? ' disabled' : ''}><i class="hi"><svg aria-hidden="true"><use href="#wallet"/></svg></i><span><b>${t('pay.wallet')}</b><small>${esc(short(ME))} · NEAR, USDC, USDT</small></span><em class="dot"></em></button>
          </div>
        </div>
        <div class="box-h"><h3>${t('pay.with')}</h3><span>${P.how === 'intents' ? t('pay.more') : t('pay.onNear')}</span></div>
        <div class="tokens${P.how === 'wallet' ? ' w' : ''}">${list.map(coinBtn).join('')}</div>
        ${others}
        ${P.err ? `<p class="warn">${esc(P.err)}</p>` : ''}
        ${tail}
        <p class="fine">${t('pay.fine')}</p>`;
    };
    const steps = (o) => {
      const k = !o ? 0 : o.st === 'done' ? 3 : o.seen && o.seen !== 'PENDING_DEPOSIT' ? 2 : 1;
      const cls = (j) => (j < k ? 'st done' : j === k ? 'st now' : 'st');
      const s = P.tok ? P.tok.s : '';
      return `<div class="steps">
        <div class="${cls(1)}"><i>${k > 1 ? '✓' : 1}</i><div><b>${t('pay.s1')}</b><span>${esc(s)} · ${esc(o ? NETS[o.chain] || o.chain : '')}</span></div></div>
        <div class="${cls(2)}"><i>${k > 2 ? '✓' : 2}</i><div><b>${t('pay.s2')} ${esc(s)} ${t('pay.s2to')}</b><span>${k === 2 ? t('pay.seen') : t('pay.s2s')}</span></div></div>
        <div class="${cls(3)}"><i>${k > 3 ? '✓' : 3}</i><div><b>${t('pay.s3')}</b><span>${t('pay.s3s')}</span></div></div></div>`;
    };
    const paint = () => {
      if (!payCtx) return;
      const o = P.order;
      if (o && o.st === 'done') {
        tellGame('saved');
        clearInterval(timerId);
        clearTimeout(pollId);
        $('.win-b', layer).innerHTML =
          `<div class="banner">${i ? slot(i, 'big') : tile()}<small>${t('pay.doneK')}</small><h2>${t('pay.done')}</h2><p class="num">${esc(i ? nm(id) : t('all.h'))} ×${o.n}</p><p>${t('pay.doneSub')}</p></div><button type="button" class="btn-p wide" data-close>${t('pay.close')}</button>`;
        return;
      }
      if (o && (o.st === 'gone' || o.st === 'dropped' || o.st === 'refunded' || o.st === 'failed' || o.st === 'back'))
        P.err = o.st === 'refunded' ? t('pay.refundedM') : t('pay.late');
      $('.win-b', layer).innerHTML = body();
      const cv = $('#qr');
      if (cv && o && o.dep) drawQR(cv, o.dep.addr);
      clearInterval(timerId);
      const tm = $('#timer');
      if (tm && o) {
        if (P.sent && !P.sentAt) P.sentAt = Date.now();
        const goingNow = !!$('.hold.go', layer);
        const tick = () => {
          const left = goingNow
            ? Math.round((Date.now() - (P.sentAt || o.at)) / 1000)
            : Math.max(0, Math.round((o.until - Date.now()) / 1000));
          tm.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
        };
        tick();
        timerId = setInterval(tick, 1000);
      }
    };
    // the order's state, every few seconds, until it is done or over
    const follow = () => {
      clearTimeout(pollId);
      pollId = setTimeout(async () => {
        if (!payCtx || !P.order) return;
        try {
          const r = await api('GET', '/market/order?id=' + encodeURIComponent(P.order.id));
          P.order = r.order;
        } catch (e) {}
        paint();
        if (P.order && (P.order.st === 'wait' || P.order.st === 'new')) follow();
        else refresh();
      }, 4000);
    };
    const quote = async () => {
      P.busy = true;
      P.err = '';
      paint();
      try {
        const r = await api('POST', '/market/quote', {
          id,
          n,
          lot: lot ? lot.id : undefined,
          max: id === 'all' ? Math.round(capOf('all', n) * 100) : undefined,
          asset: P.tok.a,
          refundTo: P.how === 'intents' ? P.refund || undefined : undefined,
        });
        P.order = r.order;
        MY = r.mine || MY;
        follow();
      } catch (e) {
        P.err = errText(e);
        if (e.message === 'not enough on sale' || e.message === 'no such lot') await refresh();
      }
      P.busy = false;
      paint();
      return P.order;
    };
    // paying from the NEAR wallet: one transaction to the coin's contract (storage for the deposit address, NEAR wrapped
    // first, then the transfer), its hash told to 1Click
    const walletPay = async () => {
      if (!P.order && !(await quote())) return;
      const o = P.order,
        k = P.tok,
        amount = o.dep.in;
      const act = (methodName, args, deposit) => ({
        type: 'FunctionCall',
        params: { methodName, args, gas: '30000000000000', deposit },
      });
      const actions = [
        act('storage_deposit', { account_id: o.dep.addr, registration_only: true }, '1250000000000000000000'),
      ];
      if (k.near) actions.push(act('near_deposit', {}, amount));
      actions.push(act('ft_transfer', { receiver_id: o.dep.addr, amount, memo: o.dep.memo || undefined }, '1'));
      P.busy = true;
      paint();
      try {
        const r = await P.w.signAndSendTransaction({ receiverId: k.ct, actions });
        const hash =
          (r && r.transaction && r.transaction.hash) ||
          (r && r.transaction_outcome && r.transaction_outcome.id) ||
          (Array.isArray(r) && r[0] && r[0].transaction && r[0].transaction.hash);
        P.sent = true;
        P.sentAt = Date.now();
        if (hash) api('POST', '/market/submit', { id: o.id, tx: hash }).catch(() => {});
      } catch (e) {
        if (!/reject|cancel|closed|user/i.test(String(e && e.message))) P.err = errText(e);
      }
      P.busy = false;
      paint();
      follow();
    };
    P.repaint = paint;
    openWin(head + '<div class="win-b"></div>');
    paint();
    layer.oninput = (e) => {
      if (e.target.id === 'refund') P.refund = e.target.value.trim();
    };
    layer.onchange = (e) => {
      if (e.target.id === 'other' && e.target.value) {
        P.tok = TOK.find((x) => x.a === e.target.value) || P.tok;
        paint();
      }
    };
    layer.onclick = async (e) => {
      const g = (s) => e.target.closest(s);
      let el;
      if ((el = g('[data-pq]')) && !P.order) {
        n = clamp(n + +el.dataset.pq, lo, hi);
        total = sumOf(n);
        paint();
        return;
      }
      if ((el = g('[data-tok]')) && !P.order) {
        const list = P.how === 'intents' ? tileCoins() : WALLET;
        P.tok = list[+el.dataset.tok];
        paint();
        return;
      }
      if ((el = g('[data-how]')) && !P.order) {
        P.how = el.dataset.how;
        P.err = '';
        if (P.how === 'wallet') {
          P.tok = WALLET[0];
          paint();
          P.w = await nearWallet();
          if (P.w) {
            P.bal = await balances();
            P.tok = WALLET.find(enough) || WALLET[0];
          }
        } else P.tok = tileCoins()[0];
        paint();
        return;
      }
      if (g('#wconnect')) {
        await connect();
        P.w = await nearWallet();
        if (P.w) {
          P.bal = await balances();
          P.tok = WALLET.find(enough) || WALLET[0];
        }
        paint();
        return;
      }
      if (g('#getAddr')) {
        quote();
        return;
      }
      if (g('#wpay')) {
        walletPay();
        return;
      }
      if (g('#copy')) {
        try {
          navigator.clipboard.writeText(P.order.dep.addr);
        } catch (er) {}
        toast(t('pay.copied'));
        return;
      }
      if (g('[data-close]')) close();
    };
    return P;
  }
  // ---------- wiring ----------
  document.addEventListener('click', async (e) => {
    if (layer.contains(e.target)) return;
    const tg = (s) => e.target.closest(s);
    let el;
    if ((el = tg('[data-cur]'))) {
      S.cur = el.dataset.cur;
      $$('[data-cur]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
      if (S.cur === 'near' && !TOK.length) {
        try {
          TOK = (await api('GET', '/market/tokens')).tokens || [];
        } catch (er) {}
      }
      renderAll();
      return;
    }
    if ((el = tg('[data-lang]'))) {
      lang = el.dataset.lang;
      try {
        localStorage.setItem('md-market-lang', lang);
      } catch (er) {}
      applyLang();
      return;
    }
    if ((el = tg('[data-view]'))) {
      const v = el.dataset.view;
      go(v === 'mine' ? 'my' : v === 'activity' ? 'activity' : '');
      return;
    }
    if ((el = tg('[data-lot]'))) {
      if (modded(e)) return;
      e.preventDefault();
      S.back = R;
      lotPushed = !EMBED;
      go('lot/' + el.dataset.lot);
      return;
    }
    if ((el = tg('[data-buylot]'))) {
      const l = LOTS.find((x) => x.id === el.dataset.buylot);
      if (!l || !l.n) return toast(t('lot.gone'));
      if (l.n * l.p < MIN() - 1e-9) {
        // (the whole lot under the least purchase: its window says so)
        S.back = R;
        lotPushed = !EMBED;
        go('lot/' + l.id);
        return;
      }
      if (!ME) return connect();
      openPay(l.it, lotMin(l), l);
      return;
    }
    if ((el = tg('[data-go]'))) {
      if (modded(e)) return;
      e.preventDefault();
      go(el.dataset.go);
      return;
    }
    if ((el = tg('[data-share]'))) {
      share(el.dataset.share);
      return;
    }
    if (tg('[data-clear]')) {
      S.kind = 'all';
      S.rar.clear();
      S.q = '';
      $('#q').value = '';
      $$('[data-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === 'all')));
      $$('[data-r]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      go('');
      return;
    }
    if ((el = tg('[data-mode]'))) {
      // (the order book opens on every item, or on the item the shelf is narrowed to)
      if (el.dataset.mode === 'book' && S.mode !== 'book') selectItem(S.it || 'all');
      else setMode(el.dataset.mode);
      return;
    }
    if ((el = tg('[data-kind]'))) {
      S.kind = el.dataset.kind;
      $$('[data-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
      refilter();
      return;
    }
    if ((el = tg('[data-r]'))) {
      const n = +el.dataset.r;
      S.rar.has(n) ? S.rar.delete(n) : S.rar.add(n);
      el.setAttribute('aria-pressed', String(S.rar.has(n)));
      refilter();
      return;
    }
    if (tg('[data-login]')) {
      connect();
      return;
    }
    if (tg('#acct')) {
      if (ME) signOut();
      else connect();
      return;
    }
    if ((el = tg('[data-quick]'))) {
      const id = el.dataset.quick;
      openPay(id, minQ(id));
      return;
    }
    if ((el = tg('[data-open]'))) {
      selectItem(el.dataset.open, 'buy', true);
      return;
    }
    if ((el = tg('[data-sel]'))) {
      selectItem(el.dataset.sel);
      return;
    }
    if ((el = tg('[data-sell]'))) {
      openSell(el.dataset.sell);
      return;
    }
    if ((el = tg('[data-side]'))) {
      S.side = el.dataset.side;
      renderTrade();
      return;
    }
    if ((el = tg('[data-step]'))) {
      const inp = el.parentElement.querySelector('input');
      inp.value = clamp((Math.round(+inp.value) || 1) + +el.dataset.step, 1, +inp.max || 99);
      updTrade();
      return;
    }
    if ((el = tg('[data-setp]'))) {
      $('#sp').value = (+el.dataset.setp).toFixed(2);
      updTrade();
      return;
    }
    if ((el = tg('[data-lr]'))) {
      takeRow(+el.dataset.lr.split(':')[1]);
      return;
    }
    if (tg('#buyGo')) {
      openPay(S.sel, S.bq);
      return;
    }
    if ((el = tg('#sellGo'))) {
      const id = S.sel,
        own = MINE[id] || 0,
        q = clamp(S.sq, 1, own),
        p = Math.round(+$('#sp').value * 100);
      if (!(p >= 1) || !own) return;
      el.disabled = true;
      try {
        await api('POST', '/market/list', { id, n: q, price: p });
        tellGame('saved');
        toast(`${t('toast.listed')}: ${nm(id)} ×${q} · ${usd(p / 100)}`);
        S.sq = 1;
        await refresh();
      } catch (er) {
        toast(errText(er));
        el.disabled = false;
      }
      return;
    }
    if ((el = tg('[data-cancel]'))) {
      el.disabled = true;
      try {
        await api('POST', '/market/cancel', { lot: el.dataset.cancel });
        tellGame('saved');
        toast(t('toast.cancel'));
        await refresh();
      } catch (er) {
        toast(errText(er));
        el.disabled = false;
      }
      return;
    }
    if ((el = tg('[data-resume]'))) {
      resumeOrder(el.dataset.resume);
      return;
    }
  });
  // an order still waiting: its window again, its address and timer
  async function resumeOrder(orderId) {
    let o;
    try {
      o = (await api('GET', '/market/order?id=' + encodeURIComponent(orderId))).order;
    } catch (e) {
      return toast(errText(e));
    }
    if (!TOK.length) {
      try {
        TOK = (await api('GET', '/market/tokens')).tokens || [];
      } catch (e) {}
    }
    const P = await openPay(o.it, o.n);
    if (!P) return;
    P.order = o;
    P.how = o.chain === 'near' ? 'wallet' : 'intents';
    P.tok = (P.how === 'wallet' ? WALLET.find((x) => x.a === o.asset) : null) ||
      TOK.find((x) => x.a === o.asset) || { a: o.asset, s: o.sym, c: o.chain };
    if (P.how === 'wallet') {
      P.w = await nearWallet();
      if (P.w) P.bal = await balances();
    }
    P.repaint();
  }
  // an item's rows in the book of all items and its tile to buy light up together
  const lightUp = (id, on) =>
    $$(`#ob [data-it="${id}"], #trade [data-it="${id}"]`).forEach((el) => el.classList.toggle('hl', on));
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest('#ob [data-it], #trade [data-it]');
    if (el) lightUp(el.dataset.it, true);
  });
  document.addEventListener('mouseout', (e) => {
    const el = e.target.closest && e.target.closest('#ob [data-it], #trade [data-it]');
    if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) lightUp(el.dataset.it, false);
  });
  document.addEventListener('input', (e) => {
    if (e.target.closest('#trade')) updTrade();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && layer.innerHTML) close();
  });
  const onQ = (e) => {
    S.q = e.target.value.trim();
    refilter();
  };
  let rowsNow = bookRows();
  new ResizeObserver(() => drawChart()).observe($('#ob'));
  addEventListener('resize', () => {
    const n = bookRows();
    if (n !== rowsNow) {
      rowsNow = n;
      renderBook();
    }
  });
  $('#q').addEventListener('input', onQ);
  $('#sort').addEventListener('change', (e) => {
    S.sort = e.target.value;
    refilter();
  });
  // the shelf and the books follow the market: every 10 s while the page is seen (the payment window has its own look)
  setInterval(() => {
    if (!document.hidden && !layer.innerHTML) refresh();
  }, 10e3);
  addEventListener('storage', (e) => {
    if (e.key === WKEY) refresh();
  }); // (signed in or out in the game's tab)
  build();
  setMode(S.mode);
  applyLang();
  // the address: an old link (/market.html) shown as /market; the route's tab and shelf now, a lot's window once the
  // market has answered
  if (!EMBED && location.pathname === '/market.html') history.replaceState(null, '', '/market');
  route(routeOf(location.pathname));
  refresh().then(() => {
    S.bq = minQ(S.sel);
    renderTrade();
    if (/^lot\//.test(R) && !S.lot) route(R);
  });
  api('GET', '/market/tokens')
    .then((r) => {
      TOK = r.tokens || [];
    })
    .catch(() => {});
})();
