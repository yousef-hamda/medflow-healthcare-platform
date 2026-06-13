"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { AgeBucket, GenderSlice } from "@/lib/cohort";

const PIE_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--risk-medium))",
  "hsl(var(--risk-low))",
  "hsl(var(--muted-foreground))",
];

export function AgeHistogram({
  data,
  summary,
}: {
  data: AgeBucket[];
  summary: string;
}): JSX.Element {
  return (
    <figure className="w-full">
      <figcaption className="sr-only">{summary}</figcaption>
      <div className="h-56 w-full" role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={32} />
            <Tooltip />
            <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export function GenderPie({
  data,
  summary,
}: {
  data: GenderSlice[];
  summary: string;
}): JSX.Element {
  return (
    <figure className="w-full">
      <figcaption className="sr-only">{summary}</figcaption>
      <div className="h-56 w-full" role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="gender"
              cx="50%"
              cy="50%"
              outerRadius={80}
              isAnimationActive={false}
              label
            >
              {data.map((slice, i) => (
                <Cell key={slice.gender} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
