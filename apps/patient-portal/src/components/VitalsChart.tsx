"use client";

import { useTranslations } from "next-intl";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface VitalsSeries {
  key: string;
  label: string;
  color: string;
}

export interface VitalsPoint {
  /** Display label for the x axis (formatted date). */
  date: string;
  /** Underlying timestamp for sorting/aria. */
  ts: number;
  [seriesKey: string]: number | string;
}

interface VitalsChartProps {
  metricLabel: string;
  unit: string;
  data: VitalsPoint[];
  series: VitalsSeries[];
}

/**
 * Accessible vitals line chart. The SVG is given an aria-label summarizing the
 * latest value, and a visually-hidden table provides the full data to screen
 * readers (Recharts SVGs are otherwise opaque to AT).
 */
export function VitalsChart({ metricLabel, unit, data, series }: VitalsChartProps) {
  const t = useTranslations("vitals");
  const last = data[data.length - 1];
  const latest = last ? (last[series[0].key] as number | undefined) : undefined;
  const summary = t("chartSummary", {
    metric: metricLabel,
    latest: latest ?? "—",
    unit,
  });

  return (
    <figure>
      <div role="img" aria-label={summary} className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="date" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--border))" />
            <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--border))" width={48} />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "var(--radius)",
                color: "hsl(var(--popover-foreground))",
                fontSize: 12,
              }}
            />
            {series.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">
        <table>
          <caption>{summary}</caption>
          <thead>
            <tr>
              <th scope="col">{metricLabel}</th>
              {series.map((s) => (
                <th key={s.key} scope="col">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((point) => (
              <tr key={point.ts}>
                <th scope="row">{point.date}</th>
                {series.map((s) => (
                  <td key={s.key}>{String(point[s.key] ?? "—")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}
