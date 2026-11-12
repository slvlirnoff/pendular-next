import { rankMatches } from './text.js';

/**
 * Kinds of places besides food: OSM key=value → pictogram and French label. Food places
 * (amenity=restaurant, fast_food…) show their food type instead (src/foods.ts).
 */
export interface KindInfo {
  emoji: string;
  label: string;
}

const KINDS: Record<string, KindInfo> = {
  'amenity=restaurant': { emoji: '🍽️', label: 'Restaurant' },
  'amenity=fast_food': { emoji: '🍟', label: 'Fast-food' },
  'amenity=cafe': { emoji: '☕', label: 'Café' },
  'amenity=ice_cream': { emoji: '🍦', label: 'Glacier' },
  'amenity=food_court': { emoji: '🍽️', label: 'Food court' },
  'amenity=biergarten': { emoji: '🍺', label: 'Jardin à bière' },
  'amenity=pub': { emoji: '🍺', label: 'Pub' },
  'amenity=bar': { emoji: '🍸', label: 'Bar' },
  'amenity=pharmacy': { emoji: '💊', label: 'Pharmacie' },
  'amenity=fuel': { emoji: '⛽', label: 'Station-service' },
  'amenity=bank': { emoji: '🏦', label: 'Banque' },
  'amenity=post_office': { emoji: '📮', label: 'Poste' },
  'amenity=cinema': { emoji: '🎬', label: 'Cinéma' },
  'amenity=car_rental': { emoji: '🚙', label: 'Location de voitures' },
  'amenity=theatre': { emoji: '🎭', label: 'Théâtre' },
  'amenity=library': { emoji: '📚', label: 'Bibliothèque' },
  'amenity=marketplace': { emoji: '🧺', label: 'Marché' },
  'amenity=doctors': { emoji: '🩺', label: 'Cabinet médical' },
  'amenity=dentist': { emoji: '🦷', label: 'Dentiste' },
  'amenity=clinic': { emoji: '🏥', label: 'Clinique' },
  'shop=supermarket': { emoji: '🛒', label: 'Supermarché' },
  'shop=convenience': { emoji: '🏪', label: 'Épicerie' },
  'shop=department_store': { emoji: '🏬', label: 'Grand magasin' },
  'shop=mall': { emoji: '🏬', label: 'Centre commercial' },
  'shop=country_store': { emoji: '🌾', label: 'Magasin agricole' },
  'shop=bakery': { emoji: '🥐', label: 'Boulangerie' },
  'shop=pastry': { emoji: '🍰', label: 'Pâtisserie' },
  'shop=confectionery': { emoji: '🍬', label: 'Confiserie' },
  'shop=chocolate': { emoji: '🍫', label: 'Chocolaterie' },
  'shop=butcher': { emoji: '🥩', label: 'Boucherie' },
  'shop=cheese': { emoji: '🧀', label: 'Fromagerie' },
  'shop=greengrocer': { emoji: '🥕', label: 'Primeur' },
  'shop=deli': { emoji: '🥖', label: 'Traiteur' },
  'shop=coffee': { emoji: '☕', label: 'Café (magasin)' },
  'shop=tea': { emoji: '🍵', label: 'Thé' },
  'shop=wine': { emoji: '🍷', label: 'Vins' },
  'shop=alcohol': { emoji: '🍾', label: 'Boissons' },
  'shop=beverages': { emoji: '🥤', label: 'Boissons' },
  'shop=kiosk': { emoji: '📰', label: 'Kiosque' },
  'shop=newsagent': { emoji: '📰', label: 'Kiosque' },
  'shop=tobacco': { emoji: '📰', label: 'Tabac' },
  'shop=clothes': { emoji: '👕', label: 'Vêtements' },
  'shop=fashion_accessories': { emoji: '👜', label: 'Accessoires' },
  'shop=bag': { emoji: '👜', label: 'Maroquinerie' },
  'shop=shoes': { emoji: '👟', label: 'Chaussures' },
  'shop=sports': { emoji: '⚽', label: 'Sport' },
  'shop=outdoor': { emoji: '🏔️', label: 'Outdoor' },
  'shop=bicycle': { emoji: '🚲', label: 'Vélos' },
  'shop=furniture': { emoji: '🛋️', label: 'Meubles' },
  'shop=interior_decoration': { emoji: '🖼️', label: 'Décoration' },
  'shop=houseware': { emoji: '🍳', label: 'Articles ménagers' },
  'shop=kitchen': { emoji: '🍳', label: 'Cuisines' },
  'shop=bed': { emoji: '🛏️', label: 'Literie' },
  'shop=doityourself': { emoji: '🔨', label: 'Bricolage' },
  'shop=hardware': { emoji: '🔩', label: 'Quincaillerie' },
  'shop=garden_centre': { emoji: '🌱', label: 'Jardinerie' },
  'shop=florist': { emoji: '💐', label: 'Fleuriste' },
  'shop=electronics': { emoji: '📺', label: 'Électronique' },
  'shop=computer': { emoji: '💻', label: 'Informatique' },
  'shop=mobile_phone': { emoji: '📱', label: 'Téléphonie' },
  'shop=telecommunication': { emoji: '📱', label: 'Téléphonie' },
  'shop=appliance': { emoji: '🧺', label: 'Électroménager' },
  'shop=hairdresser': { emoji: '💇', label: 'Coiffeur' },
  'shop=beauty': { emoji: '💅', label: 'Institut de beauté' },
  'shop=cosmetics': { emoji: '💄', label: 'Cosmétiques' },
  'shop=perfumery': { emoji: '🌸', label: 'Parfumerie' },
  'shop=chemist': { emoji: '🧴', label: 'Droguerie' },
  'shop=optician': { emoji: '👓', label: 'Opticien' },
  'shop=hearing_aids': { emoji: '👂', label: 'Audioprothésiste' },
  'shop=medical_supply': { emoji: '🩹', label: 'Matériel médical' },
  'shop=jewelry': { emoji: '💍', label: 'Bijouterie' },
  'shop=watches': { emoji: '⌚', label: 'Horlogerie' },
  'shop=books': { emoji: '📚', label: 'Librairie' },
  'shop=stationery': { emoji: '✏️', label: 'Papeterie' },
  'shop=toys': { emoji: '🧸', label: 'Jouets' },
  'shop=games': { emoji: '🎲', label: 'Jeux' },
  'shop=video_games': { emoji: '🎮', label: 'Jeux vidéo' },
  'shop=hobby': { emoji: '🎨', label: 'Loisirs créatifs' },
  'shop=craft': { emoji: '🎨', label: 'Bricolage créatif' },
  'shop=music': { emoji: '🎵', label: 'Musique' },
  'shop=musical_instrument': { emoji: '🎸', label: 'Instruments de musique' },
  'shop=gift': { emoji: '🎁', label: 'Cadeaux' },
  'shop=variety_store': { emoji: '🛍️', label: 'Bazar' },
  'shop=second_hand': { emoji: '♻️', label: 'Seconde main' },
  'shop=pet': { emoji: '🐾', label: 'Animalerie' },
  'shop=photo': { emoji: '📷', label: 'Photo' },
  'shop=car': { emoji: '🚗', label: 'Garage (vente)' },
  'shop=car_repair': { emoji: '🔧', label: 'Garage' },
  'shop=car_parts': { emoji: '🔧', label: 'Pièces auto' },
  'shop=tyres': { emoji: '🛞', label: 'Pneus' },
  'shop=motorcycle': { emoji: '🏍️', label: 'Motos' },
  'shop=travel_agency': { emoji: '✈️', label: 'Agence de voyage' },
  'shop=laundry': { emoji: '🧺', label: 'Laverie' },
  'shop=dry_cleaning': { emoji: '👔', label: 'Pressing' },
  'shop=copyshop': { emoji: '🖨️', label: 'Copies' },
  'shop=tattoo': { emoji: '🖋️', label: 'Tatouage' },
  'shop=funeral_directors': { emoji: '🕯️', label: 'Pompes funèbres' },
  'shop=storage_rental': { emoji: '📦', label: 'Garde-meubles' },
  'shop=pawnbroker': { emoji: '💰', label: 'Prêteur sur gage' },
  'shop=lottery': { emoji: '🎟️', label: 'Loterie' },
  'shop=farm': { emoji: '🚜', label: 'Vente à la ferme' },
  'shop=paint': { emoji: '🎨', label: 'Peinture' },
  'shop=tiles': { emoji: '🧱', label: 'Carrelage' },
  'shop=flooring': { emoji: '🧱', label: 'Revêtements de sol' },
  'shop=electrical': { emoji: '💡', label: 'Électricité' },
  'shop=lighting': { emoji: '💡', label: 'Luminaires' },
  'shop=antiques': { emoji: '🏺', label: 'Antiquités' },
  'shop=wholesale': { emoji: '📦', label: 'Grossiste' },
  'shop=truck': { emoji: '🚚', label: 'Camions' },
  'shop=nutrition_supplements': { emoji: '💪', label: 'Compléments alimentaires' },
  'shop=fabric': { emoji: '🧵', label: 'Tissus' },
  'shop=wedding': { emoji: '💍', label: 'Mariage' },
  'shop=baby_goods': { emoji: '🍼', label: 'Puériculture' },
  'shop=frame': { emoji: '🖼️', label: 'Encadrement' },
  'shop=antique': { emoji: '🏺', label: 'Antiquités' },
  'leisure=fitness_centre': { emoji: '🏋️', label: 'Fitness' },
  'leisure=sports_centre': { emoji: '🏟️', label: 'Centre sportif' },
  'leisure=bowling_alley': { emoji: '🎳', label: 'Bowling' },
  'leisure=escape_game': { emoji: '🔐', label: 'Escape game' },
  'leisure=trampoline_park': { emoji: '🤸', label: 'Trampoline' },
  'leisure=water_park': { emoji: '🌊', label: 'Parc aquatique' },
  'leisure=amusement_arcade': { emoji: '🕹️', label: 'Salle de jeux' },
  'leisure=ice_rink': { emoji: '⛸️', label: 'Patinoire' },
  'leisure=swimming_pool': { emoji: '🏊', label: 'Piscine' },
  'tourism=hotel': { emoji: '🏨', label: 'Hôtel' },
  'tourism=motel': { emoji: '🏨', label: 'Motel' },
  'tourism=hostel': { emoji: '🛏️', label: 'Auberge de jeunesse' },
  'tourism=museum': { emoji: '🏛️', label: 'Musée' },
  'tourism=zoo': { emoji: '🦁', label: 'Zoo' },
  'tourism=theme_park': { emoji: '🎢', label: "Parc d'attractions" },
  'tourism=attraction': { emoji: '⭐', label: 'Attraction' },
  'office=employment_agency': { emoji: '💼', label: "Agence d'emploi" },
  'office=insurance': { emoji: '🛡️', label: 'Assurance' },
  'office=estate_agent': { emoji: '🏠', label: 'Agence immobilière' },
};

const BY_KEY: Record<string, KindInfo> = {
  shop: { emoji: '🛍️', label: 'Magasin' },
  amenity: { emoji: '📍', label: 'Lieu' },
  leisure: { emoji: '🎯', label: 'Loisirs' },
  tourism: { emoji: '⭐', label: 'Tourisme' },
  office: { emoji: '🏢', label: 'Bureau' },
};

export function kindInfo(kindKey: string, kind: string): KindInfo {
  return KINDS[`${kindKey}=${kind}`] ?? BY_KEY[kindKey] ?? { emoji: '📍', label: 'Lieu' };
}

/** OSM amenities that are places to eat: they get food types. */
export const FOOD_KINDS = new Set(['restaurant', 'fast_food', 'cafe', 'ice_cream', 'food_court', 'biergarten']);

/** Which tagged places are kept: shops of any kind, and these values of the other keys. */
export const KEPT: Record<string, Set<string> | 'any'> = {
  shop: 'any',
  amenity: new Set([...FOOD_KINDS, 'pub', 'bar', 'pharmacy', 'fuel', 'bank', 'post_office', 'cinema', 'car_rental', 'theatre', 'library', 'marketplace', 'doctors', 'dentist', 'clinic']),
  leisure: new Set(['fitness_centre', 'sports_centre', 'bowling_alley', 'escape_game', 'trampoline_park', 'water_park', 'amusement_arcade', 'ice_rink', 'swimming_pool']),
  tourism: new Set(['hotel', 'motel', 'hostel', 'museum', 'zoo', 'theme_park', 'attraction']),
  office: new Set(['employment_agency', 'insurance', 'estate_agent']),
};

/** The main key and value of a tagged place, when it is one Trajestaurant keeps. */
export function mainKind(tags: Record<string, string | undefined>): { kindKey: string; kind: string } | null {
  for (const key of ['amenity', 'shop', 'leisure', 'tourism', 'office']) {
    const v = tags[key];
    if (!v) continue;
    const keep = KEPT[key];
    if (keep === 'any' ? v !== 'vacant' && v !== 'no' : keep?.has(v)) return { kindKey: key, kind: v };
  }
  return null;
}

/**
 * Kinds of places one can search for ("pharmacie", "coiffeur"…), each covering one or more OSM
 * kinds. Places to eat are searched by food type instead (src/foods.ts). The order is that of the
 * shortcut chips; synonyms are folded (lower case, no accents) and in French, German, Italian and
 * English.
 */
export interface KindSearch {
  key: string;
  emoji: string;
  label: string;
  synonyms: string[];
  /** OSM key=value pairs. */
  kinds: string[];
}

export const KIND_SEARCHES: KindSearch[] = [
  { key: 'supermarche', emoji: '🛒', label: 'Supermarché', kinds: ['shop=supermarket'], synonyms: ['supermarche', 'supermarket', 'supermarkt', 'supermercato', 'courses', 'commissions', 'alimentation', 'lebensmittel', 'grocery'] },
  { key: 'pharmacie', emoji: '💊', label: 'Pharmacie', kinds: ['amenity=pharmacy'], synonyms: ['pharmacie', 'pharmacy', 'apotheke', 'farmacia', 'medicaments'] },
  { key: 'boulangerie', emoji: '🥐', label: 'Boulangerie & pâtisserie', kinds: ['shop=bakery', 'shop=pastry'], synonyms: ['boulangerie', 'bakery', 'backerei', 'beck', 'panetteria', 'pain', 'patisserie', 'konditorei', 'pasticceria'] },
  { key: 'coiffeur', emoji: '💇', label: 'Coiffeur', kinds: ['shop=hairdresser'], synonyms: ['coiffeur', 'coiffeuse', 'coiffure', 'salon de coiffure', 'hairdresser', 'friseur', 'coiffeursalon', 'parrucchiere', 'barbier', 'barber'] },
  { key: 'station', emoji: '⛽', label: 'Station-service', kinds: ['amenity=fuel'], synonyms: ['station service', 'station-service', 'essence', 'benzine', 'carburant', 'diesel', 'fuel', 'tankstelle', 'benzin', 'benzina', 'distributore'] },
  { key: 'poste', emoji: '📮', label: 'Poste', kinds: ['amenity=post_office'], synonyms: ['poste', 'la poste', 'bureau de poste', 'post', 'postoffice', 'posta', 'colis'] },
  { key: 'banque', emoji: '🏦', label: 'Banque', kinds: ['amenity=bank'], synonyms: ['banque', 'bank', 'banca', 'agence bancaire'] },
  { key: 'kiosque', emoji: '📰', label: 'Kiosque & tabac', kinds: ['shop=kiosk', 'shop=newsagent', 'shop=tobacco'], synonyms: ['kiosque', 'kiosk', 'chiosco', 'journaux', 'tabac', 'presse', 'zeitungen', 'tabak'] },
  { key: 'epicerie', emoji: '🏪', label: 'Épicerie', kinds: ['shop=convenience', 'shop=country_store', 'shop=farm', 'shop=greengrocer', 'shop=deli'], synonyms: ['epicerie', 'depanneur', 'dorfladen', 'convenience', 'alimentari', 'primeur', 'fruits et legumes', 'vente a la ferme', 'hofladen', 'traiteur'] },
  { key: 'fitness', emoji: '🏋️', label: 'Fitness', kinds: ['leisure=fitness_centre'], synonyms: ['fitness', 'gym', 'salle de sport', 'musculation', 'fitnesscenter', 'palestra', 'crossfit'] },
  { key: 'vetements', emoji: '👕', label: 'Vêtements', kinds: ['shop=clothes', 'shop=fashion_accessories', 'shop=bag'], synonyms: ['vetements', 'habits', 'mode', 'boutique', 'clothes', 'fashion', 'kleider', 'mode', 'abbigliamento'] },
  { key: 'chaussures', emoji: '👟', label: 'Chaussures', kinds: ['shop=shoes'], synonyms: ['chaussures', 'baskets', 'shoes', 'sneakers', 'schuhe', 'scarpe'] },
  { key: 'sport', emoji: '⚽', label: 'Articles de sport', kinds: ['shop=sports', 'shop=outdoor'], synonyms: ['sport', 'sports', 'articles de sport', 'ski', 'outdoor', 'sportgeschaft', 'randonnee'] },
  { key: 'velo', emoji: '🚲', label: 'Vélos', kinds: ['shop=bicycle'], synonyms: ['velo', 'velos', 'bike', 'bicycle', 'fahrrad', 'bicicletta', 'cycles'] },
  { key: 'electronique', emoji: '📺', label: 'Électronique & informatique', kinds: ['shop=electronics', 'shop=computer', 'shop=appliance'], synonyms: ['electronique', 'electronics', 'elektronik', 'informatique', 'ordinateur', 'computer', 'tv', 'electromenager', 'elettronica'] },
  { key: 'telephone', emoji: '📱', label: 'Téléphonie', kinds: ['shop=mobile_phone', 'shop=telecommunication'], synonyms: ['telephone', 'telephonie', 'portable', 'natel', 'handy', 'smartphone', 'mobile', 'cellulare'] },
  { key: 'meubles', emoji: '🛋️', label: 'Meubles & déco', kinds: ['shop=furniture', 'shop=interior_decoration', 'shop=bed', 'shop=houseware', 'shop=kitchen', 'shop=lighting'], synonyms: ['meubles', 'mobilier', 'deco', 'decoration', 'furniture', 'mobel', 'mobili', 'literie', 'cuisine', 'vaisselle'] },
  { key: 'bricolage', emoji: '🔨', label: 'Bricolage', kinds: ['shop=doityourself', 'shop=hardware', 'shop=paint'], synonyms: ['bricolage', 'brico', 'quincaillerie', 'outils', 'do it yourself', 'diy', 'baumarkt', 'hardware', 'ferramenta', 'peinture'] },
  { key: 'jardinerie', emoji: '🌱', label: 'Jardinerie', kinds: ['shop=garden_centre'], synonyms: ['jardinerie', 'jardin', 'plantes', 'garden centre', 'gartencenter', 'pepiniere', 'giardinaggio'] },
  { key: 'fleuriste', emoji: '💐', label: 'Fleuriste', kinds: ['shop=florist'], synonyms: ['fleuriste', 'fleurs', 'bouquet', 'florist', 'blumen', 'fiori', 'fioraio'] },
  { key: 'librairie', emoji: '📚', label: 'Librairie & papeterie', kinds: ['shop=books', 'shop=stationery'], synonyms: ['librairie', 'livres', 'livre', 'books', 'buchhandlung', 'bucher', 'libreria', 'papeterie', 'bd', 'manga'] },
  { key: 'jouets', emoji: '🧸', label: 'Jouets & jeux', kinds: ['shop=toys', 'shop=games', 'shop=video_games', 'shop=hobby', 'shop=craft'], synonyms: ['jouets', 'jeux', 'jeux video', 'toys', 'games', 'spielwaren', 'spielzeug', 'giocattoli', 'lego', 'loisirs creatifs', 'bricolage creatif'] },
  { key: 'animalerie', emoji: '🐾', label: 'Animalerie', kinds: ['shop=pet'], synonyms: ['animalerie', 'animaux', 'pet', 'pet shop', 'zoohandlung', 'tierbedarf', 'chien', 'chat'] },
  { key: 'opticien', emoji: '👓', label: 'Opticien', kinds: ['shop=optician'], synonyms: ['opticien', 'lunettes', 'lentilles', 'optician', 'optiker', 'ottico', 'brille'] },
  { key: 'beaute', emoji: '💅', label: 'Beauté & cosmétiques', kinds: ['shop=beauty', 'shop=cosmetics', 'shop=perfumery'], synonyms: ['beaute', 'institut de beaute', 'esthetique', 'estheticienne', 'onglerie', 'ongles', 'nails', 'beauty', 'kosmetik', 'cosmetiques', 'maquillage', 'parfum', 'parfumerie'] },
  { key: 'droguerie', emoji: '🧴', label: 'Droguerie', kinds: ['shop=chemist'], synonyms: ['droguerie', 'drogerie', 'drugstore', 'drogheria'] },
  { key: 'bijouterie', emoji: '💍', label: 'Bijouterie & horlogerie', kinds: ['shop=jewelry', 'shop=watches'], synonyms: ['bijouterie', 'bijoux', 'montres', 'horlogerie', 'jewelry', 'schmuck', 'uhren', 'gioielleria', 'orologi'] },
  { key: 'boucherie', emoji: '🥩', label: 'Boucherie', kinds: ['shop=butcher'], synonyms: ['boucherie', 'boucher', 'charcuterie', 'butcher', 'metzgerei', 'metzger', 'macelleria'] },
  { key: 'fromagerie', emoji: '🧀', label: 'Fromagerie & laiterie', kinds: ['shop=cheese', 'shop=dairy'], synonyms: ['fromagerie', 'fromager', 'laiterie', 'kaserei', 'molkerei', 'latteria', 'cheese shop'] },
  { key: 'chocolatier', emoji: '🍫', label: 'Chocolatier & confiserie', kinds: ['shop=chocolate', 'shop=confectionery'], synonyms: ['chocolatier', 'chocolaterie', 'confiserie', 'bonbons', 'pralines', 'schokolade', 'cioccolato'] },
  { key: 'cave', emoji: '🍷', label: 'Vins & boissons', kinds: ['shop=wine', 'shop=alcohol', 'shop=beverages'], synonyms: ['cave', 'vin', 'vins', 'wine', 'wein', 'vino', 'boissons', 'getranke', 'biere', 'bieres', 'spiritueux'] },
  { key: 'grand-magasin', emoji: '🏬', label: 'Grands magasins & centres commerciaux', kinds: ['shop=department_store', 'shop=mall'], synonyms: ['grand magasin', 'grands magasins', 'centre commercial', 'mall', 'shopping', 'einkaufszentrum', 'warenhaus', 'centro commerciale'] },
  { key: 'bazar', emoji: '🛍️', label: 'Bazar & cadeaux', kinds: ['shop=variety_store', 'shop=gift'], synonyms: ['bazar', 'discount', 'cadeau', 'cadeaux', 'souvenirs', 'gift', 'geschenke', 'regali'] },
  { key: 'seconde-main', emoji: '♻️', label: 'Seconde main', kinds: ['shop=second_hand', 'shop=charity', 'shop=antiques', 'shop=antique'], synonyms: ['seconde main', 'occasion', 'brocante', 'troc', 'second hand', 'secondhand', 'brockenhaus', 'antiquites', 'vintage'] },
  { key: 'musique', emoji: '🎸', label: 'Musique', kinds: ['shop=music', 'shop=musical_instrument'], synonyms: ['musique', 'instruments', 'instrument de musique', 'music', 'musik', 'guitare', 'piano', 'disques'] },
  { key: 'garage', emoji: '🔧', label: 'Garage', kinds: ['shop=car_repair', 'shop=car', 'shop=tyres', 'shop=car_parts'], synonyms: ['garage', 'mecanicien', 'carrosserie', 'voiture', 'auto', 'pneus', 'autogarage', 'werkstatt', 'officina', 'concessionnaire'] },
  { key: 'laverie', emoji: '🧺', label: 'Laverie & pressing', kinds: ['shop=laundry', 'shop=dry_cleaning'], synonyms: ['laverie', 'lavoir', 'pressing', 'nettoyage', 'laundry', 'waschsalon', 'reinigung', 'lavanderia'] },
  { key: 'medecin', emoji: '🩺', label: 'Médecin & dentiste', kinds: ['amenity=doctors', 'amenity=dentist', 'amenity=clinic'], synonyms: ['medecin', 'docteur', 'cabinet medical', 'doctor', 'arzt', 'medico', 'dentiste', 'zahnarzt', 'dentista', 'clinique', 'permanence'] },
  { key: 'bar', emoji: '🍸', label: 'Bar & pub', kinds: ['amenity=bar', 'amenity=pub'], synonyms: ['bar', 'bars', 'pub', 'apero', 'cocktail', 'kneipe', 'birreria'] },
  { key: 'cinema', emoji: '🎬', label: 'Cinéma', kinds: ['amenity=cinema'], synonyms: ['cinema', 'cine', 'film', 'kino', 'movies'] },
  { key: 'theatre', emoji: '🎭', label: 'Théâtre', kinds: ['amenity=theatre'], synonyms: ['theatre', 'spectacle', 'theater', 'teatro'] },
  { key: 'piscine', emoji: '🏊', label: 'Piscine', kinds: ['leisure=swimming_pool', 'leisure=water_park'], synonyms: ['piscine', 'bains', 'nager', 'swimming pool', 'schwimmbad', 'hallenbad', 'freibad', 'piscina', 'parc aquatique'] },
  { key: 'patinoire', emoji: '⛸️', label: 'Patinoire', kinds: ['leisure=ice_rink'], synonyms: ['patinoire', 'patin', 'eisbahn', 'ice rink', 'pista di ghiaccio'] },
  { key: 'sorties', emoji: '🎳', label: 'Bowling & jeux', kinds: ['leisure=bowling_alley', 'leisure=escape_game', 'leisure=trampoline_park', 'leisure=amusement_arcade'], synonyms: ['bowling', 'escape game', 'escape room', 'trampoline', 'laser game', 'arcade', 'salle de jeux', 'sortie'] },
  { key: 'parc', emoji: '🎢', label: "Zoo & parc d'attractions", kinds: ['tourism=zoo', 'tourism=theme_park'], synonyms: ['zoo', 'parc animalier', 'tierpark', "parc d'attractions", 'parc d attractions', 'luna park', 'freizeitpark', 'manege'] },
  { key: 'musee', emoji: '🏛️', label: 'Musée', kinds: ['tourism=museum'], synonyms: ['musee', 'museum', 'museo', 'exposition', 'expo'] },
  { key: 'hotel', emoji: '🏨', label: 'Hôtel', kinds: ['tourism=hotel', 'tourism=motel', 'tourism=hostel'], synonyms: ['hotel', 'hotels', 'motel', 'auberge', 'auberge de jeunesse', 'hostel', 'dormir', 'nuit', 'albergo', 'jugendherberge'] },
  { key: 'bibliotheque', emoji: '📚', label: 'Bibliothèque', kinds: ['amenity=library'], synonyms: ['bibliotheque', 'library', 'bibliothek', 'biblioteca', 'ludotheque'] },
  { key: 'marche', emoji: '🧺', label: 'Marché', kinds: ['amenity=marketplace'], synonyms: ['marche', 'market', 'markt', 'mercato', 'marche paysan'] },
  { key: 'location-voiture', emoji: '🚙', label: 'Location de voitures', kinds: ['amenity=car_rental'], synonyms: ['location de voiture', 'location voiture', 'louer une voiture', 'car rental', 'autovermietung', 'noleggio auto'] },
];

export const KIND_SEARCH_BY_KEY = new Map(KIND_SEARCHES.map((k) => [k.key, k]));

/** Kinds of places for a search text, best first. */
export function matchKinds(q: string): string[] {
  return rankMatches(KIND_SEARCHES, q);
}
