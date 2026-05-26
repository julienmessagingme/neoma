/**
 * Détection des crawlers qui suivent une URL pour générer une link-preview
 * (carte d'aperçu) plutôt qu'une vraie navigation utilisateur.
 *
 * Quand un template WhatsApp contient une URL trackée `/r/<slug>`, Meta
 * (et d'autres plateformes) crawl le lien pour générer la preview montrée
 * au contact dans le chat. Sans filtre, chaque envoi de template produit
 * 1+ hits dans `clicks` — les compteurs reflètent les envois, pas les
 * vrais clics. Constaté en prod (mai 2026) : 149 hits sur 150 étaient
 * `facebookexternalua` depuis le range IPv6 `2a03:2880::/29` (ASN AS32934
 * Facebook).
 *
 * Stratégie : on garde le redirect 302 (sinon Meta ne pourrait pas générer
 * la preview) mais on n'insère PAS de row dans `clicks` pour ces UA.
 *
 * Liste basée sur les UA observés en pratique + les principaux acteurs
 * connus pour faire du link-preview server-side. À enrichir si on voit
 * d'autres bots faire bouger les compteurs.
 */

const PREVIEW_BOT_REGEX =
  /(facebookexternalua|facebookexternalhit|facebookcatalog|meta-externalagent|whatsapp|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|skypeuripreview|bingbot|googlebot|google-inspectiontool|applebot|yandexbot|duckduckbot|baiduspider|petalbot|developers\.google\.com\/\+\/web\/snippet|embedly|outbrain|snapchat|pinterest|redditbot)/i;

export function isLinkPreviewBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return PREVIEW_BOT_REGEX.test(userAgent);
}
