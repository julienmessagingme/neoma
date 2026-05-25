import { redirect } from "next/navigation";
import { UrlsClient } from "./urls-client";
import { env } from "@/lib/env";
import { getCurrentSchoolSlug } from "@/lib/schools/context";
import { isEdhScope } from "@/lib/schools";

export default async function UrlsPage() {
  const schoolSlug = await getCurrentSchoolSlug();
  // URLs trackées sont per-école (slug template Meta lié à une école) :
  // pas de sens en mode EDH groupe → renvoie vers Stats agrégées.
  if (isEdhScope(schoolSlug)) redirect("/stats");
  return <UrlsClient key={schoolSlug} publicBaseUrl={env.publicBaseUrl} />;
}
