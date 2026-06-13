"use client";

import { EmptyState, Skeleton } from "@medflow/ui";
import { useTranslations } from "next-intl";

import { useDocumentReferences } from "@/lib/api/hooks";
import { documentTitle } from "@/lib/fhir-display";

function excerpt(text: string, max = 220): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

export function NotesTab({ patientId }: { patientId: string }): JSX.Element {
  const t = useTranslations("patient.notes");
  const docs = useDocumentReferences(patientId);

  if (docs.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (!docs.data || docs.data.length === 0) {
    return <EmptyState title={t("empty")} description={t("emptyDesc")} />;
  }

  return (
    <ol className="relative ms-3 space-y-6 border-s border-border ps-6">
      {docs.data.map((doc) => {
        const author = doc.author?.[0]?.display;
        const date = doc.date ? new Date(doc.date).toLocaleString() : "—";
        // DocumentReference text may live in description; attachment data is
        // base64 and not decoded here for the timeline excerpt.
        const body = doc.description ?? doc.content?.[0]?.attachment?.title ?? "";
        return (
          <li key={doc.id} className="relative">
            <span
              aria-hidden="true"
              className="absolute -start-[1.85rem] top-1.5 h-3 w-3 rounded-full border-2 border-background bg-primary"
            />
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{documentTitle(doc)}</p>
              <span className="text-xs text-muted-foreground">{date}</span>
            </div>
            {author ? (
              <p className="text-xs text-muted-foreground">
                {t("author")}: {author}
              </p>
            ) : null}
            {body ? <p className="mt-1 text-sm text-muted-foreground">{excerpt(body)}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
