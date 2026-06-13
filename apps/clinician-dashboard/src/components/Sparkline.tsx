"use client";

import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";

interface SparklineProps {
  values: number[];
  summary: string;
  color?: string;
}

/** Compact, axis-light trend line for metric history (e.g. AUROC). */
export function Sparkline({ values, summary, color }: SparklineProps): JSX.Element {
  const data = values.map((value, index) => ({ index, value }));
  return (
    <div className="h-12 w-full" role="img" aria-label={summary}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, bottom: 4, left: 0, right: 0 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color ?? "hsl(var(--primary))"}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
