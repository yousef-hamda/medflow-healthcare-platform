"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Select, useToast } from "@medflow/ui";
import { QrCode } from "@/components/QrCode";
import { useCreateShareToken } from "@/lib/api/hooks";
import { SHARE_SCOPES, validateShareForm, type ShareScope } from "@/lib/share";
import { formatDateTime } from "@/lib/dates";

interface ActiveToken {
  token: string;
  url: string;
  expiresAt: string;
  scopes: ShareScope[];
}

const EXPIRY_OPTIONS = [6, 24, 48, 72] as const;

export function ShareForm() {
  const t = useTranslations("share");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { toast } = useToast();
  const createToken = useCreateShareToken();

  const [scopes, setScopes] = useState<Set<ShareScope>>(new Set());
  const [expiresInHours, setExpiresInHours] = useState<number>(24);
  const [errors, setErrors] = useState<{ scopes?: string; expiry?: string }>({});
  const [active, setActive] = useState<ActiveToken[]>([]);
  const [latest, setLatest] = useState<ActiveToken | null>(null);

  function toggleScope(scope: ShareScope) {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const selected = Array.from(scopes);
    const validation = validateShareForm({ scopes: selected, expiresInHours });
    if (!validation.success || !validation.data) {
      setErrors({
        scopes: validation.errors.scopes ? t("scopeError") : undefined,
        expiry: validation.errors.expiresInHours ? t("expiryError") : undefined,
      });
      return;
    }
    setErrors({});
    createToken.mutate(
      { scopes: selected, expiresAt: validation.data.expiresAt },
      {
        onSuccess: (res) => {
          const token: ActiveToken = { token: res.token, url: res.url, expiresAt: res.expiresAt, scopes: selected };
          setLatest(token);
          setActive((prev) => [token, ...prev]);
          toast({ title: t("created"), variant: "success" });
        },
        onError: () => toast({ title: tCommon("error"), variant: "destructive" }),
      },
    );
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: t("copied"), variant: "success" });
    } catch {
      toast({ title: tCommon("error"), variant: "destructive" });
    }
  }

  function revoke(token: string) {
    setActive((prev) => prev.filter((tk) => tk.token !== token));
    if (latest?.token === token) setLatest(null);
    toast({ title: t("revoked") });
  }

  const scopeLabels: Record<ShareScope, string> = {
    labs: t("scopeLabs"),
    medications: t("scopeMedications"),
    vitals: t("scopeVitals"),
    conditions: t("scopeConditions"),
    allergies: t("scopeAllergies"),
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t("create")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-6" noValidate>
            <fieldset>
              <legend className="text-sm font-medium">{t("scopes")}</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {SHARE_SCOPES.map((scope) => (
                  <label key={scope} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent/40">
                    <input
                      type="checkbox"
                      checked={scopes.has(scope)}
                      onChange={() => toggleScope(scope)}
                      className="h-4 w-4 rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <span>{scopeLabels[scope]}</span>
                  </label>
                ))}
              </div>
              {errors.scopes ? (
                <p role="alert" className="mt-2 text-xs font-medium text-destructive">
                  {errors.scopes}
                </p>
              ) : null}
            </fieldset>

            <div className="space-y-1.5">
              <label htmlFor="share-expiry" className="block text-sm font-medium">
                {t("expiry")}
              </label>
              <Select
                id="share-expiry"
                value={String(expiresInHours)}
                onChange={(e) => setExpiresInHours(Number(e.target.value))}
                aria-describedby="share-expiry-hint"
              >
                {EXPIRY_OPTIONS.map((h) => (
                  <option key={h} value={h}>
                    {t(`expiry${h}`)}
                  </option>
                ))}
              </Select>
              <p id="share-expiry-hint" className="text-xs text-muted-foreground">
                {t("maxExpiry")}
              </p>
              {errors.expiry ? (
                <p role="alert" className="text-xs font-medium text-destructive">
                  {errors.expiry}
                </p>
              ) : null}
            </div>

            <Button type="submit" loading={createToken.isPending}>
              {t("create")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-6">
        {latest ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("qrTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4">
              <QrCode value={latest.url} alt={t("qrTitle")} />
              <div className="w-full space-y-2 text-center">
                <p className="break-all rounded-md bg-muted px-3 py-2 text-xs">{latest.url}</p>
                <Button variant="outline" size="sm" onClick={() => copyLink(latest.url)}>
                  {t("copyLink")}
                </Button>
                <p className="text-xs text-muted-foreground">{t("expiresAt", { date: formatDateTime(latest.expiresAt, locale) })}</p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>{t("active")}</CardTitle>
          </CardHeader>
          <CardContent>
            {active.length === 0 ? (
              <EmptyState title={t("activeEmpty")} />
            ) : (
              <ul className="divide-y divide-border">
                {active.map((tk) => (
                  <li key={tk.token} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <div className="flex flex-wrap gap-1">
                        {tk.scopes.map((s) => (
                          <Badge key={s} variant="secondary">
                            {scopeLabels[s]}
                          </Badge>
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{t("expiresAt", { date: formatDateTime(tk.expiresAt, locale) })}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => revoke(tk.token)}>
                      {t("revoke")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
