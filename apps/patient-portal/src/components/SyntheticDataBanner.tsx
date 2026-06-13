import { useTranslations } from "next-intl";

/**
 * Prominent disclaimer banner — reused across the app to make it unmistakable
 * that all data is synthetic.
 */
export function SyntheticDataBanner({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("synthetic");
  return (
    <div
      role="note"
      className={
        compact
          ? "flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning-foreground"
          : "flex items-center justify-center gap-2 border-b border-warning/40 bg-warning/15 px-4 py-2 text-center text-sm font-medium text-foreground"
      }
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-warning" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      </svg>
      <span>{compact ? t("short") : t("banner")}</span>
    </div>
  );
}
