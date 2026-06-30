/**
 * Tarifs Meta WhatsApp Business — par pays — catégories MARKETING et UTILITY.
 *
 * Source : outil de tarification officiel Meta
 *   https://whatsappbusiness.com/products/platform-pricing/
 *   (devise = EUR), récupéré le 2026-06-30 via son endpoint
 *   `wp-json/wab/v1/pricing`. Valeurs EN EUR par message sortant, pour un
 *   compte WABA facturé en euros.
 *
 * - `marketingEur` : message catégorie Marketing (tarif plat).
 * - `utilityEur`   : message catégorie Utility (tarif de base ; Meta
 *                    applique en plus des paliers dégressifs au volume,
 *                    non modélisés ici — on garde le tarif de référence).
 *
 * Modèle Meta (depuis juillet 2025) : facturation AU MESSAGE selon
 * l'indicatif du destinataire. Beaucoup de pays n'ont pas de tarif propre
 * et tombent dans un TIER RÉGIONAL (marketing / utility) :
 *   - AFR  « Reste de l'Afrique »             0,0186 / 0,0033 €
 *   - WEU  « Reste de l'Europe occidentale »  0,0490 / 0,0142 €
 *   - CEEU « Reste de l'Europe centrale/Est » 0,0712 / 0,0175 €
 *   - MDE  « Reste du Moyen-Orient »          0,0282 / 0,0075 €
 *   - APAC « Reste de l'Asie-Pacifique »      0,0606 / 0,0094 €
 *   - NAM  « Amérique du Nord » (US/Canada)   0,0207 / 0,0028 €
 *   - GLO  « Autre »                          0,0500 / 0,0064 €  (fallback)
 *
 * Meta révise ses tarifs ~2×/an : re-vérifier périodiquement sur l'outil
 * ci-dessus (sélecteur marché + devise EUR + catégorie).
 */

export interface PhoneCountry {
  /** Code ISO 3166 alpha-2. */
  iso: string;
  /** Nom court du pays/zone (français). */
  name: string;
  /** Tarif Meta marketing en EUR par message. */
  marketingEur: number;
  /** Tarif Meta utility en EUR par message (tarif de base). */
  utilityEur: number;
}

/** Tarif fallback pour un numéro dont l'indicatif n'est pas reconnu, ou
 *  pour les pays absents du tableau ci-dessous. = tier « Other » (GLO) de
 *  Meta (officiel, EUR). */
const FALLBACK: PhoneCountry = {
  iso: "XX",
  name: "Autre / non reconnu",
  marketingEur: 0.05,
  utilityEur: 0.0064,
};

/**
 * Map indicatif téléphonique → pays + tarifs EUR officiels Meta.
 * Le tarif est celui du MARCHÉ Meta du pays : soit son marché propre
 * (France, Allemagne, Égypte…), soit son tier régional (cf. en-tête).
 *
 * `extractCountry` matche le préfixe le plus long d'abord (ex : "351"
 * Portugal avant "35", "212" Maroc avant "21").
 */
const PHONE_CODES: Record<string, PhoneCountry> = {
  // --- Europe de l'Ouest (marchés propres) ---
  "33": { iso: "FR", name: "France", marketingEur: 0.0712, utilityEur: 0.0248 },
  "49": { iso: "DE", name: "Allemagne", marketingEur: 0.1131, utilityEur: 0.0456 },
  "34": { iso: "ES", name: "Espagne", marketingEur: 0.0509, utilityEur: 0.0166 },
  "39": { iso: "IT", name: "Italie", marketingEur: 0.0572, utilityEur: 0.0248 },
  "44": { iso: "GB", name: "Royaume-Uni", marketingEur: 0.0438, utilityEur: 0.0182 },
  "31": { iso: "NL", name: "Pays-Bas", marketingEur: 0.1323, utilityEur: 0.0414 },

  // --- Europe de l'Ouest (tier WEU : marketing 0,049 / utility 0,0142 €) ---
  "32": { iso: "BE", name: "Belgique", marketingEur: 0.049, utilityEur: 0.0142 },
  "41": { iso: "CH", name: "Suisse", marketingEur: 0.049, utilityEur: 0.0142 },
  "43": { iso: "AT", name: "Autriche", marketingEur: 0.049, utilityEur: 0.0142 },
  "351": { iso: "PT", name: "Portugal", marketingEur: 0.049, utilityEur: 0.0142 },
  "353": { iso: "IE", name: "Irlande", marketingEur: 0.049, utilityEur: 0.0142 },
  "352": { iso: "LU", name: "Luxembourg", marketingEur: 0.049, utilityEur: 0.0142 },
  "45": { iso: "DK", name: "Danemark", marketingEur: 0.049, utilityEur: 0.0142 },
  "46": { iso: "SE", name: "Suède", marketingEur: 0.049, utilityEur: 0.0142 },
  "47": { iso: "NO", name: "Norvège", marketingEur: 0.049, utilityEur: 0.0142 },
  "358": { iso: "FI", name: "Finlande", marketingEur: 0.049, utilityEur: 0.0142 },
  "30": { iso: "GR", name: "Grèce", marketingEur: 0.049, utilityEur: 0.0142 },

  // --- Europe centrale/orientale + Caucase (tier CEEU : 0,0712 / 0,0175 €) ---
  "48": { iso: "PL", name: "Pologne", marketingEur: 0.0712, utilityEur: 0.0175 },
  "40": { iso: "RO", name: "Roumanie", marketingEur: 0.0712, utilityEur: 0.0175 },
  "420": { iso: "CZ", name: "Tchéquie", marketingEur: 0.0712, utilityEur: 0.0175 },
  "36": { iso: "HU", name: "Hongrie", marketingEur: 0.0712, utilityEur: 0.0175 },
  "359": { iso: "BG", name: "Bulgarie", marketingEur: 0.0712, utilityEur: 0.0175 },
  "421": { iso: "SK", name: "Slovaquie", marketingEur: 0.0712, utilityEur: 0.0175 },
  "386": { iso: "SI", name: "Slovénie", marketingEur: 0.0712, utilityEur: 0.0175 },
  "385": { iso: "HR", name: "Croatie", marketingEur: 0.0712, utilityEur: 0.0175 },
  "380": { iso: "UA", name: "Ukraine", marketingEur: 0.0712, utilityEur: 0.0175 },
  "381": { iso: "RS", name: "Serbie", marketingEur: 0.0712, utilityEur: 0.0175 },
  "370": { iso: "LT", name: "Lituanie", marketingEur: 0.0712, utilityEur: 0.0175 },
  "371": { iso: "LV", name: "Lettonie", marketingEur: 0.0712, utilityEur: 0.0175 },
  "372": { iso: "EE", name: "Estonie", marketingEur: 0.0712, utilityEur: 0.0175 },
  "995": { iso: "GE", name: "Géorgie", marketingEur: 0.0712, utilityEur: 0.0175 },
  "7": { iso: "RU", name: "Russie / Kazakhstan", marketingEur: 0.0664, utilityEur: 0.0331 },

  // --- Amérique du Nord (tier NAM : 0,0207 / 0,0028 €) ---
  "1": { iso: "US", name: "USA / Canada", marketingEur: 0.0207, utilityEur: 0.0028 },

  // --- Amérique latine (marchés propres ; autres → « Autre ») ---
  "52": { iso: "MX", name: "Mexique", marketingEur: 0.0253, utilityEur: 0.0071 },
  "55": { iso: "BR", name: "Brésil", marketingEur: 0.0518, utilityEur: 0.0056 },
  "54": { iso: "AR", name: "Argentine", marketingEur: 0.0512, utilityEur: 0.0216 },
  "56": { iso: "CL", name: "Chili", marketingEur: 0.0736, utilityEur: 0.0166 },
  "57": { iso: "CO", name: "Colombie", marketingEur: 0.0104, utilityEur: 0.0008 },
  "51": { iso: "PE", name: "Pérou", marketingEur: 0.0582, utilityEur: 0.0166 },

  // --- Afrique : marchés propres ---
  "20": { iso: "EG", name: "Égypte", marketingEur: 0.0533, utilityEur: 0.003 },
  "27": { iso: "ZA", name: "Afrique du Sud", marketingEur: 0.0314, utilityEur: 0.0063 },
  "234": { iso: "NG", name: "Nigeria", marketingEur: 0.0428, utilityEur: 0.0056 },

  // --- Afrique : tout le reste, tier « Reste de l'Afrique » (0,0186 / 0,0033 €)
  //     (Maghreb inclus : Maroc / Algérie / Tunisie n'ont pas de marché
  //     propre côté Meta et tombent dans ce tier). ---
  "212": { iso: "MA", name: "Maroc", marketingEur: 0.0186, utilityEur: 0.0033 },
  "213": { iso: "DZ", name: "Algérie", marketingEur: 0.0186, utilityEur: 0.0033 },
  "216": { iso: "TN", name: "Tunisie", marketingEur: 0.0186, utilityEur: 0.0033 },
  "221": { iso: "SN", name: "Sénégal", marketingEur: 0.0186, utilityEur: 0.0033 },
  "225": { iso: "CI", name: "Côte d'Ivoire", marketingEur: 0.0186, utilityEur: 0.0033 },
  "223": { iso: "ML", name: "Mali", marketingEur: 0.0186, utilityEur: 0.0033 },
  "226": { iso: "BF", name: "Burkina Faso", marketingEur: 0.0186, utilityEur: 0.0033 },
  "228": { iso: "TG", name: "Togo", marketingEur: 0.0186, utilityEur: 0.0033 },
  "229": { iso: "BJ", name: "Bénin", marketingEur: 0.0186, utilityEur: 0.0033 },
  "227": { iso: "NE", name: "Niger", marketingEur: 0.0186, utilityEur: 0.0033 },
  "224": { iso: "GN", name: "Guinée", marketingEur: 0.0186, utilityEur: 0.0033 },
  "245": { iso: "GW", name: "Guinée-Bissau", marketingEur: 0.0186, utilityEur: 0.0033 },
  "222": { iso: "MR", name: "Mauritanie", marketingEur: 0.0186, utilityEur: 0.0033 },
  "220": { iso: "GM", name: "Gambie", marketingEur: 0.0186, utilityEur: 0.0033 },
  "231": { iso: "LR", name: "Liberia", marketingEur: 0.0186, utilityEur: 0.0033 },
  "232": { iso: "SL", name: "Sierra Leone", marketingEur: 0.0186, utilityEur: 0.0033 },
  "233": { iso: "GH", name: "Ghana", marketingEur: 0.0186, utilityEur: 0.0033 },
  "238": { iso: "CV", name: "Cap-Vert", marketingEur: 0.0186, utilityEur: 0.0033 },
  "237": { iso: "CM", name: "Cameroun", marketingEur: 0.0186, utilityEur: 0.0033 },
  "241": { iso: "GA", name: "Gabon", marketingEur: 0.0186, utilityEur: 0.0033 },
  "240": { iso: "GQ", name: "Guinée équatoriale", marketingEur: 0.0186, utilityEur: 0.0033 },
  "236": { iso: "CF", name: "Centrafrique", marketingEur: 0.0186, utilityEur: 0.0033 },
  "235": { iso: "TD", name: "Tchad", marketingEur: 0.0186, utilityEur: 0.0033 },
  "242": { iso: "CG", name: "Congo-Brazzaville", marketingEur: 0.0186, utilityEur: 0.0033 },
  "243": { iso: "CD", name: "RD Congo", marketingEur: 0.0186, utilityEur: 0.0033 },
  "239": { iso: "ST", name: "Sao Tomé-et-Principe", marketingEur: 0.0186, utilityEur: 0.0033 },
  "254": { iso: "KE", name: "Kenya", marketingEur: 0.0186, utilityEur: 0.0033 },
  "255": { iso: "TZ", name: "Tanzanie", marketingEur: 0.0186, utilityEur: 0.0033 },
  "256": { iso: "UG", name: "Ouganda", marketingEur: 0.0186, utilityEur: 0.0033 },
  "250": { iso: "RW", name: "Rwanda", marketingEur: 0.0186, utilityEur: 0.0033 },
  "257": { iso: "BI", name: "Burundi", marketingEur: 0.0186, utilityEur: 0.0033 },
  "251": { iso: "ET", name: "Éthiopie", marketingEur: 0.0186, utilityEur: 0.0033 },
  "252": { iso: "SO", name: "Somalie", marketingEur: 0.0186, utilityEur: 0.0033 },
  "253": { iso: "DJ", name: "Djibouti", marketingEur: 0.0186, utilityEur: 0.0033 },
  "249": { iso: "SD", name: "Soudan", marketingEur: 0.0186, utilityEur: 0.0033 },
  "211": { iso: "SS", name: "Soudan du Sud", marketingEur: 0.0186, utilityEur: 0.0033 },
  "261": { iso: "MG", name: "Madagascar", marketingEur: 0.0186, utilityEur: 0.0033 },
  "269": { iso: "KM", name: "Comores", marketingEur: 0.0186, utilityEur: 0.0033 },
  "230": { iso: "MU", name: "Maurice", marketingEur: 0.0186, utilityEur: 0.0033 },
  "248": { iso: "SC", name: "Seychelles", marketingEur: 0.0186, utilityEur: 0.0033 },
  "258": { iso: "MZ", name: "Mozambique", marketingEur: 0.0186, utilityEur: 0.0033 },
  "260": { iso: "ZM", name: "Zambie", marketingEur: 0.0186, utilityEur: 0.0033 },
  "263": { iso: "ZW", name: "Zimbabwe", marketingEur: 0.0186, utilityEur: 0.0033 },
  "265": { iso: "MW", name: "Malawi", marketingEur: 0.0186, utilityEur: 0.0033 },
  "264": { iso: "NA", name: "Namibie", marketingEur: 0.0186, utilityEur: 0.0033 },
  "267": { iso: "BW", name: "Botswana", marketingEur: 0.0186, utilityEur: 0.0033 },
  "266": { iso: "LS", name: "Lesotho", marketingEur: 0.0186, utilityEur: 0.0033 },
  "268": { iso: "SZ", name: "Eswatini", marketingEur: 0.0186, utilityEur: 0.0033 },
  // Réunion / Mayotte (DOM français, +262) → tarif France.
  "262": { iso: "RE", name: "Réunion / Mayotte", marketingEur: 0.0712, utilityEur: 0.0248 },

  // --- Moyen-Orient (marchés propres + tier MDE : 0,0282 / 0,0075 €) ---
  "971": { iso: "AE", name: "Émirats arabes unis", marketingEur: 0.0415, utilityEur: 0.013 },
  "966": { iso: "SA", name: "Arabie saoudite", marketingEur: 0.0414, utilityEur: 0.0088 },
  "972": { iso: "IL", name: "Israël", marketingEur: 0.0292, utilityEur: 0.0044 },
  "90": { iso: "TR", name: "Turquie", marketingEur: 0.009, utilityEur: 0.0007 },
  "961": { iso: "LB", name: "Liban", marketingEur: 0.0282, utilityEur: 0.0075 },
  "962": { iso: "JO", name: "Jordanie", marketingEur: 0.0282, utilityEur: 0.0075 },

  // --- Asie (marchés propres + tier APAC : 0,0606 / 0,0094 €) ---
  "91": { iso: "IN", name: "Inde", marketingEur: 0.0099, utilityEur: 0.0012 },
  "62": { iso: "ID", name: "Indonésie", marketingEur: 0.0341, utilityEur: 0.0208 },
  "60": { iso: "MY", name: "Malaisie", marketingEur: 0.0712, utilityEur: 0.0116 },
  "92": { iso: "PK", name: "Pakistan", marketingEur: 0.0392, utilityEur: 0.0083 },
  "81": { iso: "JP", name: "Japon", marketingEur: 0.0606, utilityEur: 0.0094 },
  "82": { iso: "KR", name: "Corée du Sud", marketingEur: 0.0606, utilityEur: 0.0094 },
  "86": { iso: "CN", name: "Chine", marketingEur: 0.0606, utilityEur: 0.0094 },
  "84": { iso: "VN", name: "Vietnam", marketingEur: 0.0606, utilityEur: 0.0094 },
  "66": { iso: "TH", name: "Thaïlande", marketingEur: 0.0606, utilityEur: 0.0094 },
  "65": { iso: "SG", name: "Singapour", marketingEur: 0.0606, utilityEur: 0.0094 },
  "63": { iso: "PH", name: "Philippines", marketingEur: 0.0606, utilityEur: 0.0094 },
  "880": { iso: "BD", name: "Bangladesh", marketingEur: 0.0606, utilityEur: 0.0094 },
  "977": { iso: "NP", name: "Népal", marketingEur: 0.0606, utilityEur: 0.0094 },
  "94": { iso: "LK", name: "Sri Lanka", marketingEur: 0.0606, utilityEur: 0.0094 },
  "95": { iso: "MM", name: "Myanmar", marketingEur: 0.0606, utilityEur: 0.0094 },
  "93": { iso: "AF", name: "Afghanistan", marketingEur: 0.0606, utilityEur: 0.0094 },

  // --- Océanie (tier APAC : 0,0606 / 0,0094 €) ---
  "61": { iso: "AU", name: "Australie", marketingEur: 0.0606, utilityEur: 0.0094 },
  "64": { iso: "NZ", name: "Nouvelle-Zélande", marketingEur: 0.0606, utilityEur: 0.0094 },
};

/** Indicatifs ordonnés du plus long au plus court — pour matcher
 *  correctement "+212" avant "+2" si jamais on en avait un. */
const PHONE_CODE_KEYS = Object.keys(PHONE_CODES).sort(
  (a, b) => b.length - a.length
);

/**
 * Extrait le pays d'un numéro de téléphone international.
 *
 * Accepte les formats "+33633921577", "0033633921577", "+33 6 33 92 ...".
 * Si l'indicatif n'est pas reconnu (ou si la chaîne ne ressemble pas à un
 * numéro), retourne `null` — le code appelant peut alors décider de
 * compter le coût avec FALLBACK ou de l'ignorer.
 */
export function extractCountry(rawPhone: string): PhoneCountry | null {
  if (!rawPhone) return null;
  // Garde les chiffres uniquement (avec un + initial s'il y en a un)
  const trimmed = rawPhone.trim();
  let digits: string;
  if (trimmed.startsWith("+")) {
    digits = trimmed.slice(1).replace(/\D/g, "");
  } else if (trimmed.startsWith("00")) {
    digits = trimmed.slice(2).replace(/\D/g, "");
  } else {
    // Pas de + ni de 00 → on suppose un local non identifiable
    return null;
  }
  if (digits.length < 4) return null;

  // Match le plus long préfixe possible (matched-greedy)
  for (const code of PHONE_CODE_KEYS) {
    if (digits.startsWith(code)) {
      return PHONE_CODES[code];
    }
  }
  return null;
}

/**
 * Coût Meta marketing pour UN numéro. Renvoie `FALLBACK.marketingEur`
 * pour les indicatifs inconnus afin que la somme totale d'un funnel
 * reste indicative même si quelques numéros sont mal formatés.
 */
export function metaMarketingCostEur(rawPhone: string): number {
  const country = extractCountry(rawPhone);
  return (country ?? FALLBACK).marketingEur;
}

/** Somme du coût marketing sur une liste de numéros. */
export function metaMarketingCostSumEur(phones: string[]): number {
  return phones.reduce((acc, p) => acc + metaMarketingCostEur(p), 0);
}

/** Une ligne du breakdown coût Meta : un pays + nb d'envois + tarif unitaire
 *  + total. Affichée dans la modale de détail accessible au clic sur la
 *  cellule « Coût Meta » d'un funnel ou d'un event Stats. */
export interface MetaCostByCountry {
  iso: string;
  name: string;
  count: number;
  rateEur: number;
  totalEur: number;
}

/**
 * Regroupe une liste de numéros par pays et calcule le coût total par
 * pays. Trié par totalEur décroissant (le pays le plus coûteux en haut).
 *
 * Le fallback (indicatif inconnu) est agrégé sous une seule ligne
 * « Autre / non reconnu » pour ne pas polluer le tableau.
 */
export function groupMetaCostsByCountry(phones: string[]): MetaCostByCountry[] {
  const groups = new Map<
    string,
    { iso: string; name: string; rateEur: number; count: number }
  >();
  for (const p of phones) {
    if (!p) continue;
    const country = extractCountry(p) ?? FALLBACK;
    const key = country.iso;
    const g = groups.get(key);
    if (g) g.count++;
    else
      groups.set(key, {
        iso: country.iso,
        name: country.name,
        rateEur: country.marketingEur,
        count: 1,
      });
  }
  return Array.from(groups.values())
    .map((g) => ({ ...g, totalEur: g.count * g.rateEur }))
    .sort((a, b) => b.totalEur - a.totalEur);
}

export const META_FALLBACK = FALLBACK;
