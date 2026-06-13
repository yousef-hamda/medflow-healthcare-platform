"use client";

import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { FeatureContribution } from "@/lib/api/types";

interface ShapBarChartProps {
  contributors: FeatureContribution[];
  /** Accessible summary of the chart for screen readers. */
  summary: string;
}

interface Row {
  feature: string;
  shapValue: number;
}

/** Horizontal bar chart of the top-N SHAP contributions (positive=red, negative=green). */
export function ShapBarChart({ contributors, summary }: ShapBarChartProps): JSX.Element {
  const rows: Row[] = [...contributors]
    .sort((a, b) => Math.abs(b.shapValue) - Math.abs(a.shapValue))
    .slice(0, 5)
    .map((c) => ({ feature: c.feature, shapValue: Number(c.shapValue.toFixed(3)) }));

  return (
    <figure className="w-full">
      <figcaption className="sr-only">{summary}</figcaption>
      <div className="h-56 w-full" role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart layout="vertical" data={rows} margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="feature"
              width={140}
              tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
            />
            <Tooltip cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }} />
            <Bar dataKey="shapValue" radius={4} isAnimationActive={false}>
              {rows.map((row) => (
                <Cell
                  key={row.feature}
                  fill={row.shapValue >= 0 ? "hsl(var(--risk-high))" : "hsl(var(--risk-low))"}
                />
              ))}
              <LabelList
                dataKey="shapValue"
                position="right"
                className="fill-foreground"
                style={{ fontSize: 11 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
