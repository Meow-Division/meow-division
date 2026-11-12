// live/editor.js — the map editor (map-editor.bat → /live/index.html?editor): the level drawn by the game's own renderer, edited with
// the mouse, saved to live/map.js by the local server (server.mjs --editor; server/mapfile.mjs checks and formats it). The map's shape
// is map.js's: ground units gx, gy in [0, 4800], screen x = gx − gy + 4800, y = (gx + gy) / 2. Every edit rebuilds the level
// (SIM.setMap) and repaints the ground chunks it touched (SCENE.dirtyGround). Not in the packed build (gen/build.mjs leaves it out).
// ?editor&map=lab: the laboratory (saved to live/map_lab.js): its walls, posts, floors, lights and starts besides its props and decor.
// ?editor&map=office: the NEAR AI office, mission 1's map (live/map_office.js): edited as the town is, plus its void
// (solid, never drawn: the land round the play area) and its gates (walls of nothing the mission's script opens).
(function () {
  const cv = document.getElementById('c'),
    W = SIM.VIEW.W,
    H = SIM.VIEW.H,
    A = window.ASSETS,
    PROP = SIM.PROP,
    toS = SIM.toS,
    toGx = SIM.toGx,
    toGy = SIM.toGy;
  const MAPQ = new URLSearchParams(location.search).get('map'),
    OFFICE_IN = MAPQ === 'office_in', // (the office's inside: another map, its door's way in)
    BASE = MAPQ === 'base', // (NEAR Base: its own copy of the office's inside, live/map_base.js)
    OFFICE = MAPQ === 'office' || OFFICE_IN || BASE, // (the office is edited as the town is, with its void and gates)
    LAB = MAPQ === 'lab',
    MAPID = LAB ? 'lab' : BASE ? 'base' : OFFICE_IN ? 'office_in' : OFFICE ? 'office' : 'city';
  const POINT = { spawn: 1, starts: 1, posts: 1, lights: 1 },
    RECT = { roads: 1, areas: 1, walls: 1, floors: 1, void: 1, gates: 1, zones: 1 }; // (where an item keeps its place)
  const OVER = 8,
    SEED = LAB ? SIM.LAB0 + 1 : BASE ? SIM.BASE : OFFICE_IN ? SIM.OFFICE_IN : OFFICE ? SIM.OFFICE : 7,
    ZOOMS = [0.5, 0.7, 1, 1.35],
    ROAD_W = 240,
    WALK = 70,
    EDGE = SIM.EDGE,
    DRAFT = LAB
      ? 'md-map-draft-lab'
      : BASE
        ? 'md-map-draft-base'
        : OFFICE_IN
          ? 'md-map-draft-office_in'
          : OFFICE
            ? 'md-map-draft-office'
            : 'md-map-draft',
    V = window.__V || 0;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v),
    esc = (t) => String(t).replace(/[&<>"]/g, (c) => '&#' + c.charCodeAt(0) + ';');

  // ================================================================== the catalogue
  const TREES = [
    'p_tree1',
    'p_tree2',
    'p_tree3',
    'p_mtree1',
    'p_mtree2',
    'p_mtree3',
    // m1art trees {
    'p_mtree4',
    'p_mtree5',
    'p_mtree6',
    'p_mtree7',
    // m1art trees }
  ];
  const BUSHK = {
    p_bush1: 1,
    p_bush2: 1,
    p_bush3: 1,
    p_mbush1: 1.75,
    p_mbush2: 1.6,
    p_mbush3: 1.6,
    p_mbush4: 1.8,
    p_clover1: 1.3,
    p_tallgrass: 0.95,
    p_daisy: 0.95,
    p_grassdaisy: 1.25,
    p_pinkflower: 0.9,
    p_whiteflower: 0.95,
    // m1art bushes {
    p_mbush9: 1.6,
    p_mbush5: 2.0,
    p_mbush6: 1.6,
    p_mbush7: 1.9,
    p_mbush8: 1.9,
    // m1art bushes }
  }; // a bush's width: 95 × this (sim.js BUSHES before the editor)
  const NAMES = {
    of_glasswall: 'Стеклянная стена',
    of_meeting: 'Стол переговорной',
    of_board: 'Доска',
    of_servers: 'Серверы',
    of_console: 'Пульт',
    of_banner: 'Флаг на стене',
    of_flag: 'Флаг на столбах',
    of_bluelamp: 'Синяя лампа',
    // m1art names {
    m1_cp_booth: 'Будка блокпоста',
    m1_cp_arch: 'Арка блокпоста',
    m1_cp_wallnear: 'Стена с NEAR',
    m1_cp_wall: 'Бетонная стена',
    m1_car_van: 'Фургон',
    m1_car_hatchred: 'Красный хэтчбек',
    m1_car_sedanbeige: 'Бежевый седан',
    m1_car_sedanblue: 'Синий седан',
    m1_car_suvblack: 'Чёрный внедорожник',
    m1_car_muscle: 'Чёрное купе',
    m1_car_pickupred: 'Красный пикап',
    m1_car_sedanbeige2: 'Бежевый седан 2',
    m1_car_suvbeige: 'Бежевый внедорожник',
    m1_car_pickupblue: 'Синий пикап',
    m1_car_suvyellow: 'Жёлтый внедорожник',
    m1_car_hatchwhite: 'Белый хэтчбек',
    m1_st_biobanner: 'Баннер с биознаком',
    m1_st_debris: 'Мусор',
    p_mbush9: 'Трава с цветами',
    m1_st_blood: 'Кровь',
    m1_st_chest: 'Красный ящик',
    m1_st_blocks: 'Бетонные блоки',
    m1_st_cratepile: 'Гора ящиков',
    m1_st_sandbags: 'Мешки с песком',
    m1_st_cone: 'Конус',
    m1_st_barrel: 'Красная бочка',
    m1_st_boxyellow: 'Жёлтый ящик',
    m1_st_boxmetal: 'Металлический ящик',
    m1_st_lamp: 'Фонарь',
    m1_st_lamppost: 'Низкий фонарь',
    m1_st_crates: 'Ящики',
    m1_st_sandbags2: 'Мешки с песком 2',
    m1_st_lamp2: 'Фонарь 2',
    m1_st_lamppost2: 'Низкий фонарь 2',
    m1_st_crates2: 'Ящики 2',
    m1_st_sandbags3: 'Мешки с песком 3',
    m1_bar_jerseyred: 'Блок красно-белый',
    m1_bar_jersey: 'Бетонный блок',
    m1_bar_fence: 'Сетка',
    m1_bar_rail: 'Отбойник',
    m1_bar_fencebase: 'Сетка на блоке',
    m1_bar_sandbags: 'Мешки с песком 4',
    m1_bar_railcurve: 'Отбойник изогнутый',
    m1_bar_slabs: 'Бетонные плиты',
    m1_bar_wallnear: 'Стена с NEAR 2',
    m1_bar_fence2: 'Сетка 2',
    m1_bar_jerseyred2: 'Блок красно-белый 2',
    m1_bar_rail2: 'Отбойник 2',
    m1_bar_fence3: 'Сетка 3',
    m1_bar_wallbio: 'Стена с биознаком',
    m1_bar_wallnear2: 'Стена с NEAR 3',
    m1_bar_sandbags2: 'Мешки с песком 5',
    m1_bar_jerseyred3: 'Блок красно-белый 3',
    m1_bar_jersey2: 'Бетонный блок 2',
    m1_bar_rail3: 'Отбойник 3',
    m1_bar_railcurve2: 'Отбойник изогнутый 2',
    m1_bar_jerseyred4: 'Блок красно-белый 4',
    m1_bar_cube: 'Бетонный куб',
    m1_bar_pillar: 'Бетонный столб',
    m1_bar_rail4: 'Отбойник 4',
    m1_bar_fence4: 'Сетка 4',
    m1_bar_wallnear3: 'Стена с NEAR 4',
    m1_bar_arch: 'Арка блокпоста 2',
    m1_bar_fencegate: 'Ворота-сетка',
    m1_off_building: 'Здание офиса',
    m1_off_building2: 'Здание офиса (зеркало)',
    m1_in_reception: 'Ресепшен',
    m1_in_slatwall: 'Стена с логотипом',
    m1_in_lounge: 'Диваны',
    m1_in_meeting: 'Переговорный стол',
    m1_in_receptionset: 'Ресепшен со стеной',
    m1_in_desk1: 'Стол с компьютером',
    m1_in_desk2: 'Двойной стол',
    m1_in_desk4: 'Четыре стола',
    m1_in_cubicle: 'Угловой стол',
    m1_in_lounge2: 'Диваны 2',
    m1_iw_plain: 'Стена',
    m1_iw_ivy: 'Стена с плющом',
    m1_iw_exit: 'Стена с выходом',
    m1_iw_lamp: 'Стена с лампой',
    m1_iw_fglass: 'Окно у входа',
    m1_iw_fdoor: 'Стеклянные двери',
    m1_iw_fwall: 'Стена у входа',
    m1_iw_fcorner: 'Угол у входа',
    m1_iw_fglass2: 'Окно у входа 2',
    m1_iw_fdoor2: 'Стеклянные двери 2',
    m1_iw_fwall2: 'Стена у входа 2',
    m1_iw_fcorner2: 'Угол у входа 2',
    m1_iw_lglass: 'Окно слева',
    m1_iw_lglass2: 'Окно слева 2',
    m1_iw_lwall: 'Стена слева',
    m1_iw_lwall2: 'Стена слева 2',
    m1_iw_lglass3: 'Окно слева 3',
    m1_iw_lglass4: 'Окно слева 4',
    m1_iw_lwall3: 'Стена слева 3',
    m1_iw_lwall4: 'Стена слева 4',
    m1_iw_lglass5: 'Окно слева 5',
    m1_iw_lglass6: 'Окно слева 6',
    m1_iw_lwall5: 'Стена слева 5',
    m1_iw_lwall6: 'Стена слева 6',
    m1_wk_x_plain: 'Стена ↘',
    m1_wk_x_window: 'Окно ↘',
    m1_wk_x_door: 'Дверь ↘',
    m1_wk_x_glass: 'Стеклянная перегородка ↘',
    m1_wk_y_plain: 'Стена ↗',
    m1_wk_y_window: 'Окно ↗',
    m1_wk_y_door: 'Дверь ↗',
    m1_wk_y_glass: 'Стеклянная перегородка ↗',
    m1_wk_xl_plain: 'Низкая стена ↘',
    m1_wk_xl_ivy: 'Низкая стена с плющом ↘',
    m1_wk_yl_plain: 'Низкая стена ↗',
    m1_wk_yl_ivy: 'Низкая стена с плющом ↗',
    m1_wk_pillar: 'Столб',
    m1_wk_pillar_low: 'Низкий столб',
    m1_wk_x_entrance: 'Вход ↘',
    m1_wk_y_entrance: 'Вход ↗',
    m1_wk_x_clear: 'Стекло ↘',
    m1_wk_y_clear: 'Стекло ↗',
    m1_wk_x_broken: 'Разбитое стекло ↘',
    m1_wk_y_broken: 'Разбитое стекло ↗',
    m1_wk_x_glassdoor: 'Стеклянная дверь ↘',
    m1_wk_y_glassdoor: 'Стеклянная дверь ↗',
    m1_wk_x_glassivy: 'Стекло с плющом ↘',
    m1_wk_y_glassivy: 'Стекло с плющом ↗',
    m1_in_rack: 'Серверная стойка',
    m1_in_rackopen: 'Открытая стойка',
    m1_in_rackfallen: 'Упавшая стойка',
    m1_in_screen: 'Разбитый экран',
    m1_in_fenceflag: 'Сетка с флагом NEAR',
    m1_in_lantern: 'Фонарь на столбе',
    m1_in_candles: 'Стол со свечами',
    m1_in_flagpole: 'Флаг на флагштоке',
    m1_in_planter: 'Кашпо с растением',
    m1_in_planterlong: 'Длинное кашпо',
    m1_in_pot: 'Растение в горшке',
    m1_in_shards: 'Осколки стекла',
    m1_in_novapost: 'Пост Новы',
    m1_in_novapost_front: 'Пост Новы (передняя часть)',
    m1_in_waltshop: 'Лавка Уолта',
    m1_in_waltshop_front: 'Лавка Уолта (передняя часть)',
    m1_rm_gen: 'Генераторная',
    m1_rm_med: 'Медпункт',
    m1_rm_wb: 'Мастерская с верстаками',
    m1_rm_kit: 'Кухня',
    m1_pk_door: 'Распахнутая стеклянная створка',
    m1_pk_stop: 'Отбойник парковки',
    m1_pk_curb: 'Бордюр',
    m1_pk_flowers: 'Цветы и трава',
    m1_in_receptionisle: 'Ресепшен ↘',
    m1_in_receptionisle2: 'Ресепшен ↗',
    m1_wk_x_slat: 'Деревянная стена с логотипом ↘',
    m1_wk_y_slat: 'Деревянная стена с логотипом ↗',
    m1_wk_rack_x: 'Сервер ↘',
    m1_wk_rack_y: 'Сервер ↗',
    m1_wk_rackopen_x: 'Открытый сервер ↘',
    m1_wk_rackopen_y: 'Открытый сервер ↗',
    m1_wk_xh_clear: 'Половина стекла ↘',
    m1_wk_xh_glassopen: 'Половина: открытая стеклянная дверь ↘',
    m1_wk_yh_clear: 'Половина стекла ↗',
    m1_wk_yh_glassopen: 'Половина: открытая стеклянная дверь ↗',
    m1_wk_x_opendoor: 'Открытая дверь ↘',
    m1_wk_y_opendoor: 'Открытая дверь ↗',
    m1_wk_xh_plain: 'Половина стены ↘',
    m1_wk_yh_plain: 'Половина стены ↗',
    m1_wk_xh_door: 'Половина с дверью ↘',
    m1_wk_yh_door: 'Половина с дверью ↗',
    m1_wk_xh_opendoor: 'Половина с открытой дверью ↘',
    m1_wk_yh_opendoor: 'Половина с открытой дверью ↗',
    m1_wk_x_tallwin: 'Высокое окно ↘',
    m1_wk_y_tallwin: 'Высокое окно ↗',
    m1_wk_x_tallwinivy: 'Высокое окно с плющом ↘',
    m1_wk_y_tallwinivy: 'Высокое окно с плющом ↗',
    m1_wk_x_glassopen: 'Стеклянная стена, дверь открыта ↘',
    m1_wk_y_glassopen: 'Стеклянная стена, дверь открыта ↗',
    m1_wk_x_entranceopen: 'Открытый вход ↘',
    m1_wk_y_entranceopen: 'Открытый вход ↗',
    p_mtree4: 'Дерево',
    m1_nat_rock: 'Скала',
    p_mbush5: 'Куст',
    p_mbush6: 'Папоротник',
    m1_nat_rock2: 'Скала 2',
    m1_nat_rocks: 'Камни',
    p_mtree5: 'Дерево 2',
    p_mbush7: 'Куст 2',
    p_mtree6: 'Дерево 3',
    p_mtree7: 'Дерево 4',
    p_mbush8: 'Куст 3',
    m1_nat_rock3: 'Скала 3',
    // m1art names }
    bld_house: 'Дом',
    bld_gas: 'Заправка',
    bld_warehouse: 'Склад',
    bld_garage: 'Гараж',
    bld_shop: 'Магазин',
    bld_booth: 'Киоск',
    bld_busstop: 'Остановка',
    iso_car_red: 'Красная машина',
    iso_car_blue: 'Синяя машина',
    iso_van: 'Фургон',
    iso_bus: 'Автобус',
    iso_car_white: 'Белая машина',
    iso_car_red2: 'Красная машина 2',
    iso_suv: 'Джип',
    iso_car_sedan: 'Седан',
    iso_wall: 'Стена',
    iso_cwall: 'Бетонная стена',
    iso_cwall_cat: 'Стена с котом',
    iso_ccorner: 'Угол стены',
    iso_fence: 'Забор',
    iso_mesh: 'Сетка',
    iso_gate: 'Ворота',
    iso_rail: 'Ограда',
    iso_block: 'Бетонный блок',
    iso_barrier: 'Барьер',
    iso_barrier2: 'Барьер 2',
    iso_barrier3: 'Барьер 3',
    iso_ruin: 'Руины',
    iso_pillar: 'Столб',
    iso_slab: 'Плита',
    iso_sign: 'Щит',
    iso_sign2: 'Вывеска',
    iso_crate: 'Ящик',
    iso_metalcrate: 'Железный ящик',
    iso_crate2: 'Ящик 2',
    iso_crate3: 'Ящик 3',
    iso_stool: 'Табурет',
    iso_cardboard: 'Коробка',
    p_barrel: 'Бочка (взрыв)',
    p_lamp: 'Фонарь',
    iso_lamp: 'Фонарь у дороги',
    iso_lamp2: 'Фонарь 2',
    iso_lamp3: 'Фонарь 3',
    iso_dumpster: 'Мусорный бак',
    iso_debris: 'Обломки',
    iso_locker: 'Шкафчик',
    p_cone: 'Конус',
    p_obarrel: 'Бочка',
    iso_redbin: 'Красный бак',
    iso_trash: 'Урна',
    iso_tbarrel: 'Бочка с мусором',
    iso_bench: 'Скамейка',
    p_tree1: 'Дерево 1',
    p_tree2: 'Дерево 2',
    p_tree3: 'Ёлка',
    p_mtree1: 'Дерево 3',
    p_mtree2: 'Дерево 4',
    p_mtree3: 'Дерево 5',
    p_bush1: 'Куст 1',
    p_bush2: 'Куст 2',
    p_bush3: 'Куст 3',
    p_mbush1: 'Большой куст 1',
    p_mbush2: 'Большой куст 2',
    p_mbush3: 'Большой куст 3',
    p_mbush4: 'Большой куст 4',
    p_clover1: 'Клевер',
    p_tallgrass: 'Трава',
    p_daisy: 'Ромашки',
    p_grassdaisy: 'Трава с ромашками',
    p_pinkflower: 'Розовые цветы',
    p_whiteflower: 'Белые цветы',
    manhole: 'Люк',
    stain: 'Пятно',
    graf1: 'Граффити 1',
    graf2: 'Граффити 2',
    flower: 'Цветы',
    zone: 'Зона',
    line: 'Линия белая',
    liney: 'Линия жёлтая',
    dash: 'Пунктир',
    stalls: 'Парковочные места',
    zebra: 'Зебра',
    stripe: 'Жёлто-чёрная полоса',
    hatch: 'Штриховка',
    arrow: 'Стрелка',
    park: 'Буква P',
    logo: 'Логотип NEAR',
  };
  const DECOR = ['manhole', 'stain', 'graf1', 'graf2', 'flower'],
    DECOR_IMG = { graf1: 'p_graffiti1', graf2: 'p_graffiti2', flower: 'p_daisy' };
  // the floor markings (sim.js MARKINGS, ground.js paints them): the palette's kind → [the map's kind, size, yellow]. An
  // item: [kind, gx, gy, size, turn, yellow]; hatch [kind, gx, gy, along gx, along gy]; logo [kind, gx, gy, size]
  const MARKN = {
      line: ['line', 240, 0],
      liney: ['line', 240, 1],
      dash: ['dash', 480, 0],
      stalls: ['stalls', 600, 0],
      zebra: ['zebra', 260, 0],
      stripe: ['stripe', 400, 0],
      hatch: ['hatch', 300, 0],
      arrow: ['arrow', 200, 0],
      park: ['park', 170, 0],
      logo: ['logo', 220, 0],
    },
    MARKS = Object.keys(MARKN),
    isMark = (it) => !LAB && (SIM.MARKINGS[it[0]] !== undefined || it[0] === 'logo'),
    markOf = (n, gx, gy, f) => {
      const [k, z, c] = MARKN[n];
      return k === 'hatch'
        ? [k, gx, gy, z, 160]
        : k === 'logo'
          ? [k, gx, gy, z]
          : [k, gx, gy, z, f & SIM.MARKINGS[k], c];
    },
    paintName = (it) => NAMES[it[0] === 'line' && it[5] ? 'liney' : it[0]] || it[0];
  // the lab's: its furniture, what lies on its floors (decor [kind, gx, gy, size, angle]), its floors' kinds, its lights' colours
  Object.assign(NAMES, {
    lb_workbench: 'Верстак',
    lb_target: 'Мишень',
    lb_stall: 'Прилавок Уолта',
    lb_radio: 'Стол Новы',
    np_walt: 'Уолт',
    np_nova: 'Нова',
    lb_rubble: 'Завал с лентой',
    lb_sandbags: 'Мешки с песком',
    lb_tank: 'Разбитая колба',
    lb_tent: 'Мед-палатка',
    lb_stretcher: 'Носилки',
    lb_flood: 'Прожектор',
    lb_desk: 'Стол с монитором',
    lb_cart: 'Тележка',
    lb_biobarrel: 'Бочка биоопасности',
    lb_iv: 'Капельница',
    lb_shelf: 'Стеллаж',
    lb_pallet: 'Поддон',
    lb_forklift: 'Погрузчик',
    lb_cabinet: 'Электрошкаф',
    lb_servers: 'Ряд серверов',
    lb_server: 'Сервер',
    lb_console: 'Пульт',
    lb_pipes: 'Трубы',
    lb_tube: 'Колба с образцом',
    lb_tubebroken: 'Разбитая колба (малая)',
    lb_optable: 'Операционный стол',
    lb_generator: 'Генератор',
    lb_planter: 'Грядка',
    lb_pots: 'Горшки',
    lb_bigplant: 'Большое растение',
    lb_growlight: 'Фитолампа',
    lb_cell: 'Камера',
    lb_guarddesk: 'Пост охраны',
    lb_suits: 'Защитные костюмы',
    lb_vending: 'Автомат с едой',
    lb_table: 'Стол со скамьями',
    lb_counter: 'Раздача',
    lb_shower: 'Душ',
    lb_coffee: 'Кофемашина',
    lb_chembench: 'Химический стол',
    lb_cryopod: 'Криокапсула',
    lb_jars: 'Банки с образцами',
    lb_analyzer: 'Анализатор',
    lb_fumehood: 'Вытяжной шкаф',
    lb_freezer: 'Морозильник',
    lb_cage: 'Клетка',
    lb_wheelchair: 'Инвалидное кресло',
    lb_crates: 'Ящики под брезентом',
    lb_screen: 'Мед-ширма',
    lb_oxygen: 'Баллоны',
    lb_spool: 'Кабельная катушка',
    lb_drums: 'Бочки на поддоне',
    lb_palletjack: 'Рохля с коробками',
    lb_fueltank: 'Топливный бак',
    lb_transformer: 'Трансформатор',
    lb_aircon: 'Охладитель',
    lb_ups: 'Батарейные шкафы',
    lb_fallenrack: 'Упавший сервер',
    lb_levers: 'Пульт с рычагами',
    lb_hydro: 'Гидропоника',
    lb_barrow: 'Тачка с землёй',
    lb_watertank: 'Бак с водой',
    lb_cactus: 'Мутант-кактус',
    lb_cafetable: 'Круглый столик',
    lb_watercooler: 'Кулер',
    lb_wastebins: 'Контейнеры для отходов',
    lb_lockers: 'Шкафчики',
    goo: 'Зелёная лужа',
    glass: 'Осколки',
    cable: 'Кабели',
    paper: 'Бумаги',
    drain: 'Слив',
    grate: 'Решётка',
    moss: 'Мох',
    blood: 'Кровь',
    puddle: 'Вода',
    stripe: 'Полоса',
  });
  const LABDEC = ['goo', 'glass', 'cable', 'paper', 'drain', 'grate', 'stain', 'moss', 'blood', 'puddle', 'stripe'];
  const LABDEC_S = {
    goo: 90,
    glass: 80,
    cable: 400,
    paper: 1,
    drain: 50,
    grate: 70,
    stain: 90,
    moss: 140,
    blood: 70,
    puddle: 110,
    stripe: 500,
  };
  const LABDEC_C = {
    goo: '#7ee03a',
    glass: '#bfe8e4',
    cable: '#22262e',
    paper: '#e9e4da',
    drain: '#2a2b30',
    grate: '#6a6e78',
    stain: '#3a3640',
    moss: '#3d7a2a',
    blood: '#8a1420',
    puddle: '#7090b8',
    stripe: '#e8b51e',
  };
  const FLOORS = {
    hall: 'Зал',
    store: 'Склад',
    server: 'Серверная',
    gen: 'Генераторная',
    green: 'Оранжерея',
    exp: 'Опыты',
    cells: 'Изолятор',
    cafe: 'Столовая',
    decon: 'Шлюз',
  };
  const FLOOR_C = {
    hall: '#9fb3c8',
    store: '#b09060',
    server: '#5a8ac0',
    gen: '#d08a40',
    green: '#6aaa48',
    exp: '#5ab8a8',
    cells: '#c06060',
    cafe: '#b8a878',
    decon: '#c8c870',
  };
  const TINTS = {
    white: 'Белый',
    warm: 'Тёплый',
    blue: 'Синий',
    orange: 'Оранжевый',
    pink: 'Розовый',
    green: 'Зелёный',
    red: 'Красный',
  };
  const TINT_C = {
    white: '#dfe8f5',
    warm: '#ffc878',
    blue: '#6aa0ff',
    orange: '#ff9a3a',
    pink: '#ff70e0',
    green: '#70ff90',
    red: '#ff5a4a',
  };
  const opts = (o, v) =>
    Object.entries(o)
      .map(([k, t]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${t}</option>`)
      .join('');
  let floorKind = 'store',
    lightTint = 'white';
  const used = new Set(),
    take = (f) =>
      Object.keys(PROP)
        .filter((n) => !used.has(n) && f(n))
        .map((n) => (used.add(n), n));
  const LABG = [
    ['База', ['lb_workbench', 'lb_target', 'lb_stall', 'lb_radio', 'np_walt', 'np_nova', 'lb_rubble', 'lb_sandbags']],
    [
      'Зал',
      [
        'lb_tank',
        'lb_tent',
        'lb_stretcher',
        'lb_iv',
        'lb_flood',
        'lb_desk',
        'lb_cart',
        'lb_biobarrel',
        'lb_crates',
        'lb_screen',
        'lb_oxygen',
        'lb_spool',
      ],
    ],
    ['Склад', ['lb_shelf', 'lb_pallet', 'lb_forklift', 'lb_drums', 'lb_palletjack', 'lb_cabinet']],
    [
      'Серверная и генераторная',
      [
        'lb_servers',
        'lb_server',
        'lb_console',
        'lb_aircon',
        'lb_ups',
        'lb_fallenrack',
        'lb_generator',
        'lb_pipes',
        'lb_fueltank',
        'lb_transformer',
        'lb_levers',
      ],
    ],
    [
      'Опыты и камеры',
      [
        'lb_tube',
        'lb_tubebroken',
        'lb_optable',
        'lb_chembench',
        'lb_cryopod',
        'lb_jars',
        'lb_analyzer',
        'lb_fumehood',
        'lb_freezer',
        'lb_cell',
        'lb_cage',
        'lb_wheelchair',
        'lb_guarddesk',
      ],
    ],
    [
      'Оранжерея',
      ['lb_planter', 'lb_pots', 'lb_bigplant', 'lb_growlight', 'lb_hydro', 'lb_barrow', 'lb_watertank', 'lb_cactus'],
    ],
    [
      'Столовая и душевые',
      [
        'lb_table',
        'lb_cafetable',
        'lb_counter',
        'lb_coffee',
        'lb_watercooler',
        'lb_vending',
        'lb_suits',
        'lb_lockers',
        'lb_shower',
        'lb_wastebins',
      ],
    ],
  ];
  {
    const all = Object.keys(PROP).filter((n) => /^lb_/.test(n) && !/^lb_(wall|post)/.test(n)),
      seen = new Set(LABG.flatMap((g) => g[1])),
      rest = all.filter((n) => !seen.has(n));
    for (const g of LABG) g[1] = g[1].filter((n) => PROP[n]);
    if (rest.length) LABG.push(['Ещё', rest]);
  }
  const CATS = LAB
    ? [
        ...LABG.map(([t, list]) => ({ t, k: 'props', list })),
        {
          t: 'Ящики, бочки, шкафы',
          k: 'props',
          list: [
            'iso_metalcrate',
            'iso_crate2',
            'iso_crate3',
            'iso_cardboard',
            'iso_stool',
            'p_barrel',
            'p_obarrel',
            'iso_locker',
            'iso_trash',
            'iso_bench',
          ],
        },
        { t: 'На полу', k: 'decor', list: LABDEC },
      ]
    : [
        // mission 1's own (gen/m1art.py), by their names' prefix: first, before the groups below take them by their names
        ...(OFFICE
          ? [
              { t: 'База: комнаты', k: 'props', list: take((n) => /^m1_rm_/.test(n)) },
              { t: 'Блокпост', k: 'props', list: take((n) => /^m1_cp_/.test(n)) },
              { t: 'Машины миссии', k: 'props', list: take((n) => /^m1_car_/.test(n)) },
              { t: 'Ограждения', k: 'props', list: take((n) => /^m1_bar_/.test(n)) },
              { t: 'Улица', k: 'props', list: take((n) => /^m1_st_/.test(n)) },
              { t: 'Камни', k: 'props', list: take((n) => /^m1_nat_/.test(n)) },
              { t: 'Офис: здание', k: 'props', list: take((n) => /^m1_off_/.test(n)) },
              { t: 'Офис: стены (набор)', k: 'props', list: take((n) => /^m1_wk_/.test(n)) },
              { t: 'Офис: стены (старые)', k: 'props', list: take((n) => /^m1_iw_/.test(n)) },
              { t: 'Офис: мебель', k: 'props', list: take((n) => /^m1_in_/.test(n)) },
            ]
          : []),
        { t: 'Здания', k: 'props', list: take((n) => PROP[n].bld) },
        { t: 'Машины', k: 'props', list: take((n) => /car|van|bus|suv/.test(n)) },
        { t: 'Ящики и бочки', k: 'props', list: take((n) => PROP[n].hp) },
        { t: 'Фонари', k: 'props', list: take((n) => PROP[n].lamp) },
        {
          t: 'Стены и заборы',
          k: 'props',
          list: take((n) => /wall|ccorner|fence|mesh|gate|rail|block|barrier|ruin|pillar|slab|sign/.test(n)),
        },
        ...(OFFICE
          ? [
              {
                t: 'Офис',
                k: 'props',
                list: take((n) => /^(of_|lb_|np_)/.test(n) && !/^lb_(wall|post)/.test(n) && !!A[n]),
              },
            ]
          : []),
        { t: 'Мелочи', k: 'props', list: take(() => true) },
        { t: 'Деревья', k: 'trees', list: TREES, mix: true },
        { t: 'Кусты и цветы', k: 'bushes', list: Object.keys(BUSHK), mix: true },
        { t: 'На земле и разметка', k: 'decor', list: [...(OFFICE ? ['zone'] : []), ...DECOR, ...MARKS] },
      ];
  const MATS = { tiles: 'Плитка', plaza: 'Площадь', dirt: 'Земля', floor: 'Пол офиса' };

  // pictures (the palette, the ghost, picking by the picture's own alpha: a 96 px wide mask per sprite)
  const IMG = {},
    MASK = {};
  const img = (n) => {
    if (!IMG[n]) {
      const im = new Image();
      im.onload = () => {
        const w = 96,
          h = Math.max(1, Math.round((96 * im.height) / im.width)),
          c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        g.drawImage(im, 0, 0, w, h);
        MASK[n] = { w, h, d: g.getImageData(0, 0, w, h).data };
      };
      im.src = 'assets/' + n + '.png?v=' + V;
      IMG[n] = im;
    }
    return IMG[n];
  };
  const opaque = (n, u, v) => {
    const m = MASK[n];
    if (!m) return u >= 0 && u <= 1 && v >= 0 && v <= 1;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
    return m.d[(Math.floor(v * m.h) * m.w + Math.floor(u * m.w)) * 4 + 3] > 40;
  };

  // a floor marking's picture for the palette (60 x 40, flat): white or yellow paint on the dark floor
  function markThumb(n) {
    const t = el('canvas', { width: 60, height: 40 }),
      g = t.getContext('2d'),
      W = '#e2e2d6',
      Y = '#e8b830';
    g.fillStyle = '#2b2a31';
    g.fillRect(0, 0, 60, 40);
    g.fillStyle = n === 'liney' || n === 'hatch' || n === 'zone' ? Y : W;
    if (n === 'line' || n === 'liney') g.fillRect(6, 18, 48, 4);
    else if (n === 'dash') for (let x = 4; x < 56; x += 14) g.fillRect(x, 18, 8, 4);
    else if (n === 'stalls') {
      for (let x = 8; x <= 52; x += 11) g.fillRect(x, 8, 2, 24);
      g.fillRect(8, 8, 46, 2);
    } else if (n === 'zebra') for (let x = 8; x < 52; x += 8) g.fillRect(x, 8, 4, 24);
    else if (n === 'stripe') {
      g.fillStyle = '#19191c';
      g.fillRect(4, 13, 52, 14);
      g.fillStyle = Y;
      for (let x = -6; x < 56; x += 10) {
        g.beginPath();
        g.moveTo(x, 13);
        g.lineTo(x + 5, 13);
        g.lineTo(x + 14, 27);
        g.lineTo(x + 9, 27);
        g.fill();
      }
    } else if (n === 'hatch') {
      g.strokeStyle = Y;
      g.lineWidth = 2;
      g.strokeRect(10, 8, 40, 24);
      for (let x = 6; x < 50; x += 7) {
        g.beginPath();
        g.moveTo(Math.max(10, x), x < 10 ? 32 - (10 - x) : 32);
        g.lineTo(Math.min(50, x + 24), 8);
        g.stroke();
      }
    } else if (n === 'arrow') {
      g.fillRect(8, 17, 26, 6);
      g.beginPath();
      g.moveTo(52, 20);
      g.lineTo(32, 9);
      g.lineTo(32, 31);
      g.fill();
    } else if (n === 'park') {
      g.font = 'bold 30px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('P', 30, 22);
    } else if (n === 'logo') {
      g.strokeStyle = W;
      g.lineWidth = 2;
      g.strokeRect(17, 7, 26, 26);
      g.fillRect(22, 11, 3, 18);
      g.fillRect(35, 11, 3, 18);
      g.beginPath();
      g.moveTo(22, 11);
      g.lineTo(26, 11);
      g.lineTo(38, 29);
      g.lineTo(34, 29);
      g.fill();
    } else if (n === 'zone') {
      g.strokeStyle = Y;
      g.lineWidth = 3;
      g.setLineDash([7, 4]);
      g.beginPath();
      g.roundRect(8, 8, 44, 24, 6);
      g.stroke();
    }
    return t.toDataURL();
  }

  // ================================================================== the map and its history
  const blank = () => ({
    v: 1,
    spawn: [2400, 2400],
    roads: [],
    areas: [],
    props: [],
    trees: [],
    bushes: [],
    decor: [],
    marks: [],
    ...(OFFICE ? { void: [], gates: [], zones: [] } : {}),
  });
  // (a map with none yet: its marks, and the office's void and gates, empty)
  const withMarks = (m) => {
    const o = Array.isArray(m.marks) ? m : { ...m, marks: [] };
    return OFFICE && !(Array.isArray(o.void) && Array.isArray(o.gates) && Array.isArray(o.zones))
      ? { ...o, void: o.void || [], gates: o.gates || [], zones: o.zones || [] }
      : o;
  };
  // a map as text whatever its keys' order (a moved draft gets size and shift last)
  const keyed = (m) =>
    JSON.stringify(
      Object.keys(m)
        .sort()
        .map((k) => [k, m[k]]),
    );
  // the ground's size: the map's own (sim.js level), else 4800
  const GS = () => map.size || 4800;
  // the whole office map moved by (dx, dy) (its size grown to keep its far side where it was): every named item's
  // [name, gx, gy, ...] (props, trees, bushes, decor, marks) and every rect's [x0, y0, x1, y1, ...] (roads, areas, void,
  // gates, zones). shift: how far the map was moved since it was made, so a draft from before a move is moved on load
  const moveAll = (m, dx, dy) => {
    const o = JSON.parse(JSON.stringify(m)),
      sh = o.shift || [0, 0];
    o.spawn = [o.spawn[0] + dx, o.spawn[1] + dy];
    for (const k of ['props', 'trees', 'bushes', 'decor', 'marks'])
      for (const it of o[k] || []) ((it[1] += dx), (it[2] += dy));
    for (const k of ['roads', 'areas', 'void', 'gates', 'zones'])
      for (const it of o[k] || []) ((it[0] += dx), (it[1] += dy), (it[2] += dx), (it[3] += dy));
    o.shift = [sh[0] + dx, sh[1] + dy];
    o.size = (m.size || 4800) + Math.max(dx, dy, 0);
    return o;
  };
  let map = withMarks(
      JSON.parse(
        JSON.stringify(
          LAB
            ? window.MAP_LAB
            : BASE
              ? window.MAP_BASE
              : OFFICE_IN
                ? window.MAP_OFFICE_IN
                : OFFICE
                  ? window.MAP_OFFICE
                  : window.MAP,
        ),
      ),
    ),
    saved = JSON.stringify(map);
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT) || 'null');
    if (d && d.map && OFFICE) {
      const a = map.shift || [0, 0],
        b = d.map.shift || [0, 0];
      if (a[0] !== b[0] || a[1] !== b[1]) d.map = { ...moveAll(d.map, a[0] - b[0], a[1] - b[1]), size: map.size };
    }
    if (
      d &&
      d.map &&
      keyed(withMarks(d.map)) !== keyed(map) &&
      confirm('Есть несохранённые изменения карты от ' + new Date(d.t).toLocaleString('ru') + '. Открыть их?')
    )
      map = withMarks(d.map);
  } catch (e) {}
  // the campaign missions played on this map with places of their own (live/missions.js, SIM.marksOf) and the marks
  // they name, in the order the scripts meet them: the Точки tool places them, Миссия ▶ tries one at once
  const EMAP = { city: 'suburb', lab: 'lab', office: 'office', office_in: 'office', base: '' }[MAPID],
    MIS = (window.ECONOMY ? ECONOMY.MISSIONS : []).filter((m) => m.map === EMAP && SIM.marksOf(m.id).length),
    NEED = [];
  for (const m of MIS)
    for (const n of SIM.marksOf(m.id, OFFICE ? MAPID : undefined)) if (!NEED.includes(n)) NEED.push(n); // (the office's: its map's own)
  const MARK_T = {
    start: 'Старт миссии',
    crate: 'Ящик с припасами',
    horde: 'Откуда идёт орда',
    gate: 'Вход в здание',
    guards: 'Охрана входа',
    bomb: 'Бомба у охраны',
    line_a: 'Линия (начало)',
    line_b: 'Линия (конец)',
    parking: 'Вход на парковку',
    drop: 'Дроп Новы',
    inside: 'Внутри офиса',
  };
  const GATES = [],
    LINE = [];
  for (const m of MIS)
    for (const k of MISSIONS[m.id].tasks) {
      if (k.k === 'cross') LINE.push(k.a, k.b);
      for (const a of (k.go || []).concat(k.end || [])) if (a.a === 'open' && !GATES.includes(a.g)) GATES.push(a.g);
    }
  const markName = (n) => MARK_T[n] || n,
    missing = () => NEED.find((n) => !map.marks.some((q) => q[0] === n)) || null;
  const undo = [],
    redo = [];
  let sel = []; // [{ k, i }]: k = 'props' | 'trees' | 'bushes' | 'decor' | 'roads' | 'areas' | 'spawn'
  let tool = { t: 'select' }; // select | place { k, n, flip, size, mix } | road | area { mat } | spawn
  let cam = [map.spawn[0] - map.spawn[1] + GS() - W / 1.4, (map.spawn[0] + map.spawn[1]) / 2 - H / 1.4], // (toS: the sim's G is the map's once rebuild runs)
    zoom = 0.7,
    snap = true,
    foot = true,
    LV = null,
    ST = null,
    probs = null,
    miniDirty = true;
  const snapV = (v) => (snap ? Math.round(v / 10) * 10 : Math.round(v));

  // ground extent of an item (for repainting the ground and for the problems)
  // a piece of the office's wall kit (PROP kit: gen/m1art.py) put down flush against the kit piece nearest it, within
  // KIT_R: end to end along a wall's line, round a corner (lined up with the other run's end), against a pillar's side
  // (centred on it); null: none that near (the 10 grid then). skip: the piece being moved
  const KIT_R = 90;
  const kitFoot = (n, dir) => (dir & 1 ? [PROP[n].fh, PROP[n].fw] : [PROP[n].fw, PROP[n].fh]);
  function kitSnap(n, dir, gx, gy, skip) {
    if (!snap || !PROP[n] || !PROP[n].kit) return null;
    const [w, h] = kitFoot(n, dir);
    let best = null,
      bd = KIT_R * KIT_R;
    const at = (x, y) => {
      const d2 = (x - gx) ** 2 + (y - gy) ** 2;
      if (d2 < bd) {
        bd = d2;
        best = [Math.round(x), Math.round(y)];
      }
    };
    map.props.forEach((p, i) => {
      if (i === skip || !PROP[p[0]] || !PROP[p[0]].kit) return;
      const [ow, oh] = kitFoot(p[0], p[3]);
      // touching its side across gx (lined up with its near edge, its middle or its far edge along gy), or across gy
      for (const sx of [-1, 1]) for (const a of [-1, 0, 1]) at(p[1] + (sx * (ow + w)) / 2, p[2] + (a * (oh - h)) / 2);
      for (const sy of [-1, 1]) for (const a of [-1, 0, 1]) at(p[1] + (a * (ow - w)) / 2, p[2] + (sy * (oh + h)) / 2);
    });
    return best;
  }
  function extent(k, it) {
    if (k === 'walls' || k === 'floors' || k === 'void' || k === 'gates') return [it[0], it[1], it[2], it[3]];
    if (k === 'zones') return [it[0] - 12, it[1] - 12, it[2] + 12, it[3] + 12]; // (its line is painted over the edge)
    if (k === 'posts') return [it[0] - 420, it[1] - 420, it[0] + 420, it[1] + 420]; // (a door's strip runs to the next post)
    if (k === 'lights' || k === 'starts') return [it[0] - 20, it[1] - 20, it[0] + 20, it[1] + 20]; // (nothing of theirs is painted on the ground)
    if (k === 'marks') return [it[1] - 20, it[2] - 20, it[1] + 20, it[2] + 20];
    if (k === 'decor' && LAB) {
      const r =
        it[0] === 'cable'
          ? it[3] + 60
          : it[0] === 'stripe'
            ? it[3] / 2 + 60
            : it[0] === 'paper'
              ? 90
              : it[3] * 1.6 + 40;
      return [it[1] - r, it[2] - r, it[1] + r, it[2] + r];
    }
    if (k === 'props') {
      const d = PROP[it[0]],
        fw = it[3] & 1 ? d.fh : d.fw,
        fh = it[3] & 1 ? d.fw : d.fh;
      return [it[1] - fw / 2, it[2] - fh / 2, it[1] + fw / 2, it[2] + fh / 2];
    }
    if (k === 'trees' || k === 'bushes')
      return [it[1] - it[3] / 2, it[2] - it[3] / 2, it[1] + it[3] / 2, it[2] + it[3] / 2];
    if (k === 'decor' && isMark(it)) {
      if (it[0] === 'hatch')
        return [it[1] - it[3] / 2 - 12, it[2] - it[4] / 2 - 12, it[1] + it[3] / 2 + 12, it[2] + it[4] / 2 + 12];
      if (it[0] === 'logo' || it[0] === 'arrow' || it[0] === 'park') {
        const r = it[3] / 2 + 24;
        return [it[1] - r, it[2] - r, it[1] + r, it[2] + r];
      }
      const L = it[3] / 2 + 12,
        w = { line: 17, dash: 17, stripe: 42, zebra: 102, stalls: 147 }[it[0]] || 40;
      return it[4] & 1 ? [it[1] - w, it[2] - L, it[1] + w, it[2] + L] : [it[1] - L, it[2] - w, it[1] + L, it[2] + w];
    }
    if (k === 'decor') return [it[1] - 80, it[2] - 80, it[1] + 80, it[2] + 80];
    if (k === 'roads') return [it[0] - it[4], it[1] - it[4], it[2] + it[4], it[3] + it[4]];
    if (k === 'areas') return [it[0], it[1], it[2], it[3]];
    return [it[0] - 100, it[1] - 100, it[0] + 100, it[1] + 100];
  }
  const itemOf = (s) => (s.k === 'spawn' ? map.spawn : map[s.k][s.i]);
  // the level from the map: the sim builds it, the scene draws it (a state with no actors, the hero standing on the start)
  // the final boss's hall: the biggest floor of kind 'hall' (server/mapfile.mjs bossHall: another room with the hall's tiles is an
  // ordinary room); the gas closes in on its middle (sim.js GAS)
  let BOSSF = null;
  function derive() {
    const H = map.floors.reduce(
      (b, r) => (r[4] === 'hall' && (!b || (r[2] - r[0]) * (r[3] - r[1]) > (b[2] - b[0]) * (b[3] - b[1])) ? r : b),
      null,
    );
    BOSSF = H;
    if (!H) return;
    map.hall = H.slice(0, 4);
  }
  function rebuild() {
    if (LAB) derive();
    SIM.setMap(map, MAPID);
    LV = SIM.level(SEED);
    ST = SIM.create({ seed: SEED, demo: true });
    ST.en = [];
    ST.neutral = true;
    ST.p.aim = 0.5;
    ST.p.face = 1;
    probs = problems();
    miniDirty = true;
    status();
  }
  const ground = (rects) => {
    if (!rects) {
      SCENE.resetGround();
      return;
    }
    for (const r of rects) SCENE.dirtyGround(SEED, r[0] - 420, r[1] - 300, r[2] + 420, r[3] + 300);
  };
  const snapshot = () => JSON.stringify(map);
  let draftT = 0;
  function commit(before, rects) {
    // after an edit: an undo point, the level built again, its ground repainted, the draft kept
    if (before === snapshot()) return;
    undo.push(before);
    if (undo.length > 200) undo.shift();
    redo.length = 0;
    rebuild();
    ground(rects);
    clearTimeout(draftT);
    draftT = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT, JSON.stringify({ t: Date.now(), map }));
      } catch (e) {}
    }, 400);
  }
  function history(from, to) {
    if (!from.length) return;
    to.push(snapshot());
    map = JSON.parse(from.pop());
    sel = [];
    rebuild();
    ground(null);
    panel();
  }

  // what overlaps: props standing in one another (footprints more than 8 deep: a row of wall pieces overlaps a little on purpose),
  // trees and bushes growing out of a prop, the start inside a prop
  function problems() {
    const P = map.props.map((p) => extent('props', p)),
      bad = new Set(),
      plants = [],
      inside = (r, x, y, m) => x > r[0] - m && x < r[2] + m && y > r[1] - m && y < r[3] + m;
    for (let i = 0; i < P.length; i++)
      for (let j = i + 1; j < P.length; j++) {
        const a = P[i],
          b = P[j];
        if (a[0] < b[2] - OVER && b[0] < a[2] - OVER && a[1] < b[3] - OVER && b[1] < a[3] - OVER) {
          bad.add(i);
          bad.add(j);
        }
      }
    for (const k of ['trees', 'bushes'])
      map[k].forEach((t, i) => {
        if (P.some((r) => inside(r, t[1], t[2], 0))) plants.push({ k, i });
      });
    let starts = [],
      shut = [];
    if (LAB) {
      const solid = map.walls.concat(map.posts.map((q) => [q[0] - 30, q[1] - 30, q[0] + 30, q[1] + 30]));
      P.forEach((a, i) => {
        if (solid.some((b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3])) bad.add(i);
      });
      const S0 = { seed: SEED, pd: [] };
      map.starts.forEach((q, i) => {
        const [x, y] = toS(q[0], q[1]);
        if (SIM.blockedAt(S0, x - 65, y, 34) || SIM.blockedAt(S0, x + 65, y, 34)) starts.push(i);
      });
      shut = shutOff();
    }
    const spawn = !LAB && P.some((r) => inside(r, map.spawn[0], map.spawn[1], 14)),
      nohall = LAB && !map.floors.some((r) => r[4] === 'hall');
    // a mission's mark inside something solid (its crate or its group would be put there)
    const S1 = { seed: SEED, pd: [] },
      marks = [];
    map.marks.forEach((q, i) => {
      const [x, y] = toS(q[1], q[2]);
      if (!LINE.includes(q[0]) && SIM.blockedAt(S1, x, y, 30)) marks.push(i); // (a line's ends may sit on its walls)
    });
    return {
      props: bad,
      plants,
      spawn,
      starts,
      shut,
      nohall,
      marks,
      n:
        bad.size +
        plants.length +
        (spawn ? 1 : 0) +
        starts.length +
        (shut.length ? 1 : 0) +
        (nohall ? 1 : 0) +
        marks.length,
    };
  }
  // the lab: floor the heroes can't reach from the hall (the sim's walking grid flooded from the hall's middle): [gx, gy, size] each
  function shutOff() {
    const B = LV.navBlocked,
      N = Math.round(Math.sqrt(B.length)),
      C = GS() / N,
      seen = new Uint8Array(B.length),
      h = map.hall || [2000, 2000, 2800, 2800];
    let s0 = -1;
    for (let r = 0; r < 40 && s0 < 0; r++)
      for (const [dx, dy] of [
        [r, 0],
        [-r, 0],
        [0, r],
        [0, -r],
      ]) {
        const i = (Math.floor((h[1] + h[3]) / 2 / C) + dy) * N + Math.floor((h[0] + h[2]) / 2 / C) + dx;
        if (!B[i]) {
          s0 = i;
          break;
        }
      }
    if (s0 < 0) return [];
    const q = [s0];
    seen[s0] = 1;
    while (q.length) {
      const i = q.pop(),
        x = i % N;
      for (const j of [x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1, i - N, i + N])
        if (j >= 0 && j < B.length && !B[j] && !seen[j]) {
          seen[j] = 1;
          q.push(j);
        }
    }
    const out = [];
    for (let i = 0; i < B.length; i++) {
      const x = (i % N) * C,
        y = Math.floor(i / N) * C;
      if (!B[i] && !seen[i] && x > EDGE && y > EDGE && x < GS() - EDGE - C && y < GS() - EDGE - C) out.push([x, y, C]);
    }
    return out;
  }

  // ================================================================== geometry on screen
  const LAMPBX = { iso_lamp: 0.28, p_lamp: 0.49, iso_lamp2: 0.49, iso_lamp3: 0.3 };
  // the picture's box in world screen px [x0, y0, x1, y1] and its sprite (as scene.js draws it: props bottom-centred on the front
  // corner, bushes on their foot, a tree's crown centred 0.38 of its width above its foot)
  function pic(k, it) {
    if (k === 'props') {
      const d = PROP[it[0]],
        a = A[propPic(it)],
        [x] = toS(it[1], it[2]),
        e = extent('props', it),
        fy = toS(e[2], e[3])[1],
        h = (d.w * a.h) / a.w;
      const lx = d.lamp ? (0.5 - (LAMPBX[it[0]] ?? 0.49)) * d.w * (it[3] & 1 ? -1 : 1) : 0;
      return [x + lx - d.w / 2, fy - h, x + lx + d.w / 2, fy];
    }
    if (k === 'trees') {
      const [x, y] = toS(it[1], it[2]),
        w = it[3],
        a = A[it[0]],
        h = (w * a.h) / a.w,
        cy = y - w * 0.38;
      return [x - w / 2, cy - h / 2, x + w / 2, cy + h / 2];
    }
    if (k === 'bushes') {
      const [x, y] = toS(it[1], it[2]),
        w = it[3],
        a = A[it[0]],
        h = (w * a.h) / a.w;
      return [x - w / 2, y - h, x + w / 2, y];
    }
    return null;
  }
  // a prop's picture: its back (<name>_b) turned 180° or 270° (dir 2, 3: sim.js level), where it has one
  const propPic = (it) => (it[3] & 2 && A[it[0] + '_b'] ? it[0] + '_b' : it[0]);
  const TURN = ['0°', '90°', '180°', '270°'];
  const picName = (k, it) =>
    k === 'decor' ? DECOR_IMG[it[0] === 'graf' ? (it[3] === 'p_graffiti2' ? 'graf2' : 'graf1') : it[0]] : it[0];
  // the topmost thing under a world screen point: the start, the trees (drawn last), the props and bushes by depth, decor, then the
  // smallest road or area under it
  function pick(wx, wy) {
    // a mission's mark: its pin (the stick and the head above the point)
    for (let i = map.marks.length - 1; i >= 0; i--) {
      const [sx, sy] = toS(map.marks[i][1], map.marks[i][2]);
      if (Math.abs(wx - sx) < 26 && wy > sy - 80 && wy < sy + 14) return { k: 'marks', i };
    }
    if (!LAB) {
      const [sx, sy] = toS(...map.spawn);
      if (Math.abs(wx - sx) < 30 && wy > sy - 90 && wy < sy + 12) return { k: 'spawn', i: 0 };
    }
    if (LAB)
      for (const k of ['starts', 'lights', 'posts']) {
        let bi = -1,
          bd = 1e9;
        map[k].forEach((q, i) => {
          const [x, y] = toS(q[0], q[1]),
            dd = Math.hypot(x - wx, (y - wy) * 2);
          if (dd < 44 && dd < bd) {
            bd = dd;
            bi = i;
          }
        });
        if (bi >= 0) return { k, i: bi };
      }
    const gx = toGx(wx, wy),
      gy = toGy(wx, wy),
      hitPic = (k, it) => {
        const b = pic(k, it);
        if (!b || wx < b[0] || wx > b[2] || wy < b[1] || wy > b[3]) return false;
        let u = (wx - b[0]) / (b[2] - b[0]);
        if (k === 'props' ? it[3] & 1 : it[4]) u = 1 - u;
        return opaque(k === 'props' ? propPic(it) : it[0], u, (wy - b[1]) / (b[3] - b[1]));
      };
    const cand = [];
    map.trees.forEach((t, i) => {
      if (hitPic('trees', t)) cand.push([1e6 + toS(t[1], t[2])[1], 'trees', i]);
    });
    map.props.forEach((p, i) => {
      if (hitPic('props', p)) cand.push([toS(p[1], p[2])[1], 'props', i]);
    });
    map.bushes.forEach((b, i) => {
      if (hitPic('bushes', b)) cand.push([toS(b[1], b[2])[1], 'bushes', i]);
    });
    if (cand.length) {
      cand.sort((a, b) => b[0] - a[0]);
      return { k: cand[0][1], i: cand[0][2] };
    }
    let best = null,
      bd = 1e9;
    map.decor.forEach((d, i) => {
      if (isMark(d)) {
        const e = extent('decor', d),
          q = Math.hypot(d[1] - gx, d[2] - gy);
        if (gx > e[0] && gx < e[2] && gy > e[1] && gy < e[3] && q < bd) {
          bd = q;
          best = { k: 'decor', i };
        }
        return;
      }
      const r = LAB
          ? d[0] === 'cable'
            ? 60
            : Math.max(30, Math.min(d[3], 200))
          : d[0] === 'graf'
            ? d[4] / 2
            : d[0] === 'stain'
              ? d[3]
              : 30,
        q = Math.hypot(d[1] - gx, d[2] - gy);
      if (q < r && q < bd) {
        bd = q;
        best = { k: 'decor', i };
      }
    });
    if (best) return best;
    let ba = 1e18;
    for (const k of LAB
      ? ['walls', 'floors']
      : OFFICE
        ? ['gates', 'zones', 'roads', 'areas', 'void']
        : ['roads', 'areas'])
      map[k].forEach((r, i) => {
        const e = k === 'roads' ? [r[0], r[1], r[2], r[3]] : r,
          a = (e[2] - e[0]) * (e[3] - e[1]);
        if (gx > e[0] && gx < e[2] && gy > e[1] && gy < e[3] && a < ba) {
          ba = a;
          best = { k, i };
        }
      });
    return best;
  }

  // ================================================================== the page around the game's canvas
  const css = document.createElement('style');
  css.textContent = `
body.ed { background: #0b0f17; }
body.ed canvas { inset: auto; margin: 0; aspect-ratio: auto; cursor: default; position: absolute; }
#edtop { position: absolute; left: 0; right: 0; top: 0; height: 44px; display: flex; gap: 6px; align-items: center; padding: 0 10px; background: #121a28; border-bottom: 1px solid #26324a; box-sizing: border-box; z-index: 5; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; }
#edtop button, #edside button { font: 600 13px var(--font); color: #e8eefc; background: #1d2a42; border: 1px solid #33456a; border-radius: 6px; padding: 6px 10px; cursor: pointer; white-space: nowrap; }
#edtop button:hover, #edside button:hover { background: #26375a; }
#edtop button.on { background: #e2600c; border-color: #ff9a2a; color: #fff; }
#edtop .sep { width: 1px; height: 26px; background: #2c3a56; margin: 0 4px; }
#edtop button.save { background: #1f6a3a; border-color: #2f9a55; }
#edtop button.save.dirty { background: #b3401a; border-color: #ff7a3a; }
#edside { position: absolute; left: 0; top: 44px; bottom: 28px; width: 280px; overflow-y: auto; background: #101724; border-right: 1px solid #26324a; box-sizing: border-box; padding: 8px; z-index: 5; }
#edside h3 { font: 700 13px var(--font); color: #ffd23a; margin: 10px 2px 6px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; }
#edside h3 label { font: 500 12px var(--font); color: #9fb0cf; cursor: pointer; }
#edside .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
#edside .grid.shut { display: none; }
#edside .it { background: #172236; border: 1px solid #26324a; border-radius: 6px; padding: 3px; cursor: pointer; text-align: center; }
#edside .it:hover { border-color: #5a78b0; }
#edside .it.on { border-color: #ff9a2a; background: #2a2416; }
#edside .it .th { height: 54px; display: flex; align-items: center; justify-content: center; }
#edside .it img { max-width: 76px; max-height: 54px; }
#edside .it span { display: block; font: 500 10.5px var(--font); color: #c9d4ea; line-height: 1.15; margin-top: 2px; }
#edprops { background: #172236; border: 1px solid #33456a; border-radius: 8px; padding: 8px; margin-bottom: 8px; font: 500 12.5px var(--font); color: #dfe7f7; }
#edprops b { color: #ffd23a; }
#edprops .marks { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
#edprops .marks button { text-align: left; }
#edprops .marks button.on { background: #e2600c; border-color: #ff9a2a; color: #fff; }
#edtop button.try { background: #6a3a8a; border-color: #9a5ac0; }
#edprops .row { display: flex; gap: 6px; align-items: center; margin-top: 6px; flex-wrap: wrap; }
#edprops input[type=range] { width: 130px; }
#edprops input[type=number], #edprops select { width: 70px; background: #0e1522; color: #fff; border: 1px solid #33456a; border-radius: 4px; padding: 3px; }
#edstat { position: absolute; left: 0; right: 0; bottom: 0; height: 28px; background: #121a28; border-top: 1px solid #26324a; font: 500 12.5px var(--font); color: #b9c6e0; display: flex; gap: 18px; align-items: center; padding: 0 12px; z-index: 5; }
#edstat .bad { color: #ff7a6a; cursor: pointer; text-decoration: underline dotted; }
#edstat .msg { color: #ffd23a; margin-left: auto; }
#edov { z-index: 1; }
#edmini { position: absolute; right: 12px; bottom: 40px; width: 300px; height: 150px; border: 1px solid #33456a; border-radius: 6px; background: #0c120c; z-index: 4; cursor: pointer; }
#edhelp { position: absolute; right: 12px; top: 54px; width: 300px; background: #101724ee; border: 1px solid #33456a; border-radius: 8px; padding: 10px 12px; font: 500 12px/1.5 var(--font); color: #cdd8ee; z-index: 6; display: none; }
#edhelp.on { display: block; }
#edhelp b { color: #ffd23a; }`;
  document.head.appendChild(css);
  document.body.classList.add('ed');
  for (const id of ['ui', 'fsbtn', 'dev', 'flash']) {
    const e = document.getElementById(id);
    if (e) e.style.display = 'none';
  }
  const el = (tag, attrs = {}, html = '') => {
    const e = document.createElement(tag);
    Object.assign(e, attrs);
    if (html) e.innerHTML = html;
    return e;
  };
  const top = el('div', { id: 'edtop' }),
    side = el('div', { id: 'edside' }),
    stat = el('div', { id: 'edstat' }),
    mini = el('canvas', { id: 'edmini', width: 600, height: 300 });
  const ov = el('canvas', { id: 'edov' }),
    help = el(
      'div',
      { id: 'edhelp' },
      `
<b>Мышь</b><br>левая кнопка: выбрать, тащить; по пустому месту: выделить рамкой (Shift добавляет)<br>правая или средняя кнопка, пробел + левая: двигать вид<br>колесо: масштаб<br>
<b>Клавиши</b><br>V выбор · R дорога · T плитка · P площадь · B земля · S старт<br>Delete удалить · F отразить · ${LAB ? 'R' : 'кнопка «Повернуть»'}: повернуть предмет на 90° (180°: его задняя сторона) · Q / E меньше / больше (деревья, кусты)<br>
стрелки: сдвинуть выбранное (без выбора: двигать вид)<br>Ctrl+C / Ctrl+V копировать / вставить у курсора · Ctrl+D дубль<br>Ctrl+Z / Ctrl+Y отменить / вернуть · Ctrl+S сохранить<br>
G сетка 10 · H контуры объектов · Esc: обратно к выбору<br><b>Деревья и кусты</b>: зажми и веди мышь, они сажаются рядами («микс»: разные виды)<br>
<b>Дорога</b>: тяни по диагонали экрана, тротуары по 70 с обеих сторон<br><b>Покрытие</b>: тяни от угла к углу ромба<br><b>Красным</b> отмечено то, что стоит друг в друге`,
    );
  document.body.append(top, side, stat, mini, ov, help);

  const TOOLS = LAB
    ? [
        ['select', 'Выбор', 'V'],
        ['wall', 'Стена', 'W'],
        ['post', 'Столб', 'O'],
        ['floor', 'Пол', 'T'],
        ['light', 'Свет', 'L'],
        ['start', 'Старт', 'S'],
        ['mark', 'Точки', 'M'],
      ]
    : [
        ['select', 'Выбор', 'V'],
        ['road', 'Дорога', 'R'],
        ['area:tiles', 'Плитка', 'T'],
        ['area:plaza', 'Площадь', 'P'],
        ['area:dirt', 'Земля', 'B'],
        ['spawn', 'Старт', 'S'],
        ['mark', 'Точки', 'M'],
        ...(OFFICE
          ? [
              ['area:floor', 'Пол', 'O'],
              ['void', 'Пустота', 'X'],
              ['gate', 'Ворота', 'Y'],
            ]
          : []),
      ];
  const btn = (t, f, cls = '') => {
    const b = el('button', { textContent: t, className: cls });
    b.onclick = f;
    return b;
  };
  const toolBtns = TOOLS.map(([id, t, key]) => {
    const b = btn(`${t} (${key})`, () => setTool(id));
    b.dataset.tool = id;
    return b;
  });
  const snapBtn = btn('', () => {
      snap = !snap;
      bar();
    }),
    footBtn = btn('', () => {
      foot = !foot;
      bar();
    });
  const saveBtn = btn('Сохранить', () => save(), 'save');
  top.append(
    ...toolBtns,
    el('div', { className: 'sep' }),
    btn('↶ Отменить', () => history(undo, redo)),
    btn('↷ Вернуть', () => history(redo, undo)),
    el('div', { className: 'sep' }),
    snapBtn,
    footBtn,
    el('div', { className: 'sep' }),
    btn('−', () => zoomAt(-1, W / 2, H / 2)),
    btn('+', () => zoomAt(1, W / 2, H / 2)),
    el('div', { className: 'sep' }),
    btn(MAPID === 'city' ? '● Город' : 'Город', () => goMap('city'), MAPID === 'city' ? 'on' : ''),
    btn(LAB ? '● Лаборатория' : 'Лаборатория', () => goMap('lab'), LAB ? 'on' : ''),
    btn(MAPID === 'office' ? '● Офис: улица' : 'Офис: улица', () => goMap('office'), MAPID === 'office' ? 'on' : ''),
    btn(OFFICE_IN ? '● Офис: внутри' : 'Офис: внутри', () => goMap('office_in'), OFFICE_IN ? 'on' : ''),
    btn(BASE ? '● База' : 'База', () => goMap('base'), BASE ? 'on' : ''),
    el('div', { className: 'sep' }),
    LAB || OFFICE
      ? el('span')
      : btn('Новая карта', () => {
          if (!confirm('Начать с пустой карты? Вернуть старую можно кнопкой «Отменить».')) return;
          const b = snapshot();
          map = blank();
          sel = [];
          commit(b, null);
          panel();
        }),
    // every tree and bush off this map at once (the town's kind of maps; undone as any change)
    LAB
      ? el('span')
      : btn('Убрать растения', () => {
          if (!map.trees.length && !map.bushes.length) {
            say('На карте нет деревьев и кустов');
            return;
          }
          if (
            !confirm(
              `Убрать с карты все деревья (${map.trees.length}) и кусты (${map.bushes.length})? Вернуть можно кнопкой «Отменить».`,
            )
          )
            return;
          const b = snapshot();
          map.trees = [];
          map.bushes = [];
          sel = sel.filter((s) => s.k !== 'trees' && s.k !== 'bushes');
          commit(b, null);
          panel();
          say('Растения убраны. Не забудь сохранить');
        }),
    btn('Вернуть сохранённую', () => {
      if (!confirm('Отменить все несохранённые изменения?')) return;
      const b = snapshot();
      map = JSON.parse(saved);
      sel = [];
      commit(b, null);
      panel();
    }),
    saveBtn,
    // (the office: its mission's button is how to play it)
    OFFICE
      ? el('span')
      : btn('Играть ▶', async () => {
          if (await save()) {
            try {
              localStorage.setItem('md.map', LAB ? 'lab' : 'suburb');
            } catch (e) {}
            window.open('/live/index.html?autoplay=1', '_blank');
          }
        }),
    ...MIS.map((m) => btn('Миссия ' + m.n + ' ▶', () => tryMission(m), 'try')),
    btn('?', () => help.classList.toggle('on')),
  );
  // a mission tried at once on the map as saved: its script on its marks, whatever the save says (index.html
  // ?mission, a local page only), no lobby (mission 1: its intro first, as PLAY plays it)
  async function tryMission(m) {
    const gap = missing();
    if (
      gap &&
      !confirm('Точка «' + markName(gap) + '» не поставлена: это место будет на старте карты. Всё равно играть?')
    )
      return;
    if (!(await save())) return;
    window.open('/live/index.html?autoplay=1&mission=' + m.id, '_blank');
  }
  function bar() {
    for (const b of toolBtns)
      b.classList.toggle('on', b.dataset.tool === (tool.t === 'area' ? 'area:' + tool.mat : tool.t));
    snapBtn.textContent = 'Сетка: ' + (snap ? 'да' : 'нет') + ' (G)';
    footBtn.textContent = 'Контуры: ' + (foot ? 'да' : 'нет') + ' (H)';
    saveBtn.classList.toggle('dirty', snapshot() !== saved);
  }
  // the other map (what isn't saved stays as its draft, offered when the editor opens it again)
  function goMap(id) {
    if (id === MAPID) return;
    if (snapshot() !== saved)
      try {
        localStorage.setItem(DRAFT, JSON.stringify({ t: Date.now(), map }));
      } catch (e) {}
    location.search = id === 'city' ? '?editor' : '?editor&map=' + id;
  }
  function setTool(id) {
    tool = id.startsWith('area:')
      ? { t: 'area', mat: id.slice(5) }
      : id === 'floor'
        ? { t: 'floor', kind: floorKind }
        : id === 'light'
          ? { t: 'light', tint: lightTint }
          : id === 'mark'
            ? { t: 'mark', n: missing() || NEED[0] || null }
            : { t: id };
    for (const e of side.querySelectorAll('.it.on')) e.classList.remove('on');
    bar();
    panel();
  }

  // the palette: one section per kind, a picture and a name per item; a tree or bush section can mix its kinds
  const props = el('div', { id: 'edprops' });
  side.append(props);
  for (const c of CATS) {
    const h = el('h3', {}, `<span>${c.t}</span>`),
      grid = el('div', { className: 'grid' });
    if (c.mix) {
      const l = el('label', {}, '<input type="checkbox"> микс');
      l.onclick = (e) => e.stopPropagation();
      c.mixBox = l.querySelector('input');
      h.append(l);
    } else if (c.k === 'props') {
      const l = el(
        'label',
        { title: 'каждый поставленный предмет повёрнут случайно' },
        '<input type="checkbox"> вперемешку',
      );
      l.onclick = (e) => e.stopPropagation();
      c.turnBox = l.querySelector('input');
      h.append(l);
    }
    h.onclick = () => grid.classList.toggle('shut');
    for (const n of c.list) {
      const it = el('div', { className: 'it', title: n }),
        th = el('div', { className: 'th' });
      if (c.k === 'decor' && LAB) {
        const t = el('canvas', { width: 60, height: 40 }),
          g = t.getContext('2d');
        g.fillStyle = LABDEC_C[n];
        if (n === 'cable' || n === 'stripe') {
          g.save();
          g.translate(30, 20);
          g.rotate(-0.45);
          g.fillRect(-26, -4, 52, 8);
          g.restore();
        } else {
          g.beginPath();
          g.ellipse(30, 20, 22, 11, 0, 0, 7);
          g.fill();
        }
        th.append(el('img', { src: t.toDataURL() }));
      } else if (c.k === 'decor' && (MARKN[n] || n === 'zone')) {
        th.append(el('img', { src: markThumb(n) }));
      } else if (c.k === 'decor' && !DECOR_IMG[n]) {
        const t = el('canvas', { width: 60, height: 40 }),
          g = t.getContext('2d');
        g.fillStyle = n === 'manhole' ? '#25242a' : 'rgba(8,6,14,0.55)';
        g.strokeStyle = '#6e6a70';
        g.lineWidth = 3;
        g.beginPath();
        g.ellipse(30, 20, 22, n === 'manhole' ? 13 : 10, 0, 0, 7);
        g.fill();
        if (n === 'manhole') g.stroke();
        th.append(el('img', { src: t.toDataURL() }));
      } else th.append(el('img', { src: img(DECOR_IMG[n] || n).src }));
      it.append(th, el('span', { textContent: NAMES[n] || n }));
      it.onclick = () => {
        if (n === 'zone') {
          setTool('zone');
          it.classList.add('on');
          return;
        }
        tool = { t: 'place', k: c.k, n, flip: 0, size: 1, cat: c };
        for (const e of side.querySelectorAll('.it.on')) e.classList.remove('on');
        it.classList.add('on');
        bar();
        panel();
      };
      grid.append(it);
    }
    side.append(h, grid);
  }
  for (const n of [
    ...TREES,
    ...Object.keys(BUSHK),
    'p_graffiti1',
    'p_graffiti2',
    'p_daisy',
    ...Object.keys(PROP),
    ...Object.keys(PROP)
      .filter((n) => A[n + '_b'])
      .map((n) => n + '_b'),
  ])
    img(n);

  // what is selected and what can be changed about it
  function panel() {
    const one = sel.length === 1 ? sel[0] : null,
      it = one && itemOf(one);
    let h = '';
    if (tool.t === 'place')
      h = `<b>Ставлю: ${esc(NAMES[tool.n] || tool.n)}</b><br>клик: поставить${tool.k === 'trees' || tool.k === 'bushes' ? ', зажать и вести: сажать рядом' : ''}<br>${tool.k === 'props' ? `${LAB ? 'R' : 'кнопка'} повернуть (сейчас ${TURN[tool.flip & 3]}), ` : ''}F отразить${tool.k === 'trees' || tool.k === 'bushes' ? ', Q / E размер ×' + tool.size.toFixed(1) : ''} · Esc или правая кнопка: хватит`;
    else if (tool.t === 'road')
      h =
        '<b>Дорога</b><br>протяни мышью по диагонали экрана, как идут улицы: ширина 240, тротуары по 70 (потом можно поменять)';
    else if (tool.t === 'area')
      h = `<b>${MATS[tool.mat]}</b><br>протяни мышью от одного угла ромба к другому: сверху вниз получится квадрат`;
    else if (tool.t === 'spawn') h = '<b>Старт</b><br>кликни туда, где появляется герой';
    else if (tool.t === 'void')
      h =
        '<b>Пустота</b><br>протяни от угла к углу: туда нельзя зайти и там не появляются зомби, в игре её не видно (лес и скалы рисуй поверх)';
    else if (tool.t === 'zone')
      h =
        '<b>Зона</b><br>протяни от угла к углу: жёлтый пунктирный прямоугольник на полу. Потом его можно двигать и тянуть за углы';
    else if (tool.t === 'gate')
      h = `<b>Ворота</b><br>протяни от угла к углу: невидимая стена, пока миссия её не откроет. Потом дай ей имя${GATES.length ? '<br>миссия открывает: ' + GATES.map((n) => (map.gates.some((q) => q[4] === n) ? '✓ ' : '○ ') + esc(n)).join(', ') : ''}`;
    else if (tool.t === 'wall')
      h =
        '<b>Стена</b><br>протяни мышью вдоль будущей стены (по диагонали экрана), толщина 40. Проход — разрыв между стенами; по его краям поставь столбы (O) с галочкой «дверь»';
    else if (tool.t === 'post')
      h = '<b>Столб</b><br>клик: поставить. На краях прохода отметь «дверь»: будут жёлто-чёрные полосы и порог';
    else if (tool.t === 'floor')
      h = `<b>Пол комнаты</b><br>протяни от угла к углу комнаты<div class="row">вид <select data-a="tfk">${opts(FLOORS, tool.kind)}</select></div><br>Зал один: в нём ждёт финальный босс, все остальные комнаты заполняет газ`;
    else if (tool.t === 'light')
      h = `<b>Свет</b><br>клик: лампа под потолком<div class="row">цвет <select data-a="tlt">${opts(TINTS, tool.tint)}</select></div>`;
    else if (tool.t === 'start')
      h = '<b>Старт</b><br>клик: ещё одно место, где может начаться забег (каждый раз выбирается случайно)';
    else if (tool.t === 'mark')
      h = NEED.length
        ? `<b>Точки миссии ${MIS.map((m) => m.n).join(', ')}</b><br>выбери точку и кликни по карте: она встанет туда или переедет. В «Выборе» точки можно таскать мышью<div class="marks">${NEED.map(
            (n) =>
              `<button data-a="mk" data-n="${n}" class="${tool.n === n ? 'on' : ''}">${map.marks.some((q) => q[0] === n) ? '✓' : '○'} ${esc(markName(n))}</button>`,
          ).join('')}${map.marks
            .filter((q) => !NEED.includes(q[0]))
            .map((q) => `<button data-a="mkdel" data-n="${q[0]}">✕ лишняя: ${esc(markName(q[0]))}</button>`)
            .join(
              '',
            )}</div>${MIS.map((m) => `<button data-a="mktry" data-n="${m.id}">Проверить миссию ${m.n} ▶</button>`).join('')}`
        : '<b>Точки</b><br>на этой карте нет миссии со своими точками';
    else if (!sel.length) h = 'Ничего не выбрано. Выбери предмет слева или кликни по карте.';
    else if (!one)
      h = `<b>Выбрано: ${sel.length}</b><div class="row">${sel.some((s) => s.k === 'props') ? `<button data-a="turn">Повернуть${LAB ? ' (R)' : ''}</button><button data-a="shuffle" title="каждый выбранный предмет повернуть случайно">Вперемешку</button>` : ''}<button data-a="flip">Отразить (F)</button><button data-a="del">Удалить (Del)</button></div>`;
    else if (one.k === 'marks')
      h = `<b>Точка: ${esc(markName(it[0]))}</b>${NEED.includes(it[0]) ? '' : ' (ни одна миссия её не просит)'}<br>gx ${it[1]}, gy ${it[2]}<br>тяни мышью или стрелками<div class="row"><button data-a="del">Удалить</button></div>`;
    else if (one.k === 'void')
      h = `<b>Пустота</b> ${it[2] - it[0]} × ${it[3] - it[1]}<br>сюда нельзя зайти, в игре её не видно. Тяни за углы<div class="row"><button data-a="del">Удалить</button></div>`;
    else if (one.k === 'zones')
      h = `<b>Зона</b> ${it[2] - it[0]} × ${it[3] - it[1]}<br>жёлтый пунктир на полу. Тяни за углы, чтобы изменить размер<div class="row"><button data-a="del">Удалить</button></div>`;
    else if (one.k === 'gates')
      h = `<b>Ворота «${esc(it[4])}»</b> ${it[2] - it[0]} × ${it[3] - it[1]}${GATES.includes(it[4]) ? '' : ' (миссия такие не открывает)'}<br>невидимая стена, пока миссия её не откроет. Тяни за углы<div class="row">имя <input type="text" data-a="gname" value="${esc(it[4])}" style="width:130px"><button data-a="del">Удалить</button></div>`;
    else if (one.k === 'walls')
      h = `<b>Стена</b> ${it[2] - it[0]} × ${it[3] - it[1]}<br>тяни за углы, чтобы изменить<div class="row"><button data-a="del">Удалить</button></div>`;
    else if (one.k === 'floors')
      h = `<b>Пол</b> ${it[2] - it[0]} × ${it[3] - it[1]}<br>тяни за углы<div class="row">вид <select data-a="fk">${opts(FLOORS, it[4])}</select><button data-a="del">Удалить</button></div>`;
    else if (one.k === 'posts')
      h = `<b>Столб</b><br>gx ${it[0]}, gy ${it[1]}<div class="row"><label><input type="checkbox" data-a="door" ${it[2] ? 'checked' : ''}> дверь (полосы)</label><button data-a="del">Удалить</button></div>`;
    else if (one.k === 'lights')
      h = `<b>Свет</b><div class="row">радиус <input type="range" min="100" max="900" step="10" value="${it[2]}" data-a="lr"><span>${it[2]}</span></div><div class="row">цвет <select data-a="lt">${opts(TINTS, it[3])}</select><button data-a="del">Удалить</button></div>`;
    else if (one.k === 'starts')
      h = `<b>Старт ${one.i + 1}</b> из ${map.starts.length}<br>gx ${it[0]}, gy ${it[1]}<div class="row"><button data-a="del">Удалить</button></div>`;
    else if (one.k === 'decor' && LAB)
      h = `<b>${esc(NAMES[it[0]] || it[0])}</b><div class="row">размер <input type="range" min="1" max="${it[0] === 'cable' || it[0] === 'stripe' ? 900 : 300}" step="1" value="${it[3]}" data-a="dsz"><span>${it[3]}</span></div><div class="row">поворот <input type="range" min="0" max="628" step="1" value="${Math.round((it[4] || 0) * 100)}" data-a="dang"></div><div class="row"><button data-a="flip">Повернуть (F)</button><button data-a="del">Удалить</button></div>`;
    else if (one.k === 'props')
      h = `<b>${esc(NAMES[it[0]] || it[0])}</b><br>gx ${it[1]}, gy ${it[2]} · поворот ${TURN[it[3] & 3]}${A[it[0] + '_b'] ? '' : ' (сзади как спереди)'}<div class="row"><button data-a="turn">Повернуть${LAB ? ' (R)' : ''}</button><button data-a="flip">Отразить (F)</button><button data-a="del">Удалить</button></div>`;
    else if (one.k === 'trees' || one.k === 'bushes')
      h = `<b>${esc(NAMES[it[0]] || it[0])}</b><br>gx ${it[1]}, gy ${it[2]}<div class="row">размер <input type="range" min="20" max="600" step="5" value="${it[3]}" data-a="w"> <span>${it[3]}</span></div><div class="row"><button data-a="flip">Отразить</button><button data-a="del">Удалить</button></div>`;
    else if (one.k === 'decor' && isMark(it)) h = markPanel(it);
    else if (one.k === 'decor')
      h = `<b>${NAMES[it[0] === 'graf' ? (it[3] === 'p_graffiti2' ? 'graf2' : 'graf1') : it[0]]}</b><div class="row"><button data-a="del">Удалить</button></div>`;
    else if (one.k === 'roads')
      h = `<b>Дорога</b> ${it[2] - it[0]} × ${it[3] - it[1]}<br>тяни за углы, чтобы изменить<div class="row">тротуар <input type="number" min="0" max="300" step="10" value="${it[4]}" data-a="walk"></div><div class="row"><button data-a="del">Удалить</button></div>`;
    else if (one.k === 'areas')
      h = `<b>Покрытие</b> ${it[2] - it[0]} × ${it[3] - it[1]}<br>тяни за углы, чтобы изменить<div class="row"><select data-a="mat">${Object.entries(
        MATS,
      )
        .map(([k, t]) => `<option value="${k}"${it[4] === k ? ' selected' : ''}>${t}</option>`)
        .join('')}</select><button data-a="del">Удалить</button></div>`;
    else if (one.k === 'spawn') h = `<b>Старт героя</b><br>gx ${it[0]}, gy ${it[1]}`;
    props.innerHTML = h;
    for (const e of props.querySelectorAll('[data-a]')) {
      const a = e.dataset.a;
      if (a === 'flip') e.onclick = () => flip();
      else if (a === 'gname')
        e.onchange = () => {
          // (the name the mission's script opens it by: latin, digits, _, each gate its own)
          const v = e.value.trim().toLowerCase();
          if (!/^[a-z][a-z0-9_]{0,23}$/.test(v) || map.gates.some((q) => q !== it && q[4] === v)) {
            say('Имя ворот: латиница, цифры и _, как в сценарии миссии, и не занятое', 5000);
            e.value = it[4];
            return;
          }
          const b0 = snapshot();
          it[4] = v;
          commit(b0, []);
          panel();
        };
      else if (a === 'mk')
        e.onclick = () => {
          tool.n = e.dataset.n;
          const i = map.marks.findIndex((q) => q[0] === tool.n);
          if (i >= 0) {
            // (already on the map: shown in the middle of the view)
            const [x, y] = toS(map.marks[i][1], map.marks[i][2]);
            cam = [x - W / 2 / zoom, y - H / 2 / zoom];
          }
          panel();
        };
      else if (a === 'mkdel')
        e.onclick = () => {
          const b0 = snapshot(),
            i = map.marks.findIndex((q) => q[0] === e.dataset.n);
          if (i < 0) return;
          const r = extent('marks', map.marks[i]);
          map.marks.splice(i, 1);
          sel = [];
          commit(b0, [r]);
          panel();
        };
      else if (a === 'mktry') e.onclick = () => tryMission(MIS.find((m) => m.id === e.dataset.n));
      else if (a === 'turn') e.onclick = () => turn();
      else if (a === 'shuffle') e.onclick = () => turn(true);
      else if (a === 'del') e.onclick = () => del();
      else if (a === 'msz' || a === 'msz2') {
        // a marking's size: the ground under it before and after is painted again
        let b0 = null,
          r0 = null;
        e.oninput = () => {
          if (b0 === null) {
            b0 = snapshot();
            r0 = extent(one.k, it);
          }
          it[a === 'msz' ? 3 : 4] = +e.value;
          e.nextElementSibling.textContent = e.value;
          SIM.setMap(map, MAPID);
          LV = SIM.level(SEED);
        };
        e.onchange = () => {
          commit(b0, [r0, extent(one.k, it)]);
          b0 = null;
          panel();
        };
      } else if (a === 'mcol')
        e.onclick = () => {
          const b = snapshot();
          it[5] = it[5] ? 0 : 1;
          commit(b, [extent(one.k, it)]);
          panel();
        };
      else if (a === 'w') {
        let b0 = null;
        e.oninput = () => {
          if (b0 === null) b0 = snapshot();
          it[3] = +e.value;
          e.nextElementSibling.textContent = e.value;
          SIM.setMap(map, MAPID);
          LV = SIM.level(SEED);
        };
        e.onchange = () => {
          const r = extent(one.k, it);
          commit(b0, [r]);
          b0 = null;
        };
      } else if (a === 'walk')
        e.onchange = () => {
          const b = snapshot(),
            r0 = extent('roads', it);
          it[4] = clamp(Math.round(+e.value || 0), 0, 300);
          commit(b, [r0, extent('roads', it)]);
        };
      else if (a === 'mat')
        e.onchange = () => {
          const b = snapshot();
          it[4] = e.value;
          commit(b, [extent('areas', it)]);
        };
      else if (a === 'tfk')
        e.onchange = () => {
          floorKind = tool.kind = e.value;
        };
      else if (a === 'tlt')
        e.onchange = () => {
          lightTint = tool.tint = e.value;
        };
      else if (a === 'fk')
        e.onchange = () => {
          const b = snapshot();
          it[4] = e.value;
          commit(b, [extent('floors', it)]);
        };
      else if (a === 'door')
        e.onchange = () => {
          const b = snapshot();
          it[2] = e.checked ? 1 : 0;
          commit(b, [extent('posts', it)]);
        };
      else if (a === 'lt')
        e.onchange = () => {
          const b = snapshot();
          it[3] = e.value;
          commit(b, []);
        };
      else if (a === 'lr' || a === 'dsz' || a === 'dang') {
        let b0 = null;
        e.oninput = () => {
          if (b0 === null) b0 = snapshot();
          const v = +e.value;
          if (a === 'lr') it[2] = v;
          else if (a === 'dsz') it[3] = v;
          else it[4] = v / 100;
          if (e.nextElementSibling && e.nextElementSibling.tagName === 'SPAN')
            e.nextElementSibling.textContent = e.value;
          if (a !== 'lr') {
            SIM.setMap(map, MAPID);
            LV = SIM.level(SEED);
          }
        };
        e.onchange = () => {
          commit(b0, a === 'lr' ? [] : [extent(one.k, it)]);
          b0 = null;
        };
      }
    }
    bar();
  }
  // a selected floor marking's panel: its size (a hatch: both sides), turn, paint
  function markPanel(it) {
    const k = it[0],
      max = {
        line: 2000,
        dash: 2400,
        stalls: 2400,
        zebra: 1200,
        stripe: 2000,
        arrow: 600,
        park: 600,
        logo: 900,
        hatch: 1600,
      }[k],
      word =
        k === 'hatch' ? 'ширина' : k === 'stalls' ? 'длина ряда' : /^(arrow|park|logo)$/.test(k) ? 'размер' : 'длина',
      range = (a, v) =>
        `<input type="range" min="40" max="${max}" step="10" value="${v}" data-a="${a}"><span>${v}</span>`;
    return (
      `<b>${esc(paintName(it))}</b>${k === 'stalls' ? ` · мест: ${Math.max(1, Math.round(it[3] / 150))}` : ''}` +
      `<div class="row">${word} ${range('msz', it[3])}</div>` +
      (k === 'hatch' ? `<div class="row">глубина ${range('msz2', it[4])}</div>` : '') +
      `<div class="row">${k === 'logo' ? '' : '<button data-a="flip">Повернуть (F)</button>'}` +
      (SIM.MARKINGS[k] > 0 && k !== 'stripe'
        ? `<button data-a="mcol">${it[5] ? 'Сделать белой' : 'Сделать жёлтой'}</button>`
        : '') +
      `<button data-a="del">Удалить</button></div>`
    );
  }
  function del() {
    if (!sel.length) return;
    const b = snapshot(),
      rects = sel.filter((s) => s.k !== 'spawn').map((s) => extent(s.k, itemOf(s)));
    for (const k of [
      'props',
      'trees',
      'bushes',
      'decor',
      'roads',
      'areas',
      'walls',
      'floors',
      'posts',
      'lights',
      'starts',
      'marks',
      'void',
      'gates',
      'zones',
    ]) {
      const gone = new Set(sel.filter((s) => s.k === k).map((s) => s.i));
      if (gone.size) map[k] = map[k].filter((_, i) => !gone.has(i));
    }
    sel = [];
    commit(b, rects);
    panel();
  }
  function flip() {
    if (tool.t === 'place') {
      tool.flip =
        tool.k === 'decor' && MARKN[tool.n] && SIM.MARKINGS[MARKN[tool.n][0]] === 3
          ? (tool.flip + 1) & 3
          : tool.flip ^ 1;
      panel();
      return;
    }
    const b = snapshot(),
      rects = [];
    for (const s of sel) {
      const it = itemOf(s);
      if (s.k === 'props') {
        rects.push(extent('props', it));
        it[3] = it[3] ^ 1;
        rects.push(extent('props', it));
      } else if (s.k === 'trees' || s.k === 'bushes') {
        it[4] = it[4] ? 0 : 1;
        rects.push(extent(s.k, it));
      } else if (s.k === 'decor' && LAB) {
        it[4] = Math.round((((it[4] || 0) + Math.PI / 2) % (Math.PI * 2)) * 100) / 100;
        rects.push(extent('decor', it));
      } else if (s.k === 'decor' && isMark(it) && it[0] !== 'logo') {
        rects.push(extent('decor', it));
        if (it[0] === 'hatch') [it[3], it[4]] = [it[4], it[3]];
        else it[4] = SIM.MARKINGS[it[0]] === 3 ? (it[4] + 1) & 3 : it[4] ^ 1;
        rects.push(extent('decor', it));
      }
    }
    commit(b, rects);
    panel();
  }
  // a prop turned a quarter about its own axis (R): 0 → 90° (mirrored) → 180° (its back) → 270°; rnd: each selected one at random
  function turn(rnd = false) {
    if (tool.t === 'place') {
      if (tool.k === 'props') {
        tool.flip = (tool.flip + 1) & 3;
        panel();
      }
      return;
    }
    const b = snapshot(),
      rects = [];
    for (const s of sel)
      if (s.k === 'props') {
        const it = itemOf(s);
        rects.push(extent('props', it));
        it[3] = rnd ? Math.floor(Math.random() * 4) : ((it[3] | 0) + 1) & 3;
        rects.push(extent('props', it));
      }
    if (rects.length) {
      commit(b, rects);
      panel();
    }
  }
  function resize(f) {
    if (tool.t === 'place') {
      tool.size = clamp(Math.round(tool.size * f * 10) / 10, 0.3, 3);
      panel();
      return;
    }
    const b = snapshot(),
      rects = [];
    for (const s of sel)
      if (s.k === 'trees' || s.k === 'bushes') {
        const it = itemOf(s);
        it[3] = clamp(Math.round(it[3] * f), 20, 1500);
        rects.push(extent(s.k, it));
      }
    if (rects.length) {
      commit(b, rects);
      panel();
    }
  }
  // an item for the place tool at a ground point (a tree or bush section on "mix": a kind picked at random, a little bigger or smaller)
  function make(gx, gy, rand = true) {
    const t = tool,
      mix = rand && t.cat && t.cat.mixBox && t.cat.mixBox.checked,
      n = mix ? t.cat.list[Math.floor(Math.random() * t.cat.list.length)] : t.n;
    if (LAB && t.k === 'decor')
      return [
        n,
        gx,
        gy,
        LABDEC_S[n],
        rand && (n === 'cable' || n === 'stain' || n === 'blood') ? Math.round(Math.random() * 628) / 100 : 0,
      ];
    const f = mix ? (Math.random() < 0.5 ? 1 : 0) : t.flip,
      s = t.size * (mix ? 0.85 + Math.random() * 0.3 : 1);
    if (t.k === 'props')
      return [
        n,
        gx,
        gy,
        rand && t.cat && t.cat.turnBox && t.cat.turnBox.checked ? Math.floor(Math.random() * 4) : t.flip,
      ];
    if (t.k === 'trees') return [n, gx, gy, Math.round(270 * s), f];
    if (t.k === 'bushes') return [n, gx, gy, Math.round(95 * BUSHK[n] * s), f];
    if (MARKN[n]) return markOf(n, gx, gy, t.flip);
    if (n === 'manhole') return ['manhole', gx, gy];
    if (n === 'stain') return ['stain', gx, gy, 55, rand ? Math.round(Math.random() * 300) / 100 : 0];
    if (n === 'flower') return ['flower', gx, gy, 40];
    return ['graf', gx, gy, n === 'graf2' ? 'p_graffiti2' : 'p_graffiti1', 115, 0];
  }

  // ================================================================== save, play
  async function save() {
    try {
      const r = await fetch('/api/editor/map', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ map, id: MAPID }),
      });
      if (r.status === 404 || r.status === 405 || r.status === 401)
        throw new Error(
          'этот сервер не сохраняет карты: открой редактор через map-editor.bat (черновик остался в браузере)',
        );
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      saved = snapshot();
      try {
        localStorage.removeItem(DRAFT);
      } catch (e) {}
      say(
        LAB
          ? 'Сохранено в live/map_lab.js'
          : BASE
            ? 'Сохранено в live/map_base.js'
            : OFFICE_IN
              ? 'Сохранено в live/map_office_in.js'
              : OFFICE
                ? 'Сохранено в live/map_office.js'
                : 'Сохранено в live/map.js',
      );
      bar();
      return true;
    } catch (e) {
      say('Не сохранилось: ' + e.message, 8000);
      alert('Карта НЕ сохранилась:\n' + e.message + '\n\nЧерновик остался в браузере.');
      return false;
    }
  }
  let msg = '',
    msgT = 0;
  const say = (m, ms = 3000) => {
    msg = m;
    msgT = performance.now() + ms;
    status();
  };
  let cursorG = [0, 0],
    probI = 0;
  function status() {
    const p = probs || { n: 0 };
    stat.innerHTML =
      `<span>gx ${Math.round(cursorG[0])} · gy ${Math.round(cursorG[1])}</span><span>${LAB ? `стен ${map.walls.length} · комнат ${map.floors.length} · предметов ${map.props.length} · ламп ${map.lights.length} · стартов ${map.starts.length}` : `предметов ${map.props.length} · деревьев ${map.trees.length} · кустов ${map.bushes.length} · дорог ${map.roads.length} · покрытий ${map.areas.length}${OFFICE ? ` · пустот ${map.void.length} · ворот ${map.gates.length}` : ''}`}</span>` +
      `<span class="${p.n ? 'bad' : ''}" id="edprob">${p.n ? 'проблем: ' + p.n + (p.spawn ? ' (старт в предмете!)' : '') + (p.starts && p.starts.length ? ' (старт занят: ' + p.starts.length + ')' : '') + (p.shut && p.shut.length ? ' (отрезанный пол!)' : '') + (p.nohall ? ' (нет пола «Зал»: там ждёт босс)' : '') + (p.marks && p.marks.length ? ' (точка миссии в предмете)' : '') + ' → показать' : 'проблем нет'}</span><span class="msg">${performance.now() < msgT ? msg : snapshot() !== saved ? '● не сохранено' : ''}</span>`;
    const pb = document.getElementById('edprob');
    if (pb && p.n)
      pb.onclick = () => {
        // the camera goes to the next problem
        const all = [
          ...[...p.props].map((i) => ({ k: 'props', i })),
          ...p.plants,
          ...(p.spawn ? [{ k: 'spawn', i: 0 }] : []),
          ...(p.starts || []).map((i) => ({ k: 'starts', i })),
          ...(p.marks || []).map((i) => ({ k: 'marks', i })),
          ...(p.shut && p.shut.length ? [{ k: 'shut', i: 0 }] : []),
        ];
        if (!all.length) return;
        const s = all[probI++ % all.length];
        if (s.k === 'shut') {
          const [x, y] = toS(p.shut[0][0], p.shut[0][1]);
          cam = [x - W / zoom / 2, y - H / zoom / 2];
          return;
        }
        const it = itemOf(s),
          [x, y] = POINT[s.k] ? toS(it[0], it[1]) : toS(it[1], it[2]);
        cam = [x - W / zoom / 2, y - H / zoom / 2];
        sel = [s];
        panel();
      };
  }

  // ================================================================== view, mouse, keys
  function layout() {
    const L = 280,
      T = 44,
      B = 28,
      aw = innerWidth - L,
      ah = innerHeight - T - B,
      k = Math.min(aw / W, ah / H),
      w = Math.floor(W * k),
      h = Math.floor(H * k);
    for (const c of [cv, ov])
      Object.assign(c.style, {
        left: L + Math.floor((aw - w) / 2) + 'px',
        top: T + Math.floor((ah - h) / 2) + 'px',
        width: w + 'px',
        height: h + 'px',
      });
    const d = devicePixelRatio || 1;
    ov.width = Math.round(w * d);
    ov.height = Math.round(h * d);
  }
  addEventListener('resize', layout);
  layout();
  const view = (e) => {
    const r = ov.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };
  const world = (v) => [cam[0] + v[0] / zoom, cam[1] + v[1] / zoom];
  const gnd = (w) => [toGx(w[0], w[1]), toGy(w[0], w[1])];
  function zoomAt(dir, vx, vy) {
    const i = clamp(ZOOMS.indexOf(zoom) + dir, 0, ZOOMS.length - 1),
      z = ZOOMS[i];
    if (z === zoom) return;
    const w = world([vx, vy]);
    zoom = z;
    cam = [w[0] - vx / z, w[1] - vy / z];
  }
  ov.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const v = view(e);
      zoomAt(e.deltaY < 0 ? 1 : -1, v[0], v[1]);
    },
    { passive: false },
  );
  ov.addEventListener('contextmenu', (e) => e.preventDefault());
  const HANDLE = 12; // px on screen: a road's or area's corner handle
  const corners = (e) => [
    [e[0], e[1]],
    [e[2], e[1]],
    [e[2], e[3]],
    [e[0], e[3]],
  ];
  let drag = null,
    space = false,
    mouseV = [W / 2, H / 2];
  ov.addEventListener('pointerdown', (e) => {
    ov.setPointerCapture(e.pointerId);
    const v = view(e),
      w = world(v),
      g = gnd(w);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && space)) {
      if (e.button === 2 && tool.t === 'place') {
        setTool('select');
        return;
      }
      drag = { t: 'pan', v, cam: cam.slice() };
      return;
    }
    if (e.button !== 0) return;
    const b = snapshot();
    if (tool.t === 'place') {
      const ks = tool.k === 'props' ? kitSnap(tool.n, tool.flip, g[0], g[1]) : null,
        gx = ks ? ks[0] : snapV(g[0]),
        gy = ks ? ks[1] : snapV(g[1]),
        it = make(gx, gy);
      map[tool.k].push(it);
      SIM.setMap(map, MAPID);
      LV = SIM.level(SEED);
      drag = { t: 'paint', b, last: [gx, gy], rects: [extent(tool.k, it)] };
      return;
    }
    if (
      tool.t === 'road' ||
      tool.t === 'area' ||
      tool.t === 'wall' ||
      tool.t === 'floor' ||
      tool.t === 'void' ||
      tool.t === 'gate' ||
      tool.t === 'zone'
    ) {
      drag = { t: tool.t, b, a: [snapV(g[0]), snapV(g[1])], g: [snapV(g[0]), snapV(g[1])] };
      return;
    }
    if (tool.t === 'mark') {
      // the mark picked in the panel put here (moved, if it is on the map already); then the next one not placed
      if (!tool.n) return;
      const it = [tool.n, snapV(g[0]), snapV(g[1])],
        i = map.marks.findIndex((q) => q[0] === tool.n),
        rects = [extent('marks', it)];
      if (i >= 0) {
        rects.push(extent('marks', map.marks[i]));
        map.marks[i] = it;
      } else map.marks.push(it);
      sel = [{ k: 'marks', i: i >= 0 ? i : map.marks.length - 1 }];
      commit(b, rects);
      tool.n = missing() || tool.n;
      panel();
      return;
    }
    if (tool.t === 'post' || tool.t === 'light' || tool.t === 'start') {
      const gx = snapV(g[0]),
        gy = snapV(g[1]),
        k = tool.t + 's',
        it = tool.t === 'post' ? [gx, gy, 0] : tool.t === 'light' ? [gx, gy, 400, tool.tint] : [gx, gy];
      map[k].push(it);
      sel = [{ k, i: map[k].length - 1 }];
      commit(b, [extent(k, it)]);
      panel();
      return;
    }
    if (tool.t === 'spawn') {
      const r0 = extent('spawn', map.spawn);
      map.spawn = [snapV(g[0]), snapV(g[1])];
      commit(b, [r0, extent('spawn', map.spawn)]);
      panel();
      return;
    }
    // the select tool: a corner handle of the one road or area selected, else the thing under the mouse, else a frame
    if (sel.length === 1 && RECT[sel[0].k]) {
      const it = itemOf(sel[0]);
      const c = corners(it).findIndex(([x, y]) => {
        const [sx, sy] = toS(x, y);
        return Math.hypot(sx - w[0], sy - w[1]) * zoom < HANDLE * 1.2;
      });
      if (c >= 0) {
        drag = { t: 'corner', b, c, s: sel[0], r0: extent(sel[0].k, it) };
        return;
      }
    }
    const hit = pick(w[0], w[1]);
    if (hit) {
      const on = sel.some((s) => s.k === hit.k && s.i === hit.i);
      if (e.shiftKey) {
        sel = on ? sel.filter((s) => !(s.k === hit.k && s.i === hit.i)) : sel.concat(hit);
        panel();
        return;
      }
      if (!on) sel = [hit];
      drag = {
        t: 'move',
        b,
        g0: g,
        orig: sel.map((s) => itemOf(s).slice()),
        rects: sel.filter((s) => s.k !== 'spawn').map((s) => extent(s.k, itemOf(s))),
      };
      panel();
      return;
    }
    if (!e.shiftKey) sel = [];
    drag = { t: 'frame', v0: v, v, add: e.shiftKey };
    panel();
  });
  ov.addEventListener('pointermove', (e) => {
    const v = view(e),
      w = world(v),
      g = gnd(w);
    mouseV = v;
    cursorG = g;
    if (!drag) return;
    if (drag.t === 'pan') {
      cam = [drag.cam[0] - (v[0] - drag.v[0]) / zoom, drag.cam[1] - (v[1] - drag.v[1]) / zoom];
      return;
    }
    if (drag.t === 'frame') {
      drag.v = v;
      return;
    }
    if (
      drag.t === 'road' ||
      drag.t === 'area' ||
      drag.t === 'wall' ||
      drag.t === 'floor' ||
      drag.t === 'void' ||
      drag.t === 'gate' ||
      drag.t === 'zone'
    ) {
      drag.g = [snapV(g[0]), snapV(g[1])];
      return;
    }
    if (drag.t === 'paint') {
      // trees and bushes in a row: the next one once the mouse is far enough from the last
      if (tool.k !== 'trees' && tool.k !== 'bushes') return;
      const step = (tool.k === 'trees' ? 270 * 0.6 : 95 * (BUSHK[tool.n] || 1) * 0.55) * tool.size;
      if (Math.hypot(g[0] - drag.last[0], g[1] - drag.last[1]) < step) return;
      const it = make(
        snapV(g[0] + (Math.random() - 0.5) * step * 0.4),
        snapV(g[1] + (Math.random() - 0.5) * step * 0.4),
      );
      map[tool.k].push(it);
      drag.last = g;
      drag.rects.push(extent(tool.k, it));
      SIM.setMap(map, MAPID);
      LV = SIM.level(SEED);
      return;
    }
    if (drag.t === 'corner') {
      const it = itemOf(drag.s),
        gx = snapV(g[0]),
        gy = snapV(g[1]),
        c = drag.c;
      if (c === 0 || c === 3) it[0] = Math.min(gx, it[2] - 40);
      else it[2] = Math.max(gx, it[0] + 40);
      if (c === 0 || c === 1) it[1] = Math.min(gy, it[3] - 40);
      else it[3] = Math.max(gy, it[1] + 40);
      return;
    }
    if (drag.t === 'move') {
      let dx = g[0] - drag.g0[0],
        dy = g[1] - drag.g0[1];
      if (snap) {
        dx = Math.round(dx / 10) * 10;
        dy = Math.round(dy / 10) * 10;
      } else {
        dx = Math.round(dx);
        dy = Math.round(dy);
      }
      sel.forEach((s, j) => {
        const it = itemOf(s),
          o = drag.orig[j];
        if (RECT[s.k]) {
          it[0] = o[0] + dx;
          it[1] = o[1] + dy;
          it[2] = o[2] + dx;
          it[3] = o[3] + dy;
        } else if (POINT[s.k]) {
          it[0] = o[0] + dx;
          it[1] = o[1] + dy;
        } else {
          it[1] = o[1] + dx;
          it[2] = o[2] + dy;
          // (one wall kit piece moved: flush against the kit piece it comes near)
          const ks =
            sel.length === 1 && s.k === 'props'
              ? kitSnap(it[0], it[3], o[1] + g[0] - drag.g0[0], o[2] + g[1] - drag.g0[1], s.i)
              : null;
          if (ks) [it[1], it[2]] = ks;
        }
      });
      drag.moved = dx || dy;
      if (LAB || sel.some((s) => s.k !== 'roads' && s.k !== 'areas')) {
        SIM.setMap(map, MAPID);
        LV = SIM.level(SEED);
        ST.p.x = toS(...map.spawn)[0];
        ST.p.y = toS(...map.spawn)[1];
      }
    }
  });
  const end = () => {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.t === 'frame') {
      // everything whose foot is inside the frame (not the roads and areas)
      const [ax, ay] = world(d.v0),
        [bx, by] = world(d.v),
        x0 = Math.min(ax, bx),
        x1 = Math.max(ax, bx),
        y0 = Math.min(ay, by),
        y1 = Math.max(ay, by);
      if (x1 - x0 < 4 && y1 - y0 < 4) return;
      if (LAB)
        for (const k of ['starts', 'lights', 'posts'])
          map[k].forEach((it, i) => {
            const [x, y] = toS(it[0], it[1]);
            if (x > x0 && x < x1 && y > y0 && y < y1 && !sel.some((s) => s.k === k && s.i === i)) sel.push({ k, i });
          });
      for (const k of ['props', 'trees', 'bushes', 'decor', 'marks'])
        map[k].forEach((it, i) => {
          const [x, y] = toS(it[1], it[2]);
          if (x > x0 && x < x1 && y > y0 && y < y1 && !sel.some((s) => s.k === k && s.i === i)) sel.push({ k, i });
        });
      panel();
      return;
    }
    if (d.t === 'paint') {
      commit(d.b, d.rects);
      return;
    }
    if (d.t === 'road') {
      const [a, g] = [d.a, d.g],
        alongX = Math.abs(g[0] - a[0]) >= Math.abs(g[1] - a[1]);
      const r = alongX
        ? [Math.min(a[0], g[0]), a[1] - ROAD_W / 2, Math.max(a[0], g[0]), a[1] + ROAD_W / 2, WALK]
        : [a[0] - ROAD_W / 2, Math.min(a[1], g[1]), a[0] + ROAD_W / 2, Math.max(a[1], g[1]), WALK];
      if (r[2] - r[0] < 100 || r[3] - r[1] < 100) return;
      map.roads.push(r);
      sel = [{ k: 'roads', i: map.roads.length - 1 }];
      commit(d.b, [extent('roads', r)]);
      panel();
      return;
    }
    if (d.t === 'area') {
      const r = [
        Math.min(d.a[0], d.g[0]),
        Math.min(d.a[1], d.g[1]),
        Math.max(d.a[0], d.g[0]),
        Math.max(d.a[1], d.g[1]),
        tool.mat,
      ];
      if (r[2] - r[0] < 40 || r[3] - r[1] < 40) return;
      map.areas.push(r);
      sel = [{ k: 'areas', i: map.areas.length - 1 }];
      commit(d.b, [r]);
      panel();
      return;
    }
    if (d.t === 'void' || d.t === 'gate' || d.t === 'zone') {
      // the office's: a rect of void, a yellow zone, or a gate named after the first free gateN
      const k = d.t === 'void' ? 'void' : d.t === 'zone' ? 'zones' : 'gates',
        r = [Math.min(d.a[0], d.g[0]), Math.min(d.a[1], d.g[1]), Math.max(d.a[0], d.g[0]), Math.max(d.a[1], d.g[1])];
      if (r[2] - r[0] < 20 || r[3] - r[1] < 20) return;
      if (k === 'gates') {
        let n = 1;
        while (map.gates.some((q) => q[4] === 'gate' + n)) n++;
        r.push('gate' + n);
      }
      map[k].push(r);
      sel = [{ k, i: map[k].length - 1 }];
      commit(d.b, [k === 'zones' ? extent(k, r) : r.slice(0, 4)]);
      panel();
      return;
    }
    if (d.t === 'wall') {
      const [a, g] = [d.a, d.g],
        alongX = Math.abs(g[0] - a[0]) >= Math.abs(g[1] - a[1]);
      const r = alongX
        ? [Math.min(a[0], g[0]), a[1] - 20, Math.max(a[0], g[0]), a[1] + 20]
        : [a[0] - 20, Math.min(a[1], g[1]), a[0] + 20, Math.max(a[1], g[1])];
      if (r[2] - r[0] < 60 && r[3] - r[1] < 60) return;
      map.walls.push(r);
      sel = [{ k: 'walls', i: map.walls.length - 1 }];
      commit(d.b, [r]);
      panel();
      return;
    }
    if (d.t === 'floor') {
      const r = [
        Math.min(d.a[0], d.g[0]),
        Math.min(d.a[1], d.g[1]),
        Math.max(d.a[0], d.g[0]),
        Math.max(d.a[1], d.g[1]),
        tool.kind,
      ];
      if (r[2] - r[0] < 60 || r[3] - r[1] < 60) return;
      map.floors.push(r);
      sel = [{ k: 'floors', i: map.floors.length - 1 }];
      commit(d.b, [r]);
      panel();
      return;
    }
    if (d.t === 'corner') {
      commit(d.b, [d.r0, extent(d.s.k, itemOf(d.s))]);
      panel();
      return;
    }
    if (d.t === 'move' && d.moved) {
      commit(d.b, d.rects.concat(sel.filter((s) => s.k !== 'spawn').map((s) => extent(s.k, itemOf(s)))));
      panel();
    }
  };
  ov.addEventListener('pointerup', end);
  ov.addEventListener('pointercancel', end);

  let clip = null;
  const keys = {};
  addEventListener('keydown', (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    const c = e.code,
      ctrl = e.ctrlKey || e.metaKey;
    keys[c] = true;
    if (c === 'Space') {
      space = true;
      e.preventDefault();
      return;
    }
    if (ctrl && c === 'KeyZ') {
      e.preventDefault();
      history(e.shiftKey ? redo : undo, e.shiftKey ? undo : redo);
      return;
    }
    if (ctrl && c === 'KeyY') {
      e.preventDefault();
      history(redo, undo);
      return;
    }
    if (ctrl && c === 'KeyS') {
      e.preventDefault();
      save();
      return;
    }
    if (ctrl && (c === 'KeyC' || c === 'KeyD')) {
      // copy: the things (not roads, areas), by their offsets from the first one
      e.preventDefault();
      const list = sel.filter((s) => s.k === 'props' || s.k === 'decor' || s.k === 'trees' || s.k === 'bushes');
      if (!list.length) return;
      const o = itemOf(list[0]);
      clip = list.map((s) => ({ k: s.k, it: itemOf(s).slice(), dx: itemOf(s)[1] - o[1], dy: itemOf(s)[2] - o[2] }));
      if (c === 'KeyC') {
        say('Скопировано: ' + clip.length);
        return;
      }
      paste(o[1] + 60, o[2] + 60);
      return;
    }
    if (ctrl && c === 'KeyV') {
      e.preventDefault();
      const g = gnd(world(mouseV));
      paste(snapV(g[0]), snapV(g[1]));
      return;
    }
    if (ctrl) return;
    if (c === 'Escape') {
      setTool('select');
      sel = [];
      panel();
      return;
    }
    if (c === 'Delete' || c === 'Backspace') {
      e.preventDefault();
      del();
      return;
    }
    if (c === 'KeyF') {
      flip();
      return;
    }
    if (c === 'KeyR' && LAB) {
      turn();
      return;
    } // (the town's R is its road tool: a prop there turns by its button)
    if (c === 'KeyQ') {
      resize(1 / 1.1);
      return;
    }
    if (c === 'KeyE') {
      resize(1.1);
      return;
    }
    if (c === 'KeyG') {
      snap = !snap;
      bar();
      return;
    }
    if (c === 'KeyH') {
      foot = !foot;
      bar();
      return;
    }
    const t = (
      LAB
        ? {
            KeyV: 'select',
            KeyW: 'wall',
            KeyO: 'post',
            KeyT: 'floor',
            KeyL: 'light',
            KeyS: 'start',
            KeyM: 'mark',
          }
        : {
            KeyV: 'select',
            KeyR: 'road',
            KeyT: 'area:tiles',
            KeyP: 'area:plaza',
            KeyB: 'area:dirt',
            KeyS: 'spawn',
            KeyM: 'mark',
            ...(OFFICE ? { KeyO: 'area:floor', KeyX: 'void', KeyY: 'gate', KeyZ: 'zone' } : {}),
          }
    )[c];
    if (t) {
      setTool(t);
      return;
    }
    const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[c];
    if (arrow && sel.length) {
      // nudge on the screen: left/right along x, up/down along y (10 ground units)
      e.preventDefault();
      const b = snapshot(),
        rects = [],
        dgx = (arrow[0] + arrow[1]) * 10,
        dgy = (arrow[1] - arrow[0]) * 10;
      for (const s of sel) {
        const it = itemOf(s);
        if (s.k !== 'spawn') rects.push(extent(s.k, it));
        if (RECT[s.k]) {
          it[0] += dgx;
          it[2] += dgx;
          it[1] += dgy;
          it[3] += dgy;
        } else if (POINT[s.k]) {
          it[0] += dgx;
          it[1] += dgy;
        } else {
          it[1] += dgx;
          it[2] += dgy;
        }
        if (s.k !== 'spawn') rects.push(extent(s.k, it));
      }
      commit(b, rects);
      panel();
    }
  });
  addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === 'Space') space = false;
  });
  function paste(gx, gy) {
    if (!clip) return;
    const b = snapshot(),
      rects = [];
    sel = [];
    for (const c of clip) {
      const it = c.it.slice();
      it[1] = gx + c.dx;
      it[2] = gy + c.dy;
      map[c.k].push(it);
      sel.push({ k: c.k, i: map[c.k].length - 1 });
      rects.push(extent(c.k, it));
    }
    commit(b, rects);
    panel();
  }

  // the minimap: the whole world (the forest round it too); click or drag to look there
  const MX0 = -1400,
    MY0 = -700,
    MS = 600 / 12400;
  const mcv = document.createElement('canvas');
  mcv.width = 600;
  mcv.height = 300;
  function miniPaint() {
    const g = mcv.getContext('2d'),
      P = (gx, gy) => {
        const [x, y] = toS(gx, gy);
        return [(x - MX0) * MS, (y - MY0) * MS];
      };
    const quad = (e, col) => {
      g.fillStyle = col;
      g.beginPath();
      for (const [x, y] of corners(e)) g.lineTo(...P(x, y));
      g.fill();
    };
    g.fillStyle = '#0a110a';
    g.fillRect(0, 0, 600, 300);
    if (LAB) {
      quad([0, 0, GS(), GS()], '#0b0d12');
      for (const f of map.floors) quad(f, FLOOR_C[f[4]] || '#888');
      for (const w of map.walls) quad(w, '#20242c');
      for (const q of map.posts) quad([q[0] - 30, q[1] - 30, q[0] + 30, q[1] + 30], q[2] ? '#e8b51e' : '#20242c');
      for (const q of map.props) quad(extent('props', q), '#e0e4ea');
      return;
    }
    quad([0, 0, GS(), GS()], '#26401f');
    if (OFFICE) for (const r of map.void) quad(r, '#152015');
    for (const a of map.areas) quad(a, a[4] === 'plaza' ? '#8a8a80' : a[4] === 'dirt' ? '#5a4a30' : '#6e6a64');
    for (const r of map.roads) {
      if (r[4]) quad(extent('roads', r), '#9a968e');
      quad(r, '#3a3a42');
    }
    for (const p of map.props)
      quad(extent('props', p), PROP[p[0]].bld ? '#d0763a' : /car|van|bus|suv/.test(p[0]) ? '#c04a4a' : '#b8b0a0');
    g.fillStyle = '#4f8a32';
    for (const t of map.trees) {
      const [x, y] = P(t[1], t[2]);
      g.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    g.fillStyle = '#3c6e28';
    for (const t of map.bushes) {
      const [x, y] = P(t[1], t[2]);
      g.fillRect(x - 1, y - 1, 2, 2);
    }
  }
  function miniDraw() {
    if (miniDirty) {
      miniPaint();
      miniDirty = false;
    }
    const g = mini.getContext('2d');
    g.drawImage(mcv, 0, 0);
    for (const q of LAB ? map.starts : [map.spawn]) {
      const [sx, sy] = toS(q[0], q[1]);
      g.fillStyle = LAB ? '#3aff7a' : '#ff3a2a';
      g.beginPath();
      g.arc((sx - MX0) * MS, (sy - MY0) * MS, LAB ? 4 : 5, 0, 7);
      g.fill();
    }
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.strokeRect((cam[0] - MX0) * MS, (cam[1] - MY0) * MS, (W / zoom) * MS, (H / zoom) * MS);
  }
  let miniDrag = false;
  const miniGo = (e) => {
    const r = mini.getBoundingClientRect(),
      x = (((e.clientX - r.left) / r.width) * 600) / MS + MX0,
      y = (((e.clientY - r.top) / r.height) * 300) / MS + MY0;
    cam = [x - W / zoom / 2, y - H / zoom / 2];
  };
  mini.addEventListener('pointerdown', (e) => {
    miniDrag = true;
    mini.setPointerCapture(e.pointerId);
    miniGo(e);
  });
  mini.addEventListener('pointermove', (e) => {
    if (miniDrag) miniGo(e);
  });
  mini.addEventListener('pointerup', () => {
    miniDrag = false;
  });

  // ================================================================== drawing: the game's frame, then the overlay
  function overlay() {
    const g = ov.getContext('2d'),
      d = ov.width / W,
      k = d * zoom,
      P = (gx, gy) => {
        const [x, y] = toS(gx, gy);
        return [(x - cam[0]) * k, (y - cam[1]) * k];
      };
    const S = (x, y) => [(x - cam[0]) * k, (y - cam[1]) * k];
    const quad = (e) => {
      g.beginPath();
      for (const [x, y] of corners(e)) g.lineTo(...P(x, y));
      g.closePath();
    };
    const vis = (e) => {
      const a = P(e[0], e[3]),
        b = P(e[2], e[1]),
        t = P(e[0], e[1]),
        u = P(e[2], e[3]);
      return b[0] > -50 && a[0] < ov.width + 50 && u[1] > -50 && t[1] < ov.height + 50;
    };
    g.clearRect(0, 0, ov.width, ov.height);
    g.lineJoin = 'round';
    // where the hero can walk (the sim's edge)
    g.setLineDash([10 * d, 8 * d]);
    g.strokeStyle = 'rgba(255,120,90,0.55)';
    g.lineWidth = 2 * d;
    quad([EDGE, EDGE, GS() - EDGE, GS() - EDGE]);
    g.stroke();
    g.setLineDash([]);
    if (LAB && (foot || tool.t === 'wall' || tool.t === 'floor' || tool.t === 'post')) {
      g.font = `700 ${Math.round(15 * d)}px Rubik, sans-serif`;
      g.textAlign = 'center';
      for (const f of map.floors)
        if (vis(f)) {
          g.strokeStyle = FLOOR_C[f[4]] || '#fff';
          g.globalAlpha = 0.85;
          g.lineWidth = 2 * d;
          quad(f);
          g.stroke();
          g.globalAlpha = 1;
          const [x, y] = P((f[0] + f[2]) / 2, (f[1] + f[3]) / 2),
            tx = (FLOORS[f[4]] || f[4]) + (f === BOSSF ? ' · босс' : f[4] === 'hall' ? ' (плитка)' : '');
          g.lineWidth = 3 * d;
          g.strokeStyle = '#000';
          g.strokeText(tx, x, y - 60 * k);
          g.fillStyle = FLOOR_C[f[4]] || '#fff';
          g.fillText(tx, x, y - 60 * k);
        }
      g.strokeStyle = 'rgba(120,230,255,0.8)';
      g.lineWidth = 1.5 * d;
      for (const w of map.walls)
        if (vis(w)) {
          quad(w);
          g.stroke();
        }
      for (const q of map.posts) {
        const e = [q[0] - 30, q[1] - 30, q[0] + 30, q[1] + 30];
        if (!vis(e)) continue;
        g.fillStyle = q[2] ? 'rgba(255,190,40,0.55)' : 'rgba(150,170,200,0.4)';
        quad(e);
        g.fill();
      }
    }
    if (LAB) {
      // the lights (their reach dashed) and the starts, numbered
      for (const q of map.lights) {
        const [x, y] = P(q[0], q[1]);
        if (x < -300 || y < -300 || x > ov.width + 300 || y > ov.height + 300) continue;
        g.strokeStyle = TINT_C[q[3]] || '#fff';
        g.lineWidth = 1.5 * d;
        g.setLineDash([5 * d, 6 * d]);
        g.beginPath();
        g.ellipse(x, y, q[2] * 1.25 * k, q[2] * 0.66 * k, 0, 0, 7);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = TINT_C[q[3]] || '#fff';
        g.beginPath();
        g.arc(x, y, 7 * d, 0, 7);
        g.fill();
        g.strokeStyle = '#000';
        g.lineWidth = 2 * d;
        g.stroke();
      }
      g.font = `800 ${Math.round(13 * d)}px Rubik, sans-serif`;
      g.textAlign = 'center';
      map.starts.forEach((q, i) => {
        const [x, y] = P(q[0], q[1]),
          bad = probs.starts && probs.starts.includes(i);
        g.fillStyle = bad ? '#ff3a2a' : '#3aff7a';
        g.globalAlpha = 0.4;
        g.beginPath();
        g.ellipse(x, y, 34 * k, 17 * k, 0, 0, 7);
        g.fill();
        g.globalAlpha = 1;
        g.strokeStyle = '#000';
        g.lineWidth = 3 * d;
        g.strokeText('старт ' + (i + 1), x, y + 30 * k + 12 * d);
        g.fillStyle = '#fff';
        g.fillText('старт ' + (i + 1), x, y + 30 * k + 12 * d);
      });
      g.fillStyle = 'rgba(255,40,30,0.45)';
      for (const [cx, cy, c] of probs.shut || []) {
        quad([cx, cy, cx + c, cy + c]);
        g.fill();
      }
    }
    // the office's void (dark, hatched: nothing walks there) and its gates (dashed red, named: walls until the
    // mission opens them)
    if (OFFICE) {
      for (const r of map.void) {
        if (!vis(r)) continue;
        g.fillStyle = 'rgba(4,8,4,0.42)';
        quad(r);
        g.fill();
        g.save();
        quad(r);
        g.clip();
        const a = P(r[0], r[3]),
          b = P(r[2], r[1]),
          t = P(r[0], r[1]),
          u = P(r[2], r[3]),
          step = 26 * d;
        g.strokeStyle = 'rgba(255,255,255,0.09)';
        g.lineWidth = 1.5 * d;
        g.beginPath();
        for (let x = a[0] - (u[1] - t[1]); x < b[0]; x += step) {
          g.moveTo(x, t[1]);
          g.lineTo(x + (u[1] - t[1]), u[1]);
        }
        g.stroke();
        g.restore();
        g.strokeStyle = 'rgba(210,220,230,0.35)';
        g.lineWidth = 1 * d;
        quad(r);
        g.stroke();
      }
      g.font = `800 ${Math.round(12 * d)}px Rubik, sans-serif`;
      g.textAlign = 'center';
      for (const r of map.gates) {
        if (!vis(r)) continue;
        g.fillStyle = 'rgba(255,50,40,0.18)';
        quad(r);
        g.fill();
        g.setLineDash([8 * d, 6 * d]);
        g.strokeStyle = '#ff4a3a';
        g.lineWidth = 2.5 * d;
        quad(r);
        g.stroke();
        g.setLineDash([]);
        const [x, y] = P((r[0] + r[2]) / 2, (r[1] + r[3]) / 2),
          t = 'ворота «' + r[4] + '»';
        g.strokeStyle = '#000';
        g.lineWidth = 3 * d;
        g.strokeText(t, x, y - 8 * d);
        g.fillStyle = '#ffb0a8';
        g.fillText(t, x, y - 8 * d);
      }
    }
    if (!LAB && (foot || tool.t === 'road' || tool.t === 'area')) {
      for (const a of map.areas)
        if (vis(a)) {
          g.strokeStyle =
            a[4] === 'plaza'
              ? 'rgba(255,230,140,0.6)'
              : a[4] === 'dirt'
                ? 'rgba(200,150,90,0.6)'
                : 'rgba(200,210,230,0.5)';
          g.lineWidth = 1.5 * d;
          quad(a);
          g.stroke();
        }
      for (const r of map.roads)
        if (vis(r)) {
          g.strokeStyle = 'rgba(120,200,255,0.6)';
          g.lineWidth = 1.5 * d;
          quad(r);
          g.stroke();
        }
    }
    if (foot) {
      g.strokeStyle = 'rgba(255,255,255,0.32)';
      g.lineWidth = 1 * d;
      map.props.forEach((p, i) => {
        const e = extent('props', p);
        if (vis(e) && !probs.props.has(i)) {
          quad(e);
          g.stroke();
        }
      });
    }
    // problems in red
    g.strokeStyle = '#ff3a2a';
    g.fillStyle = 'rgba(255,40,30,0.22)';
    g.lineWidth = 2.5 * d;
    for (const i of probs.props) {
      const e = extent('props', map.props[i]);
      if (vis(e)) {
        quad(e);
        g.fill();
        g.stroke();
      }
    }
    for (const s of probs.plants) {
      const t = map[s.k][s.i],
        [x, y] = P(t[1], t[2]);
      g.beginPath();
      g.ellipse(x, y, 22 * k, 11 * k, 0, 0, 7);
      g.stroke();
    }
    // the start
    if (!LAB) {
      const [x, y] = P(...map.spawn);
      g.fillStyle = probs.spawn ? '#ff3a2a' : '#3aff7a';
      g.strokeStyle = '#000';
      g.lineWidth = 2 * d;
      g.beginPath();
      g.ellipse(x, y, 34 * k, 17 * k, 0, 0, 7);
      g.globalAlpha = 0.35;
      g.fill();
      g.globalAlpha = 1;
      g.font = `700 ${Math.round(13 * d)}px Rubik, sans-serif`;
      g.textAlign = 'center';
      g.lineWidth = 3 * d;
      g.strokeText('СТАРТ', x, y + 30 * k + 12 * d);
      g.fillStyle = '#fff';
      g.fillText('СТАРТ', x, y + 30 * k + 12 * d);
    }
    // the missions' marks: a pin on its point, its name over it (orange: a mission's, grey: none asks for it, red:
    // inside something solid; the one the Точки tool places next ringed)
    g.font = `800 ${Math.round(12 * d)}px Rubik, sans-serif`;
    g.textAlign = 'center';
    map.marks.forEach((q, i) => {
      const [x, y] = P(q[1], q[2]),
        top = y - 70 * k,
        col = probs.marks && probs.marks.includes(i) ? '#ff3a2a' : NEED.includes(q[0]) ? '#ff9a1f' : '#a0a0a0';
      g.fillStyle = col;
      g.globalAlpha = 0.35;
      g.beginPath();
      g.ellipse(x, y, 26 * k, 13 * k, 0, 0, 7);
      g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = '#000';
      g.lineWidth = 4 * d;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, top);
      g.stroke();
      g.strokeStyle = col;
      g.lineWidth = 2 * d;
      g.stroke();
      g.beginPath();
      g.arc(x, top, Math.max(7 * d, 12 * k), 0, 7);
      g.fill();
      g.strokeStyle = tool.t === 'mark' && tool.n === q[0] ? '#fff' : '#000';
      g.lineWidth = 2.5 * d;
      g.stroke();
      const t = markName(q[0]);
      g.strokeStyle = '#000';
      g.lineWidth = 3 * d;
      g.strokeText(t, x, top - Math.max(7 * d, 12 * k) - 6 * d);
      g.fillStyle = '#fff';
      g.fillText(t, x, top - Math.max(7 * d, 12 * k) - 6 * d);
    });
    // the selection
    g.strokeStyle = '#ffd23a';
    g.lineWidth = 2.5 * d;
    for (const s of sel) {
      const it = itemOf(s);
      if (s.k === 'props') {
        quad(extent('props', it));
        g.stroke();
        const b = pic('props', it),
          [x0, y0] = S(b[0], b[1]),
          [x1, y1] = S(b[2], b[3]);
        g.setLineDash([6 * d, 5 * d]);
        g.strokeRect(x0, y0, x1 - x0, y1 - y0);
        g.setLineDash([]);
      } else if (s.k === 'trees' || s.k === 'bushes') {
        const [x, y] = P(it[1], it[2]);
        g.beginPath();
        g.ellipse(x, y, it[3] * 0.2 * k, it[3] * 0.1 * k, 0, 0, 7);
        g.stroke();
        const b = pic(s.k, it),
          [x0, y0] = S(b[0], b[1]),
          [x1, y1] = S(b[2], b[3]);
        g.setLineDash([6 * d, 5 * d]);
        g.strokeRect(x0, y0, x1 - x0, y1 - y0);
        g.setLineDash([]);
      } else if (s.k === 'decor' && isMark(it)) {
        quad(extent('decor', it));
        g.stroke();
      } else if (s.k === 'decor' || s.k === 'marks') {
        const [x, y] = P(it[1], it[2]);
        g.beginPath();
        g.ellipse(x, y, 40 * k, 20 * k, 0, 0, 7);
        g.stroke();
      } else if (POINT[s.k]) {
        const [x, y] = P(it[0], it[1]);
        g.beginPath();
        g.ellipse(x, y, 40 * k, 20 * k, 0, 0, 7);
        g.stroke();
      } else {
        quad(s.k === 'roads' ? [it[0], it[1], it[2], it[3]] : it);
        g.stroke();
        if (s.k === 'roads' && it[4]) {
          g.setLineDash([6 * d, 5 * d]);
          quad(extent('roads', it));
          g.stroke();
          g.setLineDash([]);
        }
        if (sel.length === 1) {
          g.fillStyle = '#ffd23a';
          for (const [x, y] of corners(it)) {
            const [px, py] = P(x, y);
            g.fillRect(px - (HANDLE * d) / 2, py - (HANDLE * d) / 2, HANDLE * d, HANDLE * d);
          }
        }
      }
    }
    // what the tool is about to do
    const gm = gnd(world(mouseV));
    if (drag && (drag.t === 'wall' || drag.t === 'floor')) {
      const a = drag.a,
        b = drag.g,
        alongX = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
      const e =
        drag.t === 'wall'
          ? alongX
            ? [Math.min(a[0], b[0]), a[1] - 20, Math.max(a[0], b[0]), a[1] + 20]
            : [a[0] - 20, Math.min(a[1], b[1]), a[0] + 20, Math.max(a[1], b[1])]
          : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
      g.fillStyle = drag.t === 'wall' ? 'rgba(160,170,190,0.7)' : (FLOOR_C[tool.kind] || '#fff') + '66';
      quad(e);
      g.fill();
      g.strokeStyle = '#ffd23a';
      g.lineWidth = 2 * d;
      quad(e);
      g.stroke();
    } else if (drag && (drag.t === 'void' || drag.t === 'gate' || drag.t === 'zone')) {
      const a = drag.a,
        b = drag.g,
        e = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
      g.fillStyle =
        drag.t === 'void' ? 'rgba(4,8,4,0.5)' : drag.t === 'zone' ? 'rgba(232,184,48,0.25)' : 'rgba(255,50,40,0.3)';
      quad(e);
      g.fill();
      g.strokeStyle = '#ffd23a';
      g.lineWidth = 2 * d;
      quad(e);
      g.stroke();
    } else if (drag && (drag.t === 'road' || drag.t === 'area')) {
      const a = drag.a,
        b = drag.g;
      let e;
      if (drag.t === 'road') {
        const alongX = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
        e = alongX
          ? [Math.min(a[0], b[0]), a[1] - ROAD_W / 2, Math.max(a[0], b[0]), a[1] + ROAD_W / 2]
          : [a[0] - ROAD_W / 2, Math.min(a[1], b[1]), a[0] + ROAD_W / 2, Math.max(a[1], b[1])];
        g.fillStyle = 'rgba(60,60,70,0.55)';
        quad(e);
        g.fill();
        g.setLineDash([6 * d, 5 * d]);
        g.strokeStyle = 'rgba(220,220,220,0.8)';
        quad(alongX ? [e[0], e[1] - WALK, e[2], e[3] + WALK] : [e[0] - WALK, e[1], e[2] + WALK, e[3]]);
        g.stroke();
        g.setLineDash([]);
      } else {
        e = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
        g.fillStyle = 'rgba(220,200,150,0.35)';
        quad(e);
        g.fill();
      }
      g.strokeStyle = '#ffd23a';
      g.lineWidth = 2 * d;
      quad(e);
      g.stroke();
    } else if (tool.t === 'place' && !drag) {
      const ks = tool.k === 'props' ? kitSnap(tool.n, tool.flip, gm[0], gm[1]) : null,
        it = make(ks ? ks[0] : snapV(gm[0]), ks ? ks[1] : snapV(gm[1]), false);
      if (tool.k === 'props' || tool.k === 'trees' || tool.k === 'bushes') {
        const b = pic(tool.k, it),
          im = img(tool.k === 'props' ? propPic(it) : it[0]),
          [x0, y0] = S(b[0], b[1]),
          [x1, y1] = S(b[2], b[3]),
          fl = tool.k === 'props' ? it[3] & 1 : it[4];
        const bad =
          tool.k === 'props'
            ? map.props.some((p) => {
                const a = extent('props', p),
                  e = extent('props', it);
                return a[0] < e[2] - OVER && e[0] < a[2] - OVER && a[1] < e[3] - OVER && e[1] < a[3] - OVER;
              })
            : map.props.some((p) => {
                const a = extent('props', p);
                return it[1] > a[0] && it[1] < a[2] && it[2] > a[1] && it[2] < a[3];
              });
        if (tool.k === 'props') {
          g.fillStyle = bad ? 'rgba(255,50,40,0.35)' : 'rgba(60,255,120,0.3)';
          quad(extent('props', it));
          g.fill();
        } else {
          const [x, y] = P(it[1], it[2]);
          g.fillStyle = bad ? 'rgba(255,50,40,0.5)' : 'rgba(60,255,120,0.45)';
          g.beginPath();
          g.ellipse(x, y, 16 * k, 8 * k, 0, 0, 7);
          g.fill();
        }
        if (im.complete && im.naturalWidth) {
          g.globalAlpha = 0.7;
          g.save();
          if (fl) {
            g.translate(x0 + x1, 0);
            g.scale(-1, 1);
          }
          g.drawImage(im, x0, y0, x1 - x0, y1 - y0);
          g.restore();
          g.globalAlpha = 1;
        }
      } else if (tool.k === 'decor' && MARKN[tool.n]) {
        g.strokeStyle = '#3aff7a';
        g.lineWidth = 2 * d;
        quad(extent('decor', it));
        g.stroke();
      } else {
        const [x, y] = P(gm[0], gm[1]);
        g.strokeStyle = '#3aff7a';
        g.lineWidth = 2 * d;
        g.beginPath();
        g.ellipse(x, y, 30 * k, 15 * k, 0, 0, 7);
        g.stroke();
      }
    }
    if (drag && drag.t === 'frame') {
      const [x0, y0] = [drag.v0[0] * d, drag.v0[1] * d],
        [x1, y1] = [drag.v[0] * d, drag.v[1] * d];
      g.fillStyle = 'rgba(255,210,60,0.12)';
      g.strokeStyle = '#ffd23a';
      g.lineWidth = 1.5 * d;
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }
  }

  SCENE.pool(110);
  SCENE.budget = 3; // a zoomed-out view holds ~50 chunks; three painted a frame
  let last = performance.now(),
    statT = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!sel.length) {
      const pan = (900 / zoom) * dt;
      cam[0] += ((keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0)) * pan;
      cam[1] += ((keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0)) * pan;
    }
    ST.t = now / 1000;
    ST.cam = [cam[0], cam[1]];
    ST.zoom = zoom;
    ST.p.x = toS(...map.spawn)[0];
    ST.p.y = toS(...map.spawn)[1];
    SCENE.state = ST;
    try {
      SCENE.render(now / 1000);
    } catch (e) {
      console.error(e);
    }
    overlay();
    miniDraw();
    if (now > statT) {
      statT = now + 250;
      status();
    }
  }
  if (OFFICE)
    help.innerHTML +=
      '<br><b>Офис</b><br>X пустота: тяни, туда не зайти (лес вокруг) · Y ворота: тяни, невидимая стена, пока миссия не откроет; имя в панели справа<br>M точки миссии · «Миссия 1-1 ▶»: сохранить и сразу играть';
  if (LAB)
    help.innerHTML +=
      '<br><b>Лаборатория</b><br>W стена: тяни вдоль стены · O столб (у прохода: «дверь») · T пол комнаты (вид справа; зал один) · L свет · S старт<br>R повернуть предмет на 90° (два раза: его задняя сторона) · «вперемешку» у раздела: каждый новый повёрнут случайно<br><b>Красным</b>: предмет в стене, занятый старт, пол, куда не дойти из зала';
  (LAB || OFFICE ? SCENE.useMap(MAPID) : Promise.resolve()).then(() => {
    rebuild();
    panel();
    bar();
    requestAnimationFrame(frame);
  });
  // (gen/editorcheck.mjs; look: the view centred on a ground point, at one of the zoom steps)
  window.EDITOR = {
    get map() {
      return map;
    },
    save,
    rebuild,
    pick,
    sel: () => sel,
    look: (gx, gy, z) => {
      if (ZOOMS.includes(z)) zoom = z;
      const [x, y] = toS(gx, gy);
      cam = [x - W / zoom / 2, y - H / zoom / 2];
    },
    foot: (on) => {
      foot = !!on;
      bar();
    },
  };
})();
