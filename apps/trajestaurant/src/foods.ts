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
 * type first. Labels are French; synonyms (folded: lower case, no accents) let one search in
 * French, German, Italian or English.
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
}

export const FOODS: Food[] = [
  {
    key: 'pizza',
    emoji: '🍕',
    label: 'Pizza',
    synonyms: ['pizza', 'pizzeria', 'pizze', 'pinsa'],
    cuisines: ['pizza', 'italian_pizza', 'pinsa'],
    name: /pizz|\bpinsa/,
    brands: ["domino's", "domino's pizza", 'pizza hut', 'dieci', 'santa lucia', 'molino', "l'osteria", 'vapiano'],
  },
  {
    key: 'burger',
    emoji: '🍔',
    label: 'Burger',
    synonyms: ['burger', 'hamburger', 'cheeseburger', 'burgers'],
    cuisines: ['burger', 'burgers', 'hamburger'],
    name: /burger(?!gemeinde|haus|spital|stube|saal|zunft|heim)/,
    brands: ["mcdonald's", 'mcdonalds', 'burger king', 'five guys', 'hans im gluck', 'holy cow!', 'holy cow', 'burger & friends', 'black tap'],
  },
  {
    key: 'sushi',
    emoji: '🍣',
    label: 'Sushi & japonais',
    synonyms: ['sushi', 'japonais', 'japanese', 'japanisch', 'giapponese', 'maki', 'sashimi', 'japon'],
    cuisines: ['sushi', 'japanese'],
    name: /sushi|\bjapan|\bjapon|tokyo|kyoto|osaka|nippon|izakaya|\bsakura\b|\bmaki\b|samurai/,
    brands: ["yooji's", 'sushi shop', 'sushi mania', 'sushi zen'],
    implies: ['asiatique'],
  },
  {
    key: 'kebab',
    emoji: '🥙',
    label: 'Kebab',
    synonyms: ['kebab', 'kebap', 'doner', 'durum', 'shawarma', 'shawerma', 'pide', 'lahmacun', 'turc', 'turkish'],
    cuisines: ['kebab', 'doner', 'doner_kebab', 'shawarma', 'pide', 'lahmacun', 'durum'],
    name: /keba[bp]|\bdoner|\bdurum|shawarm|shawerm|\blahmacun|\bpide\b/,
  },
  {
    key: 'mexicain',
    emoji: '🌮',
    label: 'Mexicain & tacos',
    synonyms: ['mexicain', 'mexican', 'mexikanisch', 'tacos', 'taco', 'burrito', 'nachos', 'tex-mex', 'texmex', 'quesadilla', 'french tacos'],
    cuisines: ['mexican', 'tex-mex', 'tacos', 'french_tacos', 'burrito', 'tex_mex'],
    name: /mexic|\btacos?\b|burrito|tex-?mex|quesadill|nacho/,
    brands: ["o'tacos", 'tacos king', 'taco bell'],
  },
  {
    key: 'poulet',
    emoji: '🍗',
    label: 'Poulet',
    synonyms: ['poulet', 'chicken', 'nuggets', 'wings', 'huhn', 'pollo', 'poulet frit'],
    cuisines: ['chicken', 'fried_chicken', 'wings'],
    name: /chicken|\bpoulets?\b|\bwings\b|\bpollo\b|\bhuhn/,
    brands: ['kfc', 'popeyes', 'chicken corner'],
  },
  {
    key: 'asiatique',
    emoji: '🥢',
    label: 'Asiatique',
    synonyms: ['asiatique', 'asian', 'asiatisch', 'asiatico', 'wok', 'coreen', 'korean', 'vietnamien', 'tibetain', 'momo'],
    cuisines: ['asian', 'korean', 'indonesian', 'malaysian', 'filipino', 'mongolian', 'tibetan', 'fusion_asian', 'pan_asian', 'asian_fusion', 'singaporean', 'taiwanese', 'cambodian', 'laotian'],
    name: /\bwok\b|\basia|asiat|\bkorea|\bcoree|tibet|\bmomo|\bmongol|\bbali\b|indones/,
    brands: ['kaimug', 'panda express', 'nooch', 'yooji\'s'],
  },
  {
    key: 'chinois',
    emoji: '🥡',
    label: 'Chinois',
    synonyms: ['chinois', 'chinese', 'chinesisch', 'cinese', 'dim sum', 'canard laque'],
    cuisines: ['chinese', 'dim_sum', 'cantonese', 'sichuan', 'szechuan', 'hong_kong'],
    name: /\bchina\b|chinois|chinese|chines|dim ?sum|\bmandarin|canton|shanghai|peking|\bpekin|beijing|sichuan|szechuan|hong ?kong|\bdragon/,
    brands: ['panda express'],
    implies: ['asiatique'],
  },
  {
    key: 'thai',
    emoji: '🍤',
    label: 'Thaï',
    synonyms: ['thai', 'thailandais', 'thailand', 'pad thai', 'curry vert'],
    cuisines: ['thai'],
    name: /\bthai|\bsiam|bangkok|phuket|\bsawasdee|\bkhao\b/,
    brands: ['kaimug'],
    implies: ['asiatique'],
  },
  {
    key: 'nouilles',
    emoji: '🍜',
    label: 'Ramen, pho & nouilles',
    synonyms: ['ramen', 'nouilles', 'noodles', 'nudeln', 'pho', 'udon', 'vietnamien', 'vietnamese', 'bo bun', 'banh mi'],
    cuisines: ['ramen', 'noodle', 'noodles', 'vietnamese', 'udon', 'pho'],
    name: /ramen|noodle|nouille|nudel|\bpho\b|\budon\b|vietnam|saigon|hanoi|banh ?mi|\bbo bun/,
    implies: ['asiatique'],
  },
  {
    key: 'indien',
    emoji: '🍛',
    label: 'Indien & népalais',
    synonyms: ['indien', 'indian', 'indisch', 'indiano', 'curry', 'tandoori', 'naan', 'nepalais', 'nepalese', 'sri lanka', 'pakistanais', 'biryani'],
    cuisines: ['indian', 'curry', 'nepalese', 'pakistani', 'sri_lankan', 'tamil', 'bangladeshi', 'himalayan'],
    name: /\bindia|indien|indisch|\bcurry|tandoor|masala|bombay|mumbai|delhi|punjab|bollywood|maharaj|taj mahal|ganesh|kerala|himalaya|nepal|everest|kathmandu|\bnamaste|biryani/,
  },
  {
    key: 'italien',
    emoji: '🍝',
    label: 'Italien & pâtes',
    synonyms: ['italien', 'italian', 'italienisch', 'italiano', 'pates', 'pasta', 'spaghetti', 'lasagne', 'risotto', 'piadina', 'trattoria'],
    cuisines: ['italian', 'pasta', 'piadina', 'italian_pizza', 'risotto'],
    name: /trattoria|osteria|ristorante|\bpasta|spaghett|\bpiadin|\bgrotto\b|\bcucina\b|\bdolce vita/,
    brands: ["l'osteria", 'vapiano', 'molino', 'la piadineria', 'spiga', 'santa lucia', 'bindella', 'mamma mia'],
  },
  {
    key: 'oriental',
    emoji: '🧆',
    label: 'Libanais & oriental',
    synonyms: ['libanais', 'lebanese', 'libanesisch', 'oriental', 'falafel', 'mezze', 'houmous', 'hummus', 'couscous', 'marocain', 'syrien', 'persan', 'afghan', 'turc'],
    cuisines: ['lebanese', 'falafel', 'middle_eastern', 'arab', 'syrian', 'persian', 'iranian', 'oriental', 'moroccan', 'afghan', 'tunisian', 'algerian', 'israeli', 'kurdish'],
    name: /falafel|\bliban|leban|liban|mezze|\bmeze\b|\borient|couscous|\bmaroc|marrakech|morocc|\bpersi|\biran|\bafghan|\bsyri|beirut|beyrouth|\bhummus|\bhoumous/,
  },
  {
    key: 'grec',
    emoji: '🫒',
    label: 'Grec',
    synonyms: ['grec', 'greek', 'griechisch', 'greco', 'gyros', 'souvlaki', 'tzatziki', 'moussaka'],
    cuisines: ['greek', 'gyros'],
    name: /\bgreek|\bgrec\b|\bgrecque|griech|taverna|\bgyros|souvlaki|hellas|akropolis|acropol|mykonos|santorin|\bkreta|\bcrete\b/,
  },
  {
    key: 'espagnol',
    emoji: '🥘',
    label: 'Espagnol & portugais',
    synonyms: ['espagnol', 'spanish', 'spanisch', 'tapas', 'paella', 'portugais', 'portuguese', 'portugiesisch', 'bresilien', 'brazilian', 'peruvien'],
    cuisines: ['spanish', 'portuguese', 'tapas', 'paella', 'brazilian', 'peruvian', 'latin_american', 'argentinian', 'colombian', 'venezuelan'],
    name: /tapas|\bbodega|espan|spanish|paella|portug|iberic|\bbrasil|\bbrazil|\bperu/,
  },
  {
    key: 'suisse',
    emoji: '🇨🇭',
    label: 'Cuisine suisse',
    synonyms: ['suisse', 'swiss', 'schweizer', 'schweizerisch', 'svizzero', 'regional', 'regionale', 'terroir', 'local', 'rosti', 'traditionnel', 'pinte', 'beiz'],
    cuisines: ['regional', 'swiss', 'local', 'schweiz', 'suisse', 'schweizerisch', 'swiss_regional', 'alpine', 'traditional', 'saisonal', 'seasonal', 'rosti'],
    name: /\brosti|\bpinte\b|\bbeizli?\b|\bstubli\b|\bfondue|\braclette|\bswiss\b|\bsuisse\b|\balpage\b|\bbuvette\b/,
    brands: ['migros restaurant', 'coop restaurant', 'manora'],
  },
  {
    key: 'fondue',
    emoji: '🫕',
    label: 'Fondue & raclette',
    synonyms: ['fondue', 'raclette', 'fromage', 'cheese', 'kase', 'formaggio', 'croute au fromage', 'malakoff'],
    cuisines: ['fondue', 'raclette', 'cheese', 'swiss_fondue'],
    name: /fondue|raclette|fromager|\bkase|malakoff|\bcaquelon/,
    implies: ['suisse'],
  },
  {
    key: 'francais',
    emoji: '🥖',
    label: 'Français & brasserie',
    synonyms: ['francais', 'french', 'franzosisch', 'francese', 'brasserie', 'bistro', 'bistrot', 'savoyard', 'alsacien'],
    cuisines: ['french', 'brasserie', 'bistro', 'bistrot', 'alsatian', 'savoyard', 'lyonnaise'],
    name: /brasserie|\bbistr?ot?\b|\bfrancais|\bfrench\b|savoyard/,
    brands: ['au bureau', 'buffalo grill'],
  },
  {
    key: 'grill',
    emoji: '🥩',
    label: 'Grill & steak',
    synonyms: ['grill', 'steak', 'viande', 'barbecue', 'bbq', 'entrecote', 'cote de boeuf', 'fleisch', 'carne', 'churrasco', 'tartare', 'smash'],
    cuisines: ['steak_house', 'steakhouse', 'steak', 'grill', 'bar_and_grill', 'barbecue', 'bbq', 'meat', 'beef', 'argentinian', 'tartare', 'churrasco', 'smokehouse'],
    name: /grill|steak|\bbbq\b|barbecue|churrasc|\basado\b|smokehouse|rotisserie|\bboucherie|\bmetzg|entrecote|beefhouse/,
    brands: ['buffalo grill', 'old wild west', 'outback steakhouse'],
  },
  {
    key: 'poisson',
    emoji: '🐟',
    label: 'Poisson & fruits de mer',
    synonyms: ['poisson', 'fish', 'fisch', 'pesce', 'perche', 'filets de perche', 'fruits de mer', 'seafood', 'moules', 'fish and chips', 'crevettes'],
    cuisines: ['fish', 'seafood', 'fish_and_chips', 'oyster', 'mussels'],
    name: /poisson|fisch(?!er\b)|\bfish|seafood|\bperches?\b|pecheur|fruits de mer|\bmoules\b|\bhuitres|crustac|oyster/,
    brands: ['nordsee'],
  },
  {
    key: 'vegetarien',
    emoji: '🌱',
    label: 'Végétarien & vegan',
    synonyms: ['vegetarien', 'vegetarian', 'vegetarisch', 'vegan', 'vegane', 'veggie', 'vegetalien', 'plant based'],
    cuisines: ['vegetarian', 'vegan', 'plant_based', 'veggie'],
    name: /\bvegan|\bveggie|vegetari|vegetal/,
    brands: ['tibits', 'hiltl', 'roots'],
  },
  {
    key: 'salade',
    emoji: '🥗',
    label: 'Salades & bowls',
    synonyms: ['salade', 'salad', 'salat', 'insalata', 'bowl', 'poke', 'healthy', 'jus', 'juice', 'smoothie', 'soupe', 'soup'],
    cuisines: ['salad', 'bowl', 'poke', 'healthy', 'juice', 'soup', 'hawaiian', 'smoothie', 'smoothie_juice', 'acai'],
    name: /\bsalad|\bsalat|\bbowls?\b|\bpoke\b|\bhealthy|\bjuice|smoothie|\bsoupe?s?\b/,
    brands: ['joe & the juice', 'hitzberger', 'green bowl'],
  },
  {
    key: 'sandwich',
    emoji: '🥪',
    label: 'Sandwich & bretzels',
    synonyms: ['sandwich', 'sandwiches', 'bagel', 'panini', 'wrap', 'wraps', 'bretzel', 'brezel', 'pretzel', 'sub', 'croque'],
    cuisines: ['sandwich', 'bagel', 'wraps', 'wrap', 'panini', 'deli', 'pretzel', 'sub', 'toast', 'croque'],
    name: /sandwich|\bbagel|panini|\bwraps?\b|\bdeli\b|brezel|bretzel|pretzel|\bcroque/,
    brands: ['subway', 'brezelkonig', 'backwerk', 'zopf & zopfli', 'joe & the juice', 'la piadineria', 'pret a manger'],
  },
  {
    key: 'hotdog',
    emoji: '🌭',
    label: 'Hot-dog & saucisses',
    synonyms: ['hot dog', 'hotdog', 'saucisse', 'saucisses', 'wurst', 'bratwurst', 'cervelas', 'cervelat', 'currywurst', 'salsiccia'],
    cuisines: ['hot_dog', 'sausage', 'bratwurst', 'currywurst', 'wurst'],
    name: /hot ?dog|wurst|saucisse|cervela/,
  },
  {
    key: 'crepes',
    emoji: '🥞',
    label: 'Crêpes & gaufres',
    synonyms: ['crepe', 'crepes', 'creperie', 'galette', 'gaufre', 'gaufres', 'waffle', 'waffel', 'pancake', 'pancakes', 'pfannkuchen'],
    cuisines: ['crepe', 'crepes', 'pancake', 'pancakes', 'savory_pancakes', 'waffle', 'waffles', 'galette'],
    name: /\bcrep|galette|gaufre|waffel|waffle|pancake|pfannkuchen/,
  },
  {
    key: 'glace',
    emoji: '🍦',
    label: 'Glaces',
    synonyms: ['glace', 'glaces', 'gelato', 'gelati', 'ice cream', 'eis', 'glacier', 'sorbet', 'frozen yogurt', 'froyo'],
    cuisines: ['ice_cream', 'frozen_yogurt', 'gelato', 'frozen_yoghurt'],
    name: /gelat|\bglaces?\b|eiscafe|eisdiele|ice ?cream|frozen yog|\bsorbet/,
    brands: ['gelateria di berna', 'amorino', 'movenpick', 'kalte lust', 'gelato'],
  },
  {
    key: 'dessert',
    emoji: '🍰',
    label: 'Pâtisserie & desserts',
    synonyms: ['patisserie', 'gateau', 'gateaux', 'dessert', 'desserts', 'cake', 'donut', 'donuts', 'confiserie', 'konditorei', 'tea-room', 'tea room', 'chocolat', 'macaron'],
    cuisines: ['cake', 'dessert', 'pastry', 'donut', 'chocolate', 'confectionery', 'patisserie', 'cupcake', 'macaron', 'churros'],
    name: /patisser|konditor|confiser|tea ?-?room|\bdonut|\bcakes?\b|\btorte|\bgateaux?\b|dessert|macaron|chocolat|\bchurros/,
    brands: ["dunkin'", 'dunkin donuts', 'bachmann', 'steiner', 'hitzberger', 'sprungli', 'confiserie sprungli', 'laderach', 'fleischli', 'frei', 'wust', 'speck', 'hausammann', 'buchmann', 'walter buchmann'],
  },
  {
    key: 'brunch',
    emoji: '🍳',
    label: 'Petit-déjeuner & brunch',
    synonyms: ['brunch', 'petit dejeuner', 'petit-dejeuner', 'breakfast', 'fruhstuck', 'colazione', 'croissant'],
    cuisines: ['breakfast', 'brunch', 'breakfast_and_brunch'],
    name: /brunch|breakfast|fruhstuck|\bbreakfast/,
    brands: ['le pain quotidien'],
  },
  {
    key: 'bubbletea',
    emoji: '🧋',
    label: 'Bubble tea',
    synonyms: ['bubble tea', 'boba', 'bubbletea', 'the aux perles'],
    cuisines: ['bubble_tea', 'boba'],
    name: /bubble ?tea|\bboba\b/,
  },
  {
    key: 'cafe',
    emoji: '☕',
    label: 'Café',
    synonyms: ['cafe', 'coffee', 'kaffee', 'caffe', 'espresso', 'cappuccino', 'latte', 'the', 'tea', 'tea room'],
    cuisines: ['coffee_shop', 'coffee', 'cafe', 'tea', 'teahouse', 'tea_room'],
    brands: ['starbucks', 'caffe spettacolo', 'mccafe', 'segafredo', 'wild bean cafe', 'nespresso', 'vicafe', "dunkin'"],
    generic: true,
  },
  {
    key: 'fastfood',
    emoji: '🍟',
    label: 'Fast-food & snack',
    synonyms: ['fast food', 'fast-food', 'fastfood', 'snack', 'frites', 'fries', 'pommes', 'take away', 'a l emporter', 'imbiss'],
    cuisines: ['fries', 'friture', 'fast_food', 'snack', 'snacks', 'chips'],
    name: /\bsnack|take ?away|\bimbiss|fast ?food|friterie|\bfrites\b/,
    brands: ['migros take away', 'coop take it'],
    generic: true,
  },
  {
    key: 'restaurant',
    emoji: '🍽️',
    label: 'Restaurant',
    synonyms: ['restaurant', 'resto', 'ristorante', 'gasthaus', 'gasthof', 'wirtschaft', 'manger', 'diner', 'souper', 'repas'],
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
export function classify(tags: Record<string, string | undefined>): string[] {
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
  return [...out].sort((a, b) => (FOOD_ORDER.get(a) ?? 0) - (FOOD_ORDER.get(b) ?? 0));
}

/**
 * Food types for a search text, best first: a synonym or label equal to the text, then one
 * starting with it, then one containing it.
 */
export function matchFoods(q: string): string[] {
  return rankMatches(FOODS, q);
}
