# Trajestaurant : autres sources de données restaurants en Suisse

État au 12.11.2026. Les éléments marqués **[testé]** ont été vérifiés depuis cet environnement (curl, DuckDB 2.0.0). Ceux marqués **[non confirmé]** n'ont pas pu être vérifiés sur une page officielle ou par un test.

## 1. Synthèse

| Source | Ce qu'elle apporte | Licence | Stockage dans notre BD ? | Effort | Verdict |
|---|---|---|---|---|---|
| **Overture Maps Places** | ~51 800 POI « food_and_drink » en CH, dont 30 165 en basic_category `restaurant`. Taxonomie de cuisine, `confidence`, `operating_status`, téléphone (86 %), site web (68 %), marque. **Pas d'horaires** | CDLA-Permissive-2.0 (97 %), Apache-2.0 (sous-ensemble Foursquare), CC0 (sous-ensemble ATP) | Oui | Faible (une requête DuckDB) | **OUI, 2e source** (déjà prévue) |
| **All The Places (ATP)** | Magasins des chaînes avec `opening_hours` au format OSM : Burger King CH, Coop Restaurant, Migros, Domino's… | CC0 | Oui | Faible | **OUI, horaires des chaînes** |
| **Name Suggestion Index (NSI)** | Correspondance marque → `cuisine` (McDonald's → burger, Brezelkönig → pretzel, Holy Cow! → burger) | BSD-3-Clause | Oui | Très faible | **OUI, enrichissement** |
| **Foursquare OS Places** | POI avec `date_refreshed`, `date_closed` et `unresolved_flags`. Pas d'horaires, de notes ni de prix | Apache-2.0 + NOTICE | Oui | Moyen (compte et jeton HF ou portail) | **À ÉVALUER** (Overture contient déjà une partie de FSQ) |
| Wikidata | Libellés FR/DE et logos des marques. La propriété cuisine P2012 est vide pour les grandes chaînes **[testé]** | CC0 | Oui | Faible | Secondaire |
| Ville de Zurich, Gastwirtschaftsbetriebe | ~3 500 établissements autorisés : nom, adresse, type, statut, heures de fermeture autorisées, coordonnées LV95 | CC0 | Oui | Faible | Hors Vaud (validation seulement) |
| Bâle-Campagne, Gastwirtschaften | 919 établissements : nom, type, adresse, coordonnées | Utilisation libre, source obligatoire | Oui | Faible | Hors Vaud |
| Ville de Zoug, Gastrobetriebe 2024 | 184 établissements : nom et adresse, sans coordonnées | Utilisation libre, source obligatoire | Oui | Faible + géocodage | Marginal |
| Ville de Genève, terrasses (SITG) | Cafés-restaurants ayant une terrasse sur le domaine public | « Accès libre » (licence exacte **[non confirmé]**) | Probablement | Faible | Partiel |
| Vaud, registre des licences | Consultation fiche par fiche, sans export | Pas une licence open data | Non | — | **NON** (sauf extrait demandé officiellement) |
| OSAV/BLV, contrôle des denrées | Données anonymisées (BetriebsID, canton, catégorie) | Utilisation libre, source obligatoire | — | — | **NON** (ni nom ni adresse) |
| Ostschweiz Tourismus | 346 FoodEstablishment au format schema.org, avec horaires et cuisine | CC0 (indiqué sur chaque objet) | Oui | Faible | Hors Vaud |
| Zürich Tourismus API | Restaurants de Zurich (schema.org) | CC BY-SA | Oui (partage à l'identique) | Faible | Hors Vaud |
| MySwitzerland OpenData API | Destinations, attractions, offres, circuits. **Aucun restaurant** | CC (surtout CC BY-SA) | — | — | **NON** |
| discover.swiss | Objets schema.org avec licence par objet. Couverture des restaurants vaudois **[non confirmé]** | Varie selon l'objet | Seulement les objets sous licence ouverte | Moyen (clé API) | À explorer plus tard |
| Google Places | Notes, avis, photos, horaires, niveau de prix | Propriétaire | **Non** (seulement place_id ; lat/lng 30 jours) | — | NON pour la BD, au mieux en direct |
| Yelp / Tripadvisor / Foursquare Places API | Notes, avis, photos, horaires | Propriétaire | **Non** (24 h, ID seul, ou aucun cache serveur) | — | **NON** |
| search.ch / local.ch | Annuaire | Propriétaire | Usage interne seulement, annuaires en ligne interdits | — | **NON** |
| Livraison (Just Eat/eat.ch, Uber Eats, Smood), GastroSuisse/GastroVaud, UID/Zefix | Menus et prix (livraison), adhérents (associations) | — | — | — | **NON** |

## 2. Détails par source

### 2.1 Overture Maps Places (2e source)

**Release et accès**
- Release courante : `2026-10-21.0` (schéma v2.0.0). Prochaines : `2026-11-18.0`, puis `2026-12-16.0`, réservée aux changements cassants trimestriels. Les anciennes releases ne restent publiées qu'environ deux mois. Il faut donc toujours lire la clé `latest` de https://stac.overturemaps.org/catalog.json **[testé]**.
- S3 (anonyme, région us-west-2) : `s3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/*.parquet` **[testé]**. Ce sont des fichiers d'environ 700 à 800 Mo, mais DuckDB ne lit que les groupes de lignes de la zone demandée.
- Azure : `https://overturemapswestus2.blob.core.windows.net/release/2026-10-21.0/theme=places/type=place/`. AzCopy utilise le point d'accès `…dfs.core.windows.net`.
- Raccourci : `ATTACH 'https://stac.overturemaps.org/latest.ddb' AS overture (READ_ONLY);` puis `overture.place`, qui suit toujours la dernière release **[testé]**.

**Schéma (vérifié par DESCRIBE)**
- `id` (GERS), `geometry`, `bbox`, `names.primary` (+ `common` multilingue).
- **`categories` a été supprimé** depuis `2026-09-23.0`. Il faut utiliser `taxonomy.primary`, `taxonomy.hierarchy[]` et `taxonomy.alternates[]` (environ 2 100 catégories), plus `basic_category` (environ 280 valeurs).
- `confidence` va de 0 à 1.
- `operating_status` prend les valeurs `open`, `temporarily_closed` ou `permanently_closed`. Si le statut est `permanently_closed`, alors `confidence` vaut 0.
- Autres champs : `websites[]`, `phones[]`, `emails[]`, `socials[]`, `brand{wikidata, names}`, `addresses[]{freeform, locality, postcode, region, country}`, `sources[]{dataset, license, record_id, update_time…}`.
- **Aucun champ d'horaires d'ouverture.**

**Ce qu'on trouve en Suisse [testé]**
- 51 829 POI `food_and_drink` avec country = CH.
- `taxonomy.primary` le plus fréquent : `restaurant` générique, 15 375 POI (30 %), sans cuisine. Viennent ensuite pizza_restaurant 2 609, italian 2 233, swiss 1 786, burger 560, sushi 365, ice_cream_shop 419, turkish 204 et doner_kebab_restaurant 150.
- Sources : Meta 32 418, BrightQuery 15 277, Microsoft 2 284, Foursquare 1 529, ATP 233.
- 1 860 « restaurants » sont marqués `permanently_closed`. Seulement 233 POI ont un `brand.wikidata`, mais `brand.names.primary` est plus souvent rempli (McDonald's 181).

**Test sur Lucens (bbox 6.78–6.90 / 46.68–46.74) [testé]**
- 25 POI trouvés.
- « Vesuvio Pizza Lucens » est classé `restaurant` générique, alors que « Sherlock Pizza Kebab Burger » est bien classé `pizza_restaurant`.
- « Restaurant du Pont » apparaît deux fois.
- Conséquence : il faut dédoublonner et, en dernier recours, chercher des mots-clés dans le nom. En CH, 809 restaurants génériques contiennent pizz/kebab/döner/sushi/burger dans leur nom.

**Licence**
- CDLA-Permissive-2.0 : aucune attribution n'est exigée. Si l'on redistribue les *données*, il faut fournir le texte de la licence. Les « résultats » (ce que l'on calcule à partir des données) sont libres.
- Lignes Apache-2.0 (Foursquare) : il faut conserver le NOTICE de Foursquare.
- Crédit recommandé : « Overture Maps Foundation ».
- Mélange avec OSM : Overture l'autorise, mais la base combinée peut devenir une base dérivée sous ODbL. Il faut donc garder l'attribution OSM et stocker `source` et `licence` sur chaque ligne.

**Requête (le SELECT a été testé : environ 5 s pour toute la Suisse)**
```sql
INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;
-- Bucket public : on force l'accès anonyme. Dans cet environnement, des variables
-- AWS_* présentes provoquaient un 403 InvalidAccessKeyId.
CREATE SECRET ov (TYPE s3, PROVIDER config, KEY_ID '', SECRET '', REGION 'us-west-2');
COPY (
  SELECT id, names.primary AS name, basic_category,
         taxonomy.primary AS category, taxonomy.hierarchy, taxonomy.alternates,
         confidence, operating_status,
         brand.names.primary AS brand, brand.wikidata AS brand_wikidata,
         websites, phones, socials,
         addresses[1].freeform AS street, addresses[1].postcode AS postcode,
         addresses[1].locality AS locality,
         sources[1].dataset AS src_dataset, sources[1].license AS src_license,
         geometry
  FROM read_parquet('s3://overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/*.parquet')
  WHERE bbox.xmin BETWEEN 5.95 AND 10.50 AND bbox.ymin BETWEEN 45.81 AND 47.81  -- bbox CH
    AND addresses[1].country = 'CH'          -- exclut FR/DE/IT/AT dans la bbox
    AND taxonomy.hierarchy[1] = 'food_and_drink'
    AND coalesce(operating_status, 'open') <> 'permanently_closed'
) TO 'overture_ch_food.parquet' (FORMAT parquet);
```
Pour la frontière exacte (variante **[non testée]**) : `ST_Intersects` avec `overture.division_area` en filtrant `country='CH'` et `subtype='country'`.

### 2.2 Foursquare OS Places
- **L'accès a changé en octobre 2025.** Le bucket public `s3://fsq-os-places-us-east-1` ne contient plus que `LICENSE.txt` et `NOTICE.txt`, sans aucun dossier `dt=` **[testé]**.
- Accès possibles :
  - (a) Hugging Face `foursquare/fsq-os-places`. Le jeu est *gated* : il faut accepter de partager ses coordonnées, se connecter et utiliser un jeton. La dernière release est `release/dt=2026-10-15/{places,categories,deltas}/parquet/*.parquet`, avec des releases mensuelles depuis `dt=2024-12-03` **[testé via l'API HF]**.
  - (b) Places Portal https://places.foursquare.com : on crée un jeton, puis on interroge un catalogue Iceberg. Les extraits de code DuckDB, Spark et PyIceberg se trouvent dans le portail ; le point d'accès n'est pas public **[non confirmé]**.
- Champs de `places` :
  - identification et contact : `fsq_place_id`, `name`, `latitude`, `longitude`, `address`, `locality`, `region`, `postcode`, `country`, `tel`, `website`, `email`, `facebook_id`, `instagram`, `twitter` ;
  - catégories : `fsq_category_ids[]` et `fsq_category_labels[]` ;
  - fraîcheur et qualité : `date_created`, `date_refreshed`, `date_closed`, `unresolved_flags[]` (closed, duplicate, doesnt_exist…) ;
  - divers : `placemaker_url`, `geom`, `bbox`.
- La table `categories` a 6 niveaux. Le niveau 2 « Restaurant » a l'ID `4d4b7105d754a06374d81259`.
- Pas d'horaires, de notes ni de prix : ces données sont réservées aux offres payantes Pro/Premium.
- **Licence** : Apache-2.0. Il faut inclure le contenu du `NOTICE.txt` (« © 2025 Foursquare Labs… ») dans la page des crédits.
- **Qualité** : Foursquare recommande `date_closed IS NULL` et `date_refreshed` de moins de 365 jours. Un contrôle ponctuel sur le forum OSM a relevé en Suisse des McDonald's et Burger King fermés depuis plus de 10 ans et des positions décalées d'un bâtiment (anecdotique).
- Overture intègre déjà 1 529 POI FSQ en CH. Il faut mesurer ce que FSQ ajoute vraiment autour de Lucens avant de l'intégrer.

**Requête [non testée : jeton requis]**
```sql
CREATE SECRET hf (TYPE huggingface, TOKEN 'hf_…');
WITH cats AS (
  SELECT list(category_id) AS ids
  FROM read_parquet('hf://datasets/foursquare/fsq-os-places/release/dt=2026-10-15/categories/parquet/*.parquet')
  WHERE level1_category_name = 'Dining and Drinking')
SELECT p.fsq_place_id, p.name, p.latitude, p.longitude, p.address, p.postcode, p.locality,
       p.tel, p.website, p.fsq_category_labels, p.date_refreshed
FROM read_parquet('hf://datasets/foursquare/fsq-os-places/release/dt=2026-10-15/places/parquet/*.parquet') p, cats
WHERE p.country = 'CH' AND p.date_closed IS NULL
  AND CAST(p.date_refreshed AS DATE) >= current_date - INTERVAL 365 DAY
  AND len(list_intersect(p.fsq_category_ids, cats.ids)) > 0;
```

### 2.3 All The Places (horaires des chaînes)
- La dernière exécution se lit sur https://data.alltheplaces.xyz/runs/latest.json **[testé]**. À ce jour : `2026-10-31-13-32-34`, 5 781 spiders, 40,3 M d'objets ; une exécution par semaine.
- Fichier par spider : `https://alltheplaces-data.openaddresses.io/runs/<run_id>/output/<spider>.geojson` **[testé]**.
- Le fichier complet `output.zip` pèse environ 2,9 Go. Le `parquet_url` annoncé dans `latest.json` renvoie 404 **[testé]**.
- Les propriétés sont des tags OSM : `amenity`, `cuisine`, `opening_hours`, `brand`, `brand:wikidata`, `addr:*`, `phone`, `website`, `ref`. Le parseur d'horaires OSM est donc réutilisable tel quel.
- Couverture suisse pour la restauration **[testé]** :

| Spider | POI en CH | Avec horaires |
|---|---|---|
| `burger_king` | 87 | 87 |
| `coop_restaurant_ch` | 174 | 173 |
| `migros_ch` | ~217 restaurants ou fast-foods, sur 1 898 POI au total | — |
| `dominos_pizza_ch` | 22 | — |
| `dunkin_ch` | 19 | — |
| `five_guys_ch` | 4 | — |

- `mcdonalds`, `subway` et `nordsee` n'ont **aucun POI en CH**.
- `zurich_tourism_ch` (412 restaurants) reprend l'API de Zürich Tourismus, dont la licence d'origine est CC BY-SA. Il ne faut pas le traiter comme du CC0.
- Licence : CC0 pour les données, MIT pour le code.
- Rapprochement avec nos POI : même `brand:wikidata`, ou même marque et distance de moins de 100 m.

### 2.4 Enrichissement des marques : NSI et Wikidata
- **NSI**
  - Paquet npm `name-suggestion-index@8.0.20261101`.
  - Index complet : https://cdn.jsdelivr.net/npm/name-suggestion-index@8.0.20261101/dist/nsi.json (13 Mo) **[testé]**.
  - Fichiers par type sur GitHub `osmlab/name-suggestion-index` : `data/brands/amenity/fast_food.json` (1 021 marques **[testé]**), `restaurant.json`, `cafe.json`, `ice_cream.json`.
  - Chaque entrée contient `tags.cuisine`, `tags["brand:wikidata"]`, `matchNames` et `locationSet` (par ex. Holy Cow! limité à `ch`).
  - Licence : BSD-3-Clause.
  - Usage : jointure sur `brand:wikidata` (OSM ou Overture), ou sur le nom normalisé avec `matchNames`, pour remplir la cuisine.
- **Wikidata** (SPARQL, https://query.wikidata.org/sparql, CC0) : P2012 « cuisine » est vide pour McDonald's, Burger King, KFC, Domino's, Brezelkönig et Holy Cow! **[testé]**. Utile seulement pour les libellés FR/DE, le logo (P154) et le site officiel.

### 2.5 Données publiques suisses (OGD)
Il n'existe **pas de registre national** des établissements. Les autorisations relèvent des cantons et des communes. **Rien d'exploitable n'a été trouvé pour Vaud ni pour Lucens.**

Note : l'API et les pages de **opendata.swiss renvoient 403 depuis cet environnement** (protection anti-robots). Les jeux ci-dessous ont été trouvés par recherche web puis via les portails source.

- **Zurich (ville)** **[testé]**
  - Fiche : https://data.stadt-zuerich.ch/dataset/geo_gastwirtschaftsbetriebe
  - WFS : `https://www.ogd.stadt-zuerich.ch/wfs/geoportal/Gastwirtschaftsbetriebe`, typename `gastwirtschaftsbetriebe`.
  - Champs : `betriebsname`, `strasselang`, `hnr`, `plz`, `ort`, `betriebsart` (Gastwirtschaft 2 098, Kleinverkaufsstelle 962, Nebenwirtschaft 194…), `betriebsstatus`, `oeffnungszeit`, `ekoord`/`nkoord` (EPSG:2056).
  - Attention : `oeffnungszeit` donne les heures de fermeture autorisées, **pas les heures d'ouverture**.
  - Licence CC0, mise à jour annuelle.
  - Les liens « download CSV/GeoJSON » ont renvoyé une page HTML : utiliser le WFS.
- **Bâle-Campagne** **[testé]**
  - API : https://data.bl.ch/api/explore/v2.1/catalog/datasets/10170/records
  - 919 établissements, état au 12.10.2026.
  - Champs : `name`, `betriebsart`, `post_adresse`, `plz`, `ort`, `koordinaten` (WGS84), `egid`.
  - Conditions : CommercialAllowed-ReferenceRequired (usage commercial permis, citer la source).
- **Zoug (ville)** **[testé]**
  - API : https://data.zg.ch/rowstore/dataset/a8fd73d1-a124-4862-aaa6-34d1a27391d9
  - 184 lignes (`name_betrieb`, `strasse`, `nummer`, `plz`, `ort`), sans coordonnées, état 2024.
  - Utilisation libre, source obligatoire.
- **Genève (ville)**
  - Couche SITG `VDG_TERRASSE_RESTO` : `https://vector.sitg.ge.ch/arcgis/rest/services/VDG_TERRASSE_RESTO/FeatureServer`.
  - Champs : `NOM_CAFE`, `NUMERO`, `PERIODE`, dates, surface.
  - Couvre seulement les établissements avec une terrasse sur le domaine public.
  - Diffusion « accès libre » ; licence exacte **[non confirmé]**.
- **Vaud** : registre des licences, https://prestations.vd.ch/pub/101229/home.
  - Recherche par nom ou adresse, sans export.
  - Avertissement : données « sans aucune garantie », « seul le dossier papier fait foi ».
  - À ne pas aspirer automatiquement. On pourrait éventuellement demander un extrait à la Police cantonale du commerce **[non confirmé]**.
- **Rien trouvé** pour Bâle-Ville (recherche data.bs.ch : 0 résultat **[testé]**), Berne, Lausanne, Lucerne, Saint-Gall et Winterthour. Cette recherche n'est pas exhaustive.
- **OSAV/BLV « lebensmittelkontrolle »** : contrôles de denrées anonymisés (BetriebsID, canton, catégorie, note), sans nom ni adresse. Inutilisable pour nous.

### 2.6 Tourisme
- **MySwitzerland OpenData API** (developer.myswitzerland.io)
  - Contenu : destinations, attractions, offres et circuits. Pas de type restaurant (notes de version v1.3.13 du 07.05.2026).
  - Clé API obligatoire (renvoie 401 sans clé **[testé]**).
  - Licence CC (surtout CC BY-SA) : source et lien retour obligatoires ; les images sont exclues de la licence.
  - Verdict : **NON**.
- **discover.swiss**
  - API : `https://api.discover.swiss/info/v2/` (par ex. `/localbusinesses`), au format schema.org, avec clé d'abonnement (401 sans clé **[testé]**).
  - Sans forfait : seulement les objets sous licence ouverte, pas de recherche, 60 appels/min et 50 000/mois.
  - Licence indiquée par objet dans `dataGovernance.origin.license`.
  - Présence de restaurants vaudois **[non confirmé]**.
- **Zürich Tourismus** : `https://www.zuerich.com/en/api/v2/data?id=101` (gastronomie), CC BY-SA. Renvoie « 403 Bot not allowed » depuis ici ; le même contenu est accessible via le spider ATP `zurich_tourism_ch`.
- **Ostschweiz Tourismus** **[testé]**
  - API : https://opendata.ost.contentdesk.io/api/FoodEstablishment.json
  - 346 objets schema.org, dont 159 avec `openingHoursSpecification` et 154 avec `servesCuisine`.
  - Licence CC0 indiquée sur chaque objet, mise à jour quotidienne.
  - Bon modèle, mais hors de notre zone.
- **Vaud Promotion / Lausanne Tourisme** : aucune API ni open data trouvée.

### 2.7 API commerciales (pour connaître, pas pour alimenter la BD)

**Google Places (New)**
- Stockage : seul `place_id` peut être gardé sans limite. Lat/lng au maximum 30 jours. Interdit de « pré-charger, indexer, stocker » le reste.
- Attribution : logo Google Maps et auteur des avis et des photos.
- Données en plus : notes, `priceLevel`, horaires (palier Enterprise) ; avis, `servesVegetarianFood`, `takeout`, `delivery` (palier Enterprise + Atmosphere) ; photos.
- Quotas gratuits par mois et par SKU : Essentials 10 000, Pro 5 000, Enterprise 1 000.
- Prix pour 1 000 appels : Text/Nearby Search Pro 32 $, Enterprise 35 $, + Atmosphere 40 $ ; Place Details Enterprise 20 $.
- À vérifier : les conditions générales de la plateforme interdisent historiquement d'afficher ce contenu sur une carte non Google **[non confirmé]**.

**Yelp** : cache de 24 h au maximum. Les ID ne servent qu'au rapprochement interne. Interdit de « créer sa propre base » et de faire un usage commercial sans accord. L'offre est payante ; tarifs officiels **[non confirmé]**.

**Tripadvisor Content API** : seul `location_id` peut être mis en cache. Jusqu'à 5 avis et 5 photos par lieu, paiement à l'usage. Quota gratuit (5 000/mois ?) **[non confirmé]**.

**Foursquare Places API**
- Points Pro : de 0 à 500 appels gratuits par mois, puis 15 $ pour 1 000. La même page parle aussi de « jusqu'à 10 000 appels gratuits » (contradiction non résolue).
- Points Premium (photos, astuces, champs premium) : 18,75 $ pour 1 000.
- Mention « Powered by Foursquare » obligatoire, constitution de base interdite. Aucun cache serveur sans forfait Enterprise **[non confirmé]**.

**search.ch (API annuaire)** : 1 000 requêtes/mois, usage interne uniquement. Interdits : annuaires en ligne (applications mobiles comprises) et requêtes en masse pour construire une base d'adresses. Mention « Swisscom Directories AG » obligatoire ; pénalité de 50 000 CHF par infraction. **local.ch** : aucune API publique trouvée.

### 2.8 Autres pistes
- **Horaires d'ouverture** : `opening_hours` d'OSM en source principale, puis ATP pour les chaînes. Google en direct seulement (sans stockage). Le site web du restaurant, au cas par cas.
- **Menus et prix** : aucune source ouverte exploitable. Les plateformes de livraison (Just Eat/eat.ch, Uber Eats, Smood) demandent un accord partenaire, et l'aspiration est contraire à leurs conditions. On peut afficher le lien `website` (OSM ou Overture), voire le tag OSM `website:menu`.
- **GastroSuisse** (environ 20 000 membres) et **GastroVaud** (plus de 1 600 établissements) : ni annuaire public ni API. On peut les contacter pour la journée des métiers.
- **UID/BER/Zefix** : ni coordonnées ni cuisine. Les API publiques du nouveau registre BER ne sont pas attendues avant 2027.
- **Jeux commerciaux** (xMap, environ 50 800 restaurants et cafés en CH ; SafeGraph ; D&B) : payants.

## 3. Ordre d'intégration recommandé après OSM
1. **Overture Places**
   - Rapprochement OSM ↔ Overture : similarité de nom (pg_trgm) et distance inférieure à environ 75 m. OSM reste la référence.
   - On n'ajoute un POI Overture que s'il a `confidence ≥ 0.7`, ou `≥ 0.5` avec téléphone ou site web, et un statut différent de `permanently_closed`.
   - Correspondance `taxonomy.primary` / `alternates` vers nos types (pizza, burger, sushi, kebab…), avec recherche de mots-clés dans le nom en secours.
   - Stocker `source`, `source_id` et `licence` sur chaque ligne.
2. **NSI** (fichier JSON hors ligne, une heure de travail) : remplir `cuisine` pour toutes les chaînes, quelle que soit la source.
3. **All The Places** (spiders `*_ch` et `burger_king`) : horaires des chaînes, rafraîchis chaque semaine.
4. **Foursquare OS Places**, seulement si des manques subsistent : mesurer d'abord ce qu'il ajoute sur une bbox Vaud (jeton HF).
5. Hors Vaud, si la zone s'étend : OGD de Zurich et Bâle-Campagne pour vérifier qu'un établissement existe ou a fermé.
6. Google, Yelp, Tripadvisor et l'API Foursquare : jamais dans la BD. Au plus un lien « voir les avis » en direct.

**Page des crédits proposée** : « © contributeurs OpenStreetMap (ODbL) · Overture Maps Foundation (CDLA-Permissive-2.0) · Foursquare OS Places (Apache-2.0, NOTICE) · All The Places (CC0) · name-suggestion-index (BSD-3-Clause) ».
