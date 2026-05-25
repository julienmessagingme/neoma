export type StepType = "mm_event" | "url_click";
export type DatePreset = "7d" | "30d" | "90d" | "custom";
export type DashboardType = "funnel" | "pie";

export interface StepRef {
  id: string;
  ref_position: number;
  step_type: StepType;
  event_ns: string | null;
  redirect_event_id: string | null;
  /** Renseigné uniquement en mode EDH groupe pour les refs mm_event :
   *  l'event_ns n'étant pas globalement unique entre écoles, on doit
   *  porter l'origine. NULL en mode école-précise (legacy). */
  event_school_slug: string | null;
}

export interface DashboardStep {
  id: string;
  position: number;
  /** NULL = auto-calculé "A + B + C" côté UI à partir des refs. */
  label: string | null;
  refs: StepRef[];
}

export interface Dashboard {
  id: string;
  school_slug: string;
  created_by: string;
  name: string;
  type: DashboardType;
  date_preset: DatePreset;
  date_from: string | null;
  date_to: string | null;
  created_at: string;
  updated_at: string;
  /** Non-NULL ssi le tableau appartient à une campagne (créé via
   *  `POST /api/campaigns`). Exclu de la liste "Mes tableaux", édité
   *  uniquement via `/campaigns/[campaign_id]`. */
  campaign_id: string | null;
  /** Partagé avec l'école : visible par tous les users qui ont accès à
   *  l'école, éditable uniquement par l'auteur (ou admin). Ignoré pour
   *  les tableaux liés à une campagne (héritent du `is_shared` de la
   *  campagne). */
  is_shared: boolean;
  /** true ssi l'utilisateur courant est auteur ou admin. Annoté par
   *  l'API GET, jamais persisté en DB. Permet au builder de désactiver
   *  l'auto-save quand l'utilisateur consulte un tableau partagé qui
   *  n'est pas le sien. */
  can_edit?: boolean;
}

export interface DashboardWithSteps extends Dashboard {
  steps: DashboardStep[];
}

/** Breakdown du coût Meta par pays. Sérialisable JSON pour transit API
 *  (camelCase → snake_case n'est pas appliqué — on garde le format de la
 *  lib `meta-pricing` tel quel pour ne pas avoir à mapper). */
export interface MetaCostBreakdownItem {
  iso: string;
  name: string;
  count: number;
  rate_eur: number;
  total_eur: number;
}

export interface ComputedRef {
  step_type: StepType;
  ref_id: string;
  label: string;
  count: number;
  available: boolean;
  /** Renseigné en mode EDH pour préfixer le label avec l'école (chip). */
  school_slug?: string;
  school_name?: string;
  /** Coût Meta WhatsApp marketing estimé (en EUR) pour cet event, calculé
   *  à partir des `text_value` des occurrences sur la période. Renseigné
   *  uniquement pour les mm_event dont `text_label` est non vide (donc
   *  porteurs d'un numéro de tel ou autre valeur scalaire). NULL sinon. */
  meta_cost_eur?: number | null;
  /** Détail par pays (trié par total décroissant). Renseigné en même
   *  temps que `meta_cost_eur`. Permet d'afficher la modale de détail
   *  côté UI sans refaire le calcul. */
  meta_breakdown?: MetaCostBreakdownItem[];
}

export interface ComputedStep {
  position: number;
  /** Résolu côté API : label stocké si présent, sinon "A + B + C". */
  label: string;
  /** Somme des `count` des refs `available`. */
  count: number;
  /** false ssi toutes les refs sont unavailable (ou si refs est vide). */
  available: boolean;
  refs: ComputedRef[];
  /** Somme des `meta_cost_eur` des refs porteurs (text_label non vide).
   *  NULL si aucune ref de l'étape n'est porteur — on n'affiche pas la
   *  colonne « Coût Meta » dans la table dans ce cas. */
  meta_cost_eur?: number | null;
  /** Breakdown fusionné des refs (par pays, sommé). NULL si pas de
   *  coût Meta sur l'étape. */
  meta_breakdown?: MetaCostBreakdownItem[];
}

/**
 * Synthèse coût Meta au niveau d'une campagne (Phase 25+). Renseigné dans
 * la réponse `/api/dashboards/[id]/data` uniquement si :
 *   - le dashboard est lié à une campagne (campaign_id non NULL), ET
 *   - la campagne a un event de lancement (role='launch') défini.
 *
 * - launch        : tout ce qui sort de l'event de lancement (envois bruts).
 * - failed        : count des occurrences de l'event role='failed' s'il
 *                   existe (sinon null).
 * - net_count     : max(0, launch.count - failed.count).
 * - net_cost_eur  : launch.cost_eur scaled par net_count / launch.count.
 * - net_breakdown : breakdown du launch scaled au même ratio.
 */
export interface CampaignCostSummary {
  launch: {
    count: number;
    cost_eur: number;
    breakdown: MetaCostBreakdownItem[];
    /** Label affichable de l'event de lancement (avec chip école en EDH). */
    label: string;
    /** Identité brute de la ref launch, utile pour les selects inline
     *  du builder (matcher la palette key + envoyer un PATCH). */
    event_ns: string;
    event_school_slug: string | null;
  };
  failed: {
    count: number;
    label: string;
    event_ns: string;
    event_school_slug: string | null;
  } | null;
  net_count: number;
  net_cost_eur: number;
  net_breakdown: MetaCostBreakdownItem[];
}

export interface ComputedDashboardData {
  from: string;
  to: string;
  steps: ComputedStep[];
  campaign_summary?: CampaignCostSummary | null;
}

/**
 * Calcule un label d'étape lisible pour l'affichage (chart, table, exports).
 *
 * Cas :
 *   - 1 seule ref : label de l'étape (qui est égal au label de la ref par défaut).
 *   - N refs, label CUSTOM (≠ join auto) : on le respecte tel quel.
 *   - N refs, AUTO-label (issu du join "A + B + C") : on compacte en
 *     "Cumul de N sources" — beaucoup plus lisible sur un chart à 4 étapes,
 *     d'autant que le breakdown détaillé est déjà rendu sous chaque étape
 *     dans la table et déjà visible sous forme de chips dans le builder.
 */
export function compactStepLabel(step: ComputedStep): string {
  if (step.refs.length <= 1) return step.label;
  const autoLabel = step.refs.map((r) => r.label).join(" + ");
  if (step.label === autoLabel) {
    return `Cumul de ${step.refs.length} sources`;
  }
  return step.label;
}

export interface PaletteItem {
  step_type: StepType;
  ref_id: string;
  label: string;
  /** En mode EDH groupe, l'école d'origine est portée par chaque item ;
   *  en mode école-précise, ces champs sont absents. */
  school_slug?: string;
  school_name?: string;
  /** Vrai pour les mm_event dont `text_label` est non vide → l'event
   *  porte une valeur scalaire (typiquement un numéro de tel). Sert à
   *  filtrer côté UI la palette pour les sections « launch » / « failed »
   *  de la dialog d'édition de campagne (Phase 25+). Absent pour les
   *  url_click. */
  has_text_value?: boolean;
}

export interface Palette {
  mmEvents: PaletteItem[];
  redirectEvents: PaletteItem[];
}
