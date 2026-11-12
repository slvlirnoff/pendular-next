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
