"use client";

import {
  BarChart,
  Bar,
  Grid,
  BarXAxis,
  ChartTooltip,
} from "@/components/ui/bar-chart";
import type { ComputedStep } from "@/lib/dashboards/types";
import { compactStepLabel } from "@/lib/dashboards/types";

/** 1 couleur stable par CUSTOM EVENT (identifié par son label) à travers
 *  toutes les étapes. Si le même event apparaît dans 2 barres, il a la
 *  même couleur dans les 2 (volontaire — on voit que c'est le même).
 *
 *  Palette 12 vraies couleurs distinctes (aucun gris/noir dominant) pour
 *  qu'aucun event ne se fonde dans un fond neutre. Espacées sur le wheel
 *  chromatique (~30°). À partir du 13ème event distinct, on cycle. */
const EVENT_COLORS = [
  "#7c3aed", // violet-600
  "#0284c7", // sky-600
  "#16a34a", // green-600
  "#ea580c", // orange-600
  "#dc2626", // red-600
  "#facc15", // yellow-400
  "#0d9488", // teal-600
  "#ec4899", // pink-500
  "#c026d3", // fuchsia-600
  "#65a30d", // lime-600
  "#0891b2", // cyan-600
  "#a16207", // yellow-700
];

/** Met en forme un nombre fr (1 234). */
function fmtNum(v: unknown): string {
  if (typeof v !== "number") return String(v);
  return v.toLocaleString("fr-FR");
}

export function FunnelChart({ steps: rawSteps }: { steps: ComputedStep[] }) {
  if (rawSteps.length === 0) return null;
  // Le step "Échec" synthétique ne s'affiche pas comme une barre : son
  // volume est rapporté en sous-ligne du step Lancement dans la table.
  const steps = rawSteps.filter((s) => s.synth_role !== "failed");
  if (steps.length === 0) return null;

  // Collecte les events distincts (par label) à travers toutes les étapes,
  // dans l'ordre d'apparition. Chacun gagne une couleur stable.
  type Series = { label: string; color: string };
  const series: Series[] = [];
  const seen = new Set<string>();
  for (const s of steps) {
    for (const r of s.refs) {
      if (!r.available || seen.has(r.label)) continue;
      seen.add(r.label);
      series.push({
        label: r.label,
        color: EVENT_COLORS[series.length % EVENT_COLORS.length],
      });
    }
  }
  // Cas dégénéré : aucun event available → on rend quand même quelque
  // chose pour éviter un chart vide cryptique.
  if (series.length === 0) {
    series.push({ label: "(vide)", color: EVENT_COLORS[0] });
  }

  // Data : 1 ligne par étape, 1 colonne par série + __total__ pour le
  // tooltip. Les colonnes série absentes d'une étape sont à 0.
  type Row = { label: string; __total__: number } & Record<
    string,
    number | string
  >;
  // Tronque les labels du chart à ~24 chars pour éviter le chevauchement
  // sur l'axe X quand un step porte un nom long (ex: "Lancement : Lancement
  // Boost MSTP Prospects"). La table en dessous garde le label complet.
  const truncate = (s: string, max = 24): string =>
    s.length <= max ? s : s.slice(0, max - 1) + "…";

  const data: Row[] = steps.map((s, i) => {
    const row: Row = {
      label: `${i + 1}. ${truncate(compactStepLabel(s))}`,
      __total__: s.count,
    };
    for (const ser of series) {
      const ref = s.refs.find(
        (r) => r.available && r.label === ser.label
      );
      row[ser.label] = ref ? ref.count : 0;
    }
    return row;
  });

  return (
    <div className="w-full">
      <BarChart
        data={data}
        xDataKey="label"
        stacked
        stackGap={2}
        barGap={0.3}
        margin={{ top: 36, right: 24, bottom: 56, left: 24 }}
        aspectRatio="16 / 7"
        animationDuration={900}
      >
        <Grid horizontal fadeHorizontal={false} />
        {series.map((ser) => (
          <Bar
            key={ser.label}
            dataKey={ser.label}
            fill={ser.color}
            lineCap={4}
            animationType="grow"
          />
        ))}
        <BarXAxis showAllLabels tickerHalfWidth={70} />
        <ChartTooltip
          showDots={false}
          rows={(point) => {
            const total = Number(point.__total__ ?? 0);
            // Total en tête (gris), puis chaque event présent dans cette
            // étape avec sa couleur stable + son volume. Tri par volume
            // décroissant.
            const rows = series
              .map((ser) => ({
                color: ser.color,
                label: ser.label,
                value: Number(point[ser.label] ?? 0),
              }))
              .filter((r) => r.value > 0)
              .sort((a, b) => b.value - a.value)
              .map((r) => ({ ...r, value: fmtNum(r.value) }));
            return [
              { color: "#71717a", label: "Total", value: fmtNum(total) },
              ...rows,
            ];
          }}
        />
      </BarChart>
    </div>
  );
}
