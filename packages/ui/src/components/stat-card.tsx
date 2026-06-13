"use client";

import type { ReactNode } from "react";

import { cn } from "../lib/cn";
import { Card, CardContent, CardHeader, CardTitle } from "./card";

export interface StatCardProps {
  title: string;
  value: ReactNode;
  description?: string;
  icon?: ReactNode;
  trend?: {
    value: number;
    direction: "up" | "down";
    /** Whether the direction is good news (controls color). Defaults to up=good. */
    positive?: boolean;
  };
  className?: string;
}

export function StatCard({
  title,
  value,
  description,
  icon,
  trend,
  className,
}: StatCardProps): JSX.Element {
  const trendPositive = trend ? (trend.positive ?? trend.direction === "up") : false;
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {icon ? (
          <span aria-hidden="true" className="text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">
            {icon}
          </span>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        <div className="mt-1 flex items-center gap-2">
          {trend ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-xs font-medium",
                trendPositive ? "text-success" : "text-destructive",
              )}
            >
              <span aria-hidden="true">{trend.direction === "up" ? "▲" : "▼"}</span>
              <span className="sr-only">{trend.direction === "up" ? "Up" : "Down"}</span>
              {Math.abs(trend.value)}%
            </span>
          ) : null}
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
