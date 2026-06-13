"use client";

import { useId, useState, type ReactNode } from "react";

import { cn } from "../lib/cn";

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
}

export function Tooltip({ content, children, side = "top", className }: TooltipProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open ? (
        <span
          role="tooltip"
          id={id}
          className={cn(
            "absolute start-1/2 z-50 w-max max-w-xs ltr:-translate-x-1/2 rtl:translate-x-1/2 rounded-md border border-border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md animate-fade-in",
            side === "top" ? "bottom-full mb-2" : "top-full mt-2",
            className,
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
