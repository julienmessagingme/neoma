"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useScope } from "./scope-context";

/**
 * Sub-navigation rendered inside /urls, /stats and /dashboards pages.
 * Single source of truth for the URLs / Stats / Mes tableaux tab styling
 * and active state. En mode EDH groupe, l'onglet "URLs" est masqué : la
 * création d'URLs trackées reste per-école (un slug = un template Meta
 * pour une école précise).
 */
export function SubNavStats() {
  const pathname = usePathname();
  const { isEdh } = useScope();
  const tabs: { href: string; label: string; match: (p: string) => boolean }[] = [];
  if (!isEdh) {
    tabs.push({
      href: "/urls",
      label: "URLs",
      match: (p) => p.startsWith("/urls"),
    });
  }
  tabs.push(
    { href: "/stats", label: "Stats", match: (p) => p.startsWith("/stats") },
    {
      href: "/dashboards",
      label: "Mes tableaux",
      match: (p) => p.startsWith("/dashboards"),
    },
    {
      href: "/campaigns",
      label: "Campagnes",
      match: (p) => p.startsWith("/campaigns"),
    }
  );

  return (
    <nav className="flex gap-2">
      {tabs.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            prefetch={false}
            className={
              active
                ? "px-3 py-1.5 rounded bg-zinc-900 text-white text-sm"
                : "px-3 py-1.5 rounded hover:bg-zinc-100 text-sm text-zinc-700"
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
