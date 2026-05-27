import { NextResponse } from "next/server";
import { lookupSlug } from "@/lib/redirect/lookup";
import { checkRate } from "@/lib/redirect/rate-limit";
import { getClientIp } from "@/lib/redirect/client-ip";
import { isLinkPreviewBotRich } from "@/lib/redirect/link-preview-bot";
import { getSupabase } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ slug: string }> }
) {
  const { slug } = await ctx.params;

  const ip = getClientIp(req) ?? "unknown";
  if (!checkRate(ip)) {
    return new NextResponse("Trop de requêtes.", { status: 429 });
  }

  let lookup;
  try {
    lookup = await lookupSlug(slug);
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "redirect lookup db error",
        slug,
        err: err instanceof Error ? err.message : String(err),
      })
    );
    return new NextResponse("Service indisponible.", { status: 503 });
  }

  if (!lookup) {
    return new NextResponse("Lien introuvable.", { status: 404 });
  }

  const userAgent = req.headers.get("user-agent");
  const referer = req.headers.get("referer");

  // Skip count pour les bots de link-preview (Meta/WhatsApp/Twitter/etc.)
  // qui hit l'URL pour générer la card preview sans vraie navigation
  // utilisateur. On répond quand même 302 — sinon la preview ne se
  // génère pas chez le destinataire. La version "Rich" check aussi l'IP
  // (range Meta) + le Referer (facebook.com), car depuis 2024 Meta spoof
  // l'UA d'un vrai navigateur mobile. Voir lib/redirect/link-preview-bot.
  if (!isLinkPreviewBotRich({ userAgent, ip: ip === "unknown" ? null : ip, referer })) {
    // Fire-and-forget click insert (don't block redirect)
    void getSupabase()
      .from("clicks")
      .insert({
        event_id: lookup.eventId,
        version_id: lookup.versionId,
        ip: ip === "unknown" ? null : ip,
        user_agent: userAgent,
        referer,
      })
      .then(({ error }: { error: { message?: string } | null }) => {
        if (error) {
          console.error(
            JSON.stringify({
              level: "error",
              msg: "click insert failed",
              slug,
              err: error.message,
            })
          );
        }
      });
  }

  return NextResponse.redirect(lookup.destinationUrl, { status: 302 });
}
