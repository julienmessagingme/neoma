"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MetaCostBreakdownItem } from "@/lib/dashboards/types";

/** Format EUR cohérent partout (2 décimales < 100 €, entier ≥ 100). */
function fmtEur(v: number): string {
  return v >= 100
    ? `${v.toFixed(0)} €`
    : `${v.toFixed(2).replace(".", ",")} €`;
}

/** Format prix unitaire à 4 décimales (les tarifs Meta sont du genre
 *  0,0791 €, 0,0067 €). */
function fmtRate(v: number): string {
  return `${v.toFixed(4).replace(".", ",")} €`;
}

/**
 * Modale de détail du coût Meta WhatsApp marketing, ventilé par pays.
 *
 * Réutilisée depuis :
 *   - `FunnelTable` (cellule « Coût Meta » d'une étape + ligne totale)
 *   - `EventAccordion` côté Stats (bouton « Détail » à côté du coût)
 *
 * Affiche : nom du pays, nb d'envois, tarif unitaire EUR, total EUR.
 * Trié par total décroissant (le pays le plus coûteux en haut).
 */
export function MetaCostBreakdownDialog({
  open,
  onOpenChange,
  title,
  breakdown,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  breakdown: MetaCostBreakdownItem[];
}) {
  const total = breakdown.reduce((acc, b) => acc + b.total_eur, 0);
  const totalCount = breakdown.reduce((acc, b) => acc + b.count, 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {breakdown.length === 0 ? (
          <p className="text-sm text-zinc-500 py-6">
            Aucun coût Meta pour cette sélection (pas d&apos;event porteur
            avec un numéro reconnu sur la période).
          </p>
        ) : (
          <>
            {/* Seule la liste des pays scrolle ; l'en-tête de colonnes est
                collant et le total + la note restent figés en pied. */}
            <div className="flex-1 overflow-auto -mx-1 px-1">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-zinc-500 border-b sticky top-0 bg-popover">
                  <tr>
                    <th className="py-2 pr-4">Pays</th>
                    <th className="py-2 pr-4 text-right">Envois</th>
                    <th className="py-2 pr-4 text-right">Tarif</th>
                    <th className="py-2 pr-4 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((b) => (
                    <tr key={b.iso} className="border-b">
                      <td className="py-1.5 pr-4">
                        <span className="text-[10px] font-mono mr-2 text-zinc-400">
                          {b.iso}
                        </span>
                        {b.name}
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">
                        {b.count}
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums text-zinc-600">
                        {fmtRate(b.rate_eur)}
                      </td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">
                        {fmtEur(b.total_eur)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="shrink-0 mt-2 pt-2 border-t-2 border-zinc-300 flex items-center justify-between text-sm font-semibold">
              <span>Total · {totalCount} envois</span>
              <span className="tabular-nums">{fmtEur(total)}</span>
            </div>
            <p className="shrink-0 text-xs text-zinc-500 mt-2">
              Tarifs Meta WhatsApp catégorie « Marketing » en EUR (tarifs
              officiels Meta). Indicatifs inconnus regroupés sous « Autre /
              non reconnu » (fallback 0,05 €).
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Bouton compact qui affiche un montant EUR cliquable. Au clic, ouvre
 *  la modale de breakdown si fournie. Utilisé dans FunnelTable et
 *  EventAccordion. */
export function MetaCostButton({
  amountEur,
  breakdown,
  title,
}: {
  amountEur: number;
  breakdown: MetaCostBreakdownItem[] | undefined;
  title: string;
}) {
  // Le state local évite de remonter à chaque parent. Si on a beaucoup
  // de cellules dans une table, on instancie une dialog par cellule —
  // OK car la dialog est démontée tant que `open=false`.
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!breakdown || breakdown.length === 0}
        className="text-zinc-700 hover:text-zinc-900 hover:underline disabled:no-underline disabled:cursor-default disabled:text-zinc-400"
        title={
          breakdown && breakdown.length > 0
            ? `Cliquez pour voir le détail par pays (${breakdown.length} pays)`
            : "Aucun détail disponible"
        }
      >
        {fmtEur(amountEur)}
      </button>
      {breakdown && (
        <MetaCostBreakdownDialog
          open={open}
          onOpenChange={setOpen}
          title={title}
          breakdown={breakdown}
        />
      )}
    </>
  );
}

