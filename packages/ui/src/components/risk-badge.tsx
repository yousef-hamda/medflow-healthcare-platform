"use client";

import type { HTMLAttributes } from "react";

import { cn } from "../lib/cn";

export type RiskLevel = "low" | "medium" | "high";

/** Map a 0..1 risk score onto a categorical level. Thresholds match the ML platform contract. */
export function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 0.7) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}

const LEVEL_CLASSES: Record<RiskLevel, string> = {
  low: "bg-risk-low/15 text-risk-low border-risk-low/40",
  medium: "bg-risk-medium/15 text-risk-medium border-risk-medium/40",
  high: "bg-risk-high/15 text-risk-high border-risk-high/40",
};

const LEVEL_DOT_CLASSES: Record<RiskLevel, string> = {
  low: "bg-risk-low",
  medium: "bg-risk-medium",
  high: "bg-risk-high",
};

export interface RiskBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Explicit level; if omitted, derived from `score`. */
  level?: RiskLevel;
  /** Risk probability in [0, 1]. Rendered as a percentage when provided. */
  score?: number;
  /** Localized label override (defaults to the level name). */
  label?: string;
}

export function RiskBadge({
  level,
  score,
  label,
  className,
  ...props
}: RiskBadgeProps): JSX.Element {
  const resolved: RiskLevel = level ?? riskLevelFromScore(score ?? 0);
  const text = label ?? resolved;
  return (
    <span
      role="status"
      aria-label={
        score !== undefined
          ? `${text} risk, ${Math.round(score * 100)} percent`
          : `${text} risk`
      }
      data-level={resolved}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize",
        LEVEL_CLASSES[resolved],
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", LEVEL_DOT_CLASSES[resolved])} />
      {text}
      {score !== undefined ? (
        <span className="font-mono tabular-nums">{Math.round(score * 100)}%</span>
      ) : null}
    </span>
  );
}
