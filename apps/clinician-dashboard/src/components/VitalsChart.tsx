"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface VitalsSeries {
  /** dataKey on each point. */
  key: string;
  /** Localized legend label. */
  label: string;
  /** Stroke color (CSS color or hsl(var(--…))). */
  color: string;
}

export interface VitalsPoint {
  /** Epoch ms for the x-axis. */
  ts: number;
  [seriesKey: string]: number;
}

interface VitalsChartProps {
  title: string;
  series: VitalsSeries[];
  data: VitalsPoint[];
  unitSummary: string;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function VitalsChart({ title, series, data, unitSummary }: VitalsChartProps): JSX.Element {
  return (
    <figure className="w-full">
      <figcaption className="mb-2 text-sm font-medium text-foreground">{title}</figcaption>
      <div className="h-56 w-full" role="img" aria-label={unitSummary}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="ts"
              type="number"
              domain={["dataMin", "dataMax"]}
              scale="time"
              tickFormatter={formatTime}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              minTickGap={32}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              width={36}
              domain={["auto", "auto"]}
            />
            <Tooltip
              labelFormatter={(value: number) => new Date(value).toLocaleString()}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
