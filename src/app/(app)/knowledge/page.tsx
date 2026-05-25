import { redirect } from "next/navigation";
import { KnowledgeClient } from "./knowledge-client";
import { getCurrentSchoolSlug } from "@/lib/schools/context";
import { getSchoolBySlug, isEdhScope } from "@/lib/schools";

export default async function KnowledgePage() {
  const schoolSlug = await getCurrentSchoolSlug();
  // La base de connaissance est per-école (1 vector store OpenAI par école) :
  // pas de notion de KB groupe en mode EDH → renvoie vers Stats agrégées.
  if (isEdhScope(schoolSlug)) redirect("/stats");
  const school = getSchoolBySlug(schoolSlug);
  return (
    <KnowledgeClient
      key={schoolSlug}
      schoolSlug={schoolSlug}
      schoolName={school?.name ?? schoolSlug}
    />
  );
}
