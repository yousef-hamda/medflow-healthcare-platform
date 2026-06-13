"use client";

import { EmptyState } from "@medflow/ui";
import type { CdsCard, CdsIndicator } from "@medflow/shared-types";

const INDICATOR_STYLES: Record<CdsIndicator, string> = {
  info: "border-s-primary bg-primary/5",
  warning: "border-s-warning bg-warning/5",
  critical: "border-s-destructive bg-destructive/5",
};

const INDICATOR_LABEL: Record<CdsIndicator, string> = {
  info: "Info",
  warning: "Warning",
  critical: "Critical",
};

interface CdsCardListProps {
  cards: CdsCard[];
  emptyTitle: string;
  emptyDescription: string;
}

export function CdsCardList({ cards, emptyTitle, emptyDescription }: CdsCardListProps): JSX.Element {
  if (cards.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <ul className="space-y-3">
      {cards.map((card, i) => (
        <li
          key={card.uuid ?? `${card.summary}-${i}`}
          className={`rounded-md border border-s-4 border-border p-4 ${INDICATOR_STYLES[card.indicator]}`}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium text-foreground">{card.summary}</p>
            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs font-semibold capitalize">
              {INDICATOR_LABEL[card.indicator]}
            </span>
          </div>
          {card.detail ? (
            <p className="mt-1 text-sm text-muted-foreground">{card.detail}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>
              {card.source.url ? (
                <a
                  href={card.source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {card.source.label}
                </a>
              ) : (
                card.source.label
              )}
            </span>
            {(card.links ?? []).map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
