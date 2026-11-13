import { fold, rankMatches } from './text.js';

/**
 * The food types one can search for, and how a place from OpenStreetMap is given them.
 *
 * Chosen from what the Swiss OSM data holds (November 2026, 33 150 places to eat): the
 * `cuisine` values most used (regional 3 800, pizza 2 700, italian 2 500, kebab 1 100,
 * burger 1 000, coffee_shop 650, thai 560, asian 550, chinese 430, sandwich 350, indian 330…),
 * the brands (McDonald's 228, Burger King 101, Starbucks 56, Subway 51, Brezelkönig 43…), and
 * words in names, since six places in ten have no cuisine at all ("Pizzeria Vesuvio").
 *
 * The list order is the order of the suggestion chips; a restaurant shows its most specific
 * type first. Labels are French; synonyms (folded: lower case, no accents, ї → і, й → и) let one
 * search in French, German, Italian, English or Ukrainian.
 */
export interface Food {
  key: string;
  emoji: string;
  label: string;
  synonyms: string[];
  /** OSM cuisine values. */
  cuisines?: string[];
  /** Words in the folded name. */
  name?: RegExp;
  /** Folded brand names (or names of chain restaurants). */
  brands?: string[];
  /** Also give these types (sushi is also Asian). */
  implies?: string[];
  /** A kind of place rather than a food (every restaurant, every fast food…). */
  generic?: boolean;
  /** Only in these countries (ISO codes, lower case: Swiss cuisine in Switzerland); everywhere when absent. */
  countries?: string[];
}

export const FOODS: Food[] = [
  {
    key: 'pizza',
    emoji: '🍕',
    label: 'Pizza',
    synonyms: ['pizza', 'pizzeria', 'pizze', 'pinsa', 'піца', 'піци', 'піцерія'],
    cuisines: ['pizza', 'italian_pizza', 'pinsa'],
    name: /pizz|\bpinsa|піц|челентано/u,
    brands: ["domino's", "domino's pizza", 'pizza hut', 'dieci', 'santa lucia', 'molino', "l'osteria", 'vapiano'],
  },
  {
    key: 'burger',
    emoji: '🍔',
    label: 'Burger',
    synonyms: ['burger', 'hamburger', 'cheeseburger', 'burgers', 'бургер', 'бургери', 'бургерна', 'гамбургер', 'чізбургер'],
    cuisines: ['burger', 'burgers', 'hamburger'],
    name: /burger(?!gemeinde|haus|spital|stube|saal|zunft|heim)|бургер/u,
    brands: ["mcdonald's", 'mcdonalds', 'burger king', 'five guys', 'hans im gluck', 'holy cow!', 'holy cow', 'burger & friends', 'black tap'],
  },
  {
    key: 'sushi',
    emoji: '🍣',
    label: 'Sushi & japonais',
    synonyms: ['sushi', 'japonais', 'japanese', 'japanisch', 'giapponese', 'maki', 'sashimi', 'japon', 'суші', 'роли', 'японська', 'японська кухня'],
    cuisines: ['sushi', 'japanese'],
    name: /sushi|\bjapan|\bjapon|tokyo|kyoto|osaka|nippon|izakaya|\bsakura\b|\bmaki\b|samurai|суші(?!н)|(?<!\p{L})рол(?:и|ли)(?!\p{L})|(?<!\p{L})япон|якітор/u,
    brands: ["yooji's", 'sushi shop', 'sushi mania', 'sushi zen'],
    implies: ['asiatique'],
  },
  {
    key: 'kebab',
    emoji: '🥙',
    label: 'Kebab',
    synonyms: ['kebab', 'kebap', 'doner', 'durum', 'shawarma', 'shawerma', 'pide', 'lahmacun', 'turc', 'turkish', 'шаурма', 'шаверма', 'кебаб', 'донер', 'дюрюм', 'турецька'],
    cuisines: ['kebab', 'doner', 'doner_kebab', 'shawarma', 'pide', 'lahmacun', 'durum'],
    name: /keba[bp]|\bdoner|\bdurum|shawarm|shawerm|\blahmacun|\bpide\b|шаурм|шаверм|кебаб|(?<!\p{L})донер|дюрюм/u,
  },
  {
    key: 'mexicain',
    emoji: '🌮',
    label: 'Mexicain & tacos',
    synonyms: ['mexicain', 'mexican', 'mexikanisch', 'tacos', 'taco', 'burrito', 'nachos', 'tex-mex', 'texmex', 'quesadilla', 'french tacos', 'мексиканська', 'мексиканська кухня', 'тако', 'буріто', 'начос', 'кесадилья'],
    cuisines: ['mexican', 'tex-mex', 'tacos', 'french_tacos', 'burrito', 'tex_mex'],
    name: /mexic|\btacos?\b|burrito|tex-?mex|quesadill|nacho|мексик|(?<!\p{L})тако(?:с)?(?!\p{L})|бур[іи]то|кесадил/u,
    brands: ["o'tacos", 'tacos king', 'taco bell'],
  },
  {
    key: 'poulet',
    emoji: '🍗',
    label: 'Poulet',
    synonyms: ['poulet', 'chicken', 'nuggets', 'wings', 'huhn', 'pollo', 'poulet frit', 'курка', 'курятина', 'нагетси', 'крильця', 'смажена курка'],
    cuisines: ['chicken', 'fried_chicken', 'wings'],
    name: /chicken|\bpoulets?\b|\bwings\b|\bpollo\b|\bhuhn|(?<!\p{L})(?:курк|курочк|куряч|курят|крильц)/u,
    brands: ['kfc', 'popeyes', 'chicken corner'],
  },
  {
    key: 'asiatique',
    emoji: '🥢',
    label: 'Asiatique',
    synonyms: ['asiatique', 'asian', 'asiatisch', 'asiatico', 'wok', 'coreen', 'korean', 'vietnamien', 'tibetain', 'momo', 'азіиська', 'азіиська кухня', 'паназіиська', 'вок', 'кореиська'],
    cuisines: ['asian', 'korean', 'indonesian', 'malaysian', 'filipino', 'mongolian', 'tibetan', 'fusion_asian', 'pan_asian', 'asian_fusion', 'singaporean', 'taiwanese', 'cambodian', 'laotian'],
    name: /\bwok\b|\basia|asiat|\bkorea|\bcoree|tibet|\bmomo|\bmongol|\bbali\b|indones|(?<!\p{L})азі[яиа]|паназі|(?<!\p{L})вок(?!\p{L})|(?<!\p{L})коре[яи]/u,
    brands: ['kaimug', 'panda express', 'nooch', 'yooji\'s'],
  },
  {
    key: 'chinois',
    emoji: '🥡',
    label: 'Chinois',
    synonyms: ['chinois', 'chinese', 'chinesisch', 'cinese', 'dim sum', 'canard laque', 'китаиська', 'китаиська кухня', 'дім сам'],
    cuisines: ['chinese', 'dim_sum', 'cantonese', 'sichuan', 'szechuan', 'hong_kong'],
    name: /\bchina\b|chinois|chinese|chines|dim ?sum|\bmandarin|canton|shanghai|peking|\bpekin|beijing|sichuan|szechuan|hong ?kong|\bdragon|(?<!\p{L})китаи|(?<!\p{L})пекін|шанхаи|гонконг/u,
    brands: ['panda express'],
    implies: ['asiatique'],
  },
  {
    key: 'thai',
    emoji: '🍤',
    label: 'Thaï',
    synonyms: ['thai', 'thailandais', 'thailand', 'pad thai', 'curry vert', 'таиська', 'таиська кухня', 'пад таи', 'том ям'],
    cuisines: ['thai'],
    name: /\bthai|\bsiam|bangkok|phuket|\bsawasdee|\bkhao\b|(?<!\p{L})таиськ|(?<!\p{L})та[іи]ланд|бангкок|пхукет/u,
    brands: ['kaimug'],
    implies: ['asiatique'],
  },
  {
    key: 'nouilles',
    emoji: '🍜',
    label: 'Ramen, pho & nouilles',
    synonyms: ['ramen', 'nouilles', 'noodles', 'nudeln', 'pho', 'udon', 'vietnamien', 'vietnamese', 'bo bun', 'banh mi', 'рамен', 'локшина', 'фо', 'удон', "в'єтнамська", 'вєтнамська', 'бань мі'],
    cuisines: ['ramen', 'noodle', 'noodles', 'vietnamese', 'udon', 'pho'],
    name: /ramen|noodle|nouille|nudel|\bpho\b|\budon\b|vietnam|saigon|hanoi|banh ?mi|\bbo bun|(?<!\p{L})рамен|локшин|(?<!\p{L})фо(?!\p{L})|в'?єтнам|(?<!\p{L})удон|бань ?мі/u,
    implies: ['asiatique'],
  },
  {
    key: 'indien',
    emoji: '🍛',
    label: 'Indien & népalais',
    synonyms: ['indien', 'indian', 'indisch', 'indiano', 'curry', 'tandoori', 'naan', 'nepalais', 'nepalese', 'sri lanka', 'pakistanais', 'biryani', 'індіиська', 'індіиська кухня', 'карі', 'тандурі', 'непальська', 'біріані'],
    cuisines: ['indian', 'curry', 'nepalese', 'pakistani', 'sri_lankan', 'tamil', 'bangladeshi', 'himalayan'],
    name: /\bindia|indien|indisch|\bcurry|tandoor|masala|bombay|mumbai|delhi|punjab|bollywood|maharaj|taj mahal|ganesh|kerala|himalaya|nepal|everest|kathmandu|\bnamaste|biryani|(?<!\p{L})інді[яи]|тандур|масала|непал|гімала/u,
  },
  {
    key: 'italien',
    emoji: '🍝',
    label: 'Italien & pâtes',
    synonyms: ['italien', 'italian', 'italienisch', 'italiano', 'pates', 'pasta', 'spaghetti', 'lasagne', 'risotto', 'piadina', 'trattoria', 'італіиська', 'італіиська кухня', 'паста', 'спагеті', 'лазанья', 'різото', 'тратторія'],
    cuisines: ['italian', 'pasta', 'piadina', 'italian_pizza', 'risotto'],
    name: /trattoria|osteria|ristorante|\bpasta|spaghett|\bpiadin|\bgrotto\b|\bcucina\b|\bdolce vita|(?<!\p{L})італ|траттор|остері|(?<!\p{L})паст[аи](?!\p{L})|спагет/u,
    brands: ["l'osteria", 'vapiano', 'molino', 'la piadineria', 'spiga', 'santa lucia', 'bindella', 'mamma mia'],
  },
  {
    key: 'oriental',
    emoji: '🧆',
    label: 'Libanais & oriental',
    synonyms: ['libanais', 'lebanese', 'libanesisch', 'oriental', 'falafel', 'mezze', 'houmous', 'hummus', 'couscous', 'marocain', 'syrien', 'persan', 'afghan', 'turc', 'ліванська', 'східна кухня', 'фалафель', 'хумус', 'кускус', 'узбецька', 'плов', 'лагман', 'турецька', 'чаихана'],
    cuisines: ['lebanese', 'falafel', 'middle_eastern', 'arab', 'syrian', 'persian', 'iranian', 'oriental', 'moroccan', 'afghan', 'tunisian', 'algerian', 'israeli', 'kurdish'],
    name: /falafel|\bliban|leban|liban|mezze|\bmeze\b|\borient|couscous|\bmaroc|marrakech|morocc|\bpersi|\biran|\bafghan|\bsyri|beirut|beyrouth|\bhummus|\bhoumous|ліван|фалафел|хумус|кускус|марокк|(?<!\p{L})перськ|узбек|(?<!\p{L})плов(?!\p{L})|лагман|чаихан|східна кухня|(?<!\p{L})сиріиськ/u,
  },
  {
    key: 'grec',
    emoji: '🫒',
    label: 'Grec',
    synonyms: ['grec', 'greek', 'griechisch', 'greco', 'gyros', 'souvlaki', 'tzatziki', 'moussaka', 'грецька', 'грецька кухня', 'гірос', 'сувлакі', 'мусака'],
    cuisines: ['greek', 'gyros'],
    name: /\bgreek|\bgrec\b|\bgrecque|griech|taverna|\bgyros|souvlaki|hellas|akropolis|acropol|mykonos|santorin|\bkreta|\bcrete\b|грецьк|(?<!\p{L})гірос|сувлак/u,
  },
  {
    key: 'espagnol',
    emoji: '🥘',
    label: 'Espagnol & portugais',
    synonyms: ['espagnol', 'spanish', 'spanisch', 'tapas', 'paella', 'portugais', 'portuguese', 'portugiesisch', 'bresilien', 'brazilian', 'peruvien', 'іспанська', 'іспанська кухня', 'тапас', 'паелья', 'португальська', 'бразильська'],
    cuisines: ['spanish', 'portuguese', 'tapas', 'paella', 'brazilian', 'peruvian', 'latin_american', 'argentinian', 'colombian', 'venezuelan'],
    name: /tapas|\bbodega|espan|spanish|paella|portug|iberic|\bbrasil|\bbrazil|\bperu|(?<!\p{L})іспан|тапас|паель|португал|бразил|перуанськ/u,
  },
  {
    key: 'suisse',
    emoji: '🇨🇭',
    label: 'Cuisine suisse',
    synonyms: ['suisse', 'swiss', 'schweizer', 'schweizerisch', 'svizzero', 'regional', 'regionale', 'terroir', 'local', 'rosti', 'traditionnel', 'pinte', 'beiz', 'швеицарська', 'швеицарська кухня'],
    cuisines: ['regional', 'swiss', 'local', 'schweiz', 'suisse', 'schweizerisch', 'swiss_regional', 'alpine', 'traditional', 'saisonal', 'seasonal', 'rosti'],
    name: /\brosti|\bpinte\b|\bbeizli?\b|\bstubli\b|\bfondue|\braclette|\bswiss\b|\bsuisse\b|\balpage\b|\bbuvette\b/,
    brands: ['migros restaurant', 'coop restaurant', 'manora'],
    countries: ['ch'],
  },
  {
    key: 'ukrainien',
    emoji: '🥟',
    label: 'Cuisine ukrainienne',
    synonyms: ['ukrainien', 'ukrainienne', 'ukrainian', 'ukrainisch', 'ucraino', 'varenyky', 'borscht', 'borsch', 'украінська', 'украінська кухня', 'вареники', 'борщ', 'деруни', 'галушки', 'голубці', 'домашня кухня'],
    cuisines: ['ukrainian', 'regional', 'local', 'traditional', 'national', 'home_made', 'homemade', 'dumplings', 'varenyky'],
    // Folded (fold: ї → і, й → и): вареники, борщ, деруни, галушки, «українська кухня».
    name: /вареник|(?<!\p{L})борщ|деруни|галушк|украінськ|голубц|пузата хата/u,
    countries: ['ua'],
  },
  {
    key: 'fondue',
    emoji: '🫕',
    label: 'Fondue & raclette',
    synonyms: ['fondue', 'raclette', 'fromage', 'cheese', 'kase', 'formaggio', 'croute au fromage', 'malakoff', 'фондю', 'раклет'],
    cuisines: ['fondue', 'raclette', 'cheese', 'swiss_fondue'],
    name: /fondue|raclette|fromager|\bkase|malakoff|\bcaquelon/,
    implies: ['suisse'],
    countries: ['ch'],
  },
  {
    key: 'francais',
    emoji: '🥖',
    label: 'Français & brasserie',
    synonyms: ['francais', 'french', 'franzosisch', 'francese', 'brasserie', 'bistro', 'bistrot', 'savoyard', 'alsacien', 'французька', 'французька кухня', 'бістро', 'брасері'],
    cuisines: ['french', 'brasserie', 'bistro', 'bistrot', 'alsatian', 'savoyard', 'lyonnaise'],
    name: /brasserie|\bbistr?ot?\b|\bfrancais|\bfrench\b|savoyard|французьк|брасері/u,
    brands: ['au bureau', 'buffalo grill'],
  },
  {
    key: 'grill',
    emoji: '🥩',
    label: 'Grill & steak',
    synonyms: ['grill', 'steak', 'viande', 'barbecue', 'bbq', 'entrecote', 'cote de boeuf', 'fleisch', 'carne', 'churrasco', 'tartare', 'smash', 'гриль', 'стеик', 'стеики', 'шашлик', 'барбекю', 'мангал', "м'ясо"],
    cuisines: ['steak_house', 'steakhouse', 'steak', 'grill', 'bar_and_grill', 'barbecue', 'bbq', 'meat', 'beef', 'argentinian', 'tartare', 'churrasco', 'smokehouse'],
    name: /grill|steak|\bbbq\b|barbecue|churrasc|\basado\b|smokehouse|rotisserie|\bboucherie|\bmetzg|entrecote|beefhouse|гриль|стеик|шашли[кч]|барбекю|(?<!\p{L})мангал/u,
    brands: ['buffalo grill', 'old wild west', 'outback steakhouse'],
  },
  {
    key: 'poisson',
    emoji: '🐟',
    label: 'Poisson & fruits de mer',
    synonyms: ['poisson', 'fish', 'fisch', 'pesce', 'perche', 'filets de perche', 'fruits de mer', 'seafood', 'moules', 'fish and chips', 'crevettes', 'риба', 'рибнии', 'морепродукти', 'мідіі', 'устриці', 'креветки'],
    cuisines: ['fish', 'seafood', 'fish_and_chips', 'oyster', 'mussels'],
    name: /poisson|fisch(?!er\b)|\bfish|seafood|\bperches?\b|pecheur|fruits de mer|\bmoules\b|\bhuitres|crustac|oyster|(?<!\p{L})риб(?:а|и|ка|н)|морепродукт|устриц|(?<!\p{L})міді[іи]/u,
    brands: ['nordsee'],
  },
  {
    key: 'vegetarien',
    emoji: '🌱',
    label: 'Végétarien & vegan',
    synonyms: ['vegetarien', 'vegetarian', 'vegetarisch', 'vegan', 'vegane', 'veggie', 'vegetalien', 'plant based', 'вегетаріанська', 'вегетаріанське', 'веган', 'веганська', 'веганське'],
    cuisines: ['vegetarian', 'vegan', 'plant_based', 'veggie'],
    name: /\bvegan|\bveggie|vegetari|vegetal|вегетаріан|(?<!\p{L})веган/u,
    brands: ['tibits', 'hiltl', 'roots'],
  },
  {
    key: 'salade',
    emoji: '🥗',
    label: 'Salades & bowls',
    synonyms: ['salade', 'salad', 'salat', 'insalata', 'bowl', 'poke', 'healthy', 'jus', 'juice', 'smoothie', 'soupe', 'soup', 'салат', 'салати', 'боул', 'поке', 'смузі', 'фреш', 'сік', 'суп', 'супи', 'здорова іжа'],
    cuisines: ['salad', 'bowl', 'poke', 'healthy', 'juice', 'soup', 'hawaiian', 'smoothie', 'smoothie_juice', 'acai'],
    name: /\bsalad|\bsalat|\bbowls?\b|\bpoke\b|\bhealthy|\bjuice|smoothie|\bsoupe?s?\b|салат|(?<!\p{L})боул|(?<!\p{L})поке(?!\p{L})|смузі|(?<!\p{L})супи?(?!\p{L})/u,
    brands: ['joe & the juice', 'hitzberger', 'green bowl'],
  },
  {
    key: 'sandwich',
    emoji: '🥪',
    label: 'Sandwich & bretzels',
    synonyms: ['sandwich', 'sandwiches', 'bagel', 'panini', 'wrap', 'wraps', 'bretzel', 'brezel', 'pretzel', 'sub', 'croque', 'сендвіч', 'сендвічі', 'сандвіч', 'бутерброд', 'бутерброди', 'паніні', 'беигл', 'брецель', 'врап'],
    cuisines: ['sandwich', 'bagel', 'wraps', 'wrap', 'panini', 'deli', 'pretzel', 'sub', 'toast', 'croque'],
    name: /sandwich|\bbagel|panini|\bwraps?\b|\bdeli\b|brezel|bretzel|pretzel|\bcroque|сендвіч|сандвіч|бутерброд|(?<!\p{L})панін|брецел|беигл/u,
    brands: ['subway', 'brezelkonig', 'backwerk', 'zopf & zopfli', 'joe & the juice', 'la piadineria', 'pret a manger'],
  },
  {
    key: 'hotdog',
    emoji: '🌭',
    label: 'Hot-dog & saucisses',
    synonyms: ['hot dog', 'hotdog', 'saucisse', 'saucisses', 'wurst', 'bratwurst', 'cervelas', 'cervelat', 'currywurst', 'salsiccia', 'хот-дог', 'хот дог', 'хотдог', 'сосиска', 'сосиски', 'ковбаски'],
    cuisines: ['hot_dog', 'sausage', 'bratwurst', 'currywurst', 'wurst'],
    name: /hot ?dog|wurst|saucisse|cervela|хот[- ]?дог|(?<!\p{L})сосиск|ковбаск/u,
  },
  {
    key: 'crepes',
    emoji: '🥞',
    label: 'Crêpes & gaufres',
    synonyms: ['crepe', 'crepes', 'creperie', 'galette', 'gaufre', 'gaufres', 'waffle', 'waffel', 'pancake', 'pancakes', 'pfannkuchen', 'млинці', 'млинчики', 'налисники', 'вафлі', 'панкеики'],
    cuisines: ['crepe', 'crepes', 'pancake', 'pancakes', 'savory_pancakes', 'waffle', 'waffles', 'galette'],
    name: /\bcrep|galette|gaufre|waffel|waffle|pancake|pfannkuchen|млинц|млинчик|налисник|вафл|панкеик/u,
  },
  {
    key: 'glace',
    emoji: '🍦',
    label: 'Glaces',
    synonyms: ['glace', 'glaces', 'gelato', 'gelati', 'ice cream', 'eis', 'glacier', 'sorbet', 'frozen yogurt', 'froyo', 'морозиво', 'джелато', 'сорбет', 'фрозен иогурт'],
    cuisines: ['ice_cream', 'frozen_yogurt', 'gelato', 'frozen_yoghurt'],
    name: /gelat|\bglaces?\b|eiscafe|eisdiele|ice ?cream|frozen yog|\bsorbet|морозив|джелат|(?<!\p{L})сорбет/u,
    brands: ['gelateria di berna', 'amorino', 'movenpick', 'kalte lust', 'gelato'],
  },
  {
    key: 'dessert',
    emoji: '🍰',
    label: 'Pâtisserie & desserts',
    synonyms: ['patisserie', 'gateau', 'gateaux', 'dessert', 'desserts', 'cake', 'donut', 'donuts', 'confiserie', 'konditorei', 'tea-room', 'tea room', 'chocolat', 'macaron', 'десерт', 'десерти', 'торт', 'торти', 'тістечка', 'кондитерська', 'випічка', 'пекарня', 'пончики', 'шоколад', 'солодощі', 'штрудель'],
    cuisines: ['cake', 'dessert', 'pastry', 'donut', 'chocolate', 'confectionery', 'patisserie', 'cupcake', 'macaron', 'churros'],
    name: /patisser|konditor|confiser|tea ?-?room|\bdonut|\bcakes?\b|\btorte|\bgateaux?\b|dessert|macaron|chocolat|\bchurros|кондитер|тістеч|(?<!\p{L})торт(?:и|ів)?(?!\p{L})|десерт|солодощ|пончик|шоколад|еклер|чізкеик|штрудел|(?<!\p{L})пекарн|випічк/u,
    brands: ["dunkin'", 'dunkin donuts', 'bachmann', 'steiner', 'hitzberger', 'sprungli', 'confiserie sprungli', 'laderach', 'fleischli', 'frei', 'wust', 'speck', 'hausammann', 'buchmann', 'walter buchmann'],
  },
  {
    key: 'brunch',
    emoji: '🍳',
    label: 'Petit-déjeuner & brunch',
    synonyms: ['brunch', 'petit dejeuner', 'petit-dejeuner', 'breakfast', 'fruhstuck', 'colazione', 'croissant', 'сніданок', 'сніданки', 'бранч', 'круасан', 'круасани'],
    cuisines: ['breakfast', 'brunch', 'breakfast_and_brunch'],
    name: /brunch|breakfast|fruhstuck|\bbreakfast|сніданк|сніданок|бранч/u,
    brands: ['le pain quotidien'],
  },
  {
    key: 'bubbletea',
    emoji: '🧋',
    label: 'Bubble tea',
    synonyms: ['bubble tea', 'boba', 'bubbletea', 'the aux perles', 'бабл ті', 'бабл-ті', 'бабл чаи'],
    cuisines: ['bubble_tea', 'boba'],
    name: /bubble ?tea|\bboba\b|бабл[- ]?ті/u,
  },
  {
    key: 'cafe',
    emoji: '☕',
    label: 'Café',
    synonyms: ['cafe', 'coffee', 'kaffee', 'caffe', 'espresso', 'cappuccino', 'latte', 'the', 'tea', 'tea room', "кав'ярня", "кав'ярні", 'кавярня', 'кава', 'кафе', 'еспресо', 'капучино', 'лате', 'чаи', 'чаина'],
    cuisines: ['coffee_shop', 'coffee', 'cafe', 'tea', 'teahouse', 'tea_room'],
    name: /\bcoffee|кав'?ярн|(?<!\p{L})кава(?!\p{L})/u,
    brands: ['starbucks', 'caffe spettacolo', 'mccafe', 'segafredo', 'wild bean cafe', 'nespresso', 'vicafe', "dunkin'"],
    generic: true,
  },
  {
    key: 'fastfood',
    emoji: '🍟',
    label: 'Fast-food & snack',
    synonyms: ['fast food', 'fast-food', 'fastfood', 'snack', 'frites', 'fries', 'pommes', 'take away', 'a l emporter', 'imbiss', 'фастфуд', 'фаст-фуд', 'фаст фуд', 'стрітфуд', 'перекус', 'картопля фрі', 'фрі', 'іжа з собою'],
    cuisines: ['fries', 'friture', 'fast_food', 'snack', 'snacks', 'chips'],
    name: /\bsnack|take ?away|\bimbiss|fast ?food|friterie|\bfrites\b|фаст[- ]?фуд|стріт[- ]?фуд|(?<!\p{L})снек/u,
    brands: ['migros take away', 'coop take it'],
    generic: true,
  },
  {
    key: 'restaurant',
    emoji: '🍽️',
    label: 'Restaurant',
    synonyms: ['restaurant', 'resto', 'ristorante', 'gasthaus', 'gasthof', 'wirtschaft', 'manger', 'diner', 'souper', 'repas', 'ресторан', 'ресторани', 'ідальня', 'поісти', 'обід', 'вечеря', 'іжа'],
    generic: true,
  },
];

export const FOOD_BY_KEY = new Map(FOODS.map((f) => [f.key, f]));
export const FOOD_ORDER = new Map(FOODS.map((f, i) => [f.key, i]));

/** OSM amenity → the generic type every such place has. */
const KIND_FOOD: Record<string, string> = {
  restaurant: 'restaurant',
  biergarten: 'restaurant',
  fast_food: 'fastfood',
  food_court: 'fastfood',
  cafe: 'cafe',
  ice_cream: 'glace',
};

const CUISINE_FOOD = new Map<string, string[]>();
const BRAND_FOOD = new Map<string, string[]>();
for (const f of FOODS) {
  for (const c of f.cuisines ?? []) CUISINE_FOOD.set(c, [...(CUISINE_FOOD.get(c) ?? []), f.key]);
  for (const b of f.brands ?? []) BRAND_FOOD.set(b, [...(BRAND_FOOD.get(b) ?? []), f.key]);
}

/** The food types of an OSM place, from its kind, cuisine, brand, diet tags and name. */
/** Whether a food type is one of a country's (ISO code, lower case). */
export const foodIn = (f: Food, country: string): boolean => !f.countries || f.countries.includes(country);

export function classify(tags: Record<string, string | undefined>, country = 'ch'): string[] {
  const out = new Set<string>();
  const kind = tags.amenity ?? '';
  const generic = KIND_FOOD[kind];
  if (generic) out.add(generic);

  const cuisines = (tags.cuisine ?? '')
    .split(/[;,]/)
    .map((c) => c.trim().toLowerCase().replace(/\s+/g, '_'))
    .filter(Boolean);
  for (const c of cuisines) {
    for (const k of CUISINE_FOOD.get(c) ?? []) out.add(k);
    // A Turkish fast food is a kebab shop; a Turkish restaurant goes with the oriental ones.
    if (c === 'turkish') out.add(kind === 'fast_food' ? 'kebab' : 'oriental');
  }

  const name = fold(tags.name ?? '');
  for (const b of [fold(tags.brand ?? ''), name]) for (const k of BRAND_FOOD.get(b) ?? []) out.add(k);
  if (name) for (const f of FOODS) if (f.name?.test(name)) out.add(f.key);

  if (tags['diet:vegetarian'] === 'only' || tags['diet:vegan'] === 'only' || tags['diet:vegan'] === 'yes') out.add('vegetarien');

  for (const k of [...out]) for (const i of FOOD_BY_KEY.get(k)?.implies ?? []) out.add(i);
  return [...out].filter((k) => foodIn(FOOD_BY_KEY.get(k)!, country)).sort((a, b) => (FOOD_ORDER.get(a) ?? 0) - (FOOD_ORDER.get(b) ?? 0));
}

/**
 * Food types for a search text, best first: a synonym or label equal to the text, then one
 * starting with it, then one containing it.
 */
export function matchFoods(q: string): string[] {
  return rankMatches(FOODS, q);
}
