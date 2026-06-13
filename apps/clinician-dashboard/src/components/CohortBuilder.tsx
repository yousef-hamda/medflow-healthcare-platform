"use client";

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Select,
  StatCard,
  useToast,
} from "@medflow/ui";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { AgeHistogram, GenderPie } from "@/components/CohortCharts";
import { CodeAutocomplete } from "@/components/CodeAutocomplete";
import valuesets from "@/data/valuesets.json";
import { useCohort } from "@/lib/api/hooks";
import {
  criteriaToCsv,
  type CohortCriterion,
  type GenderCriterionValue,
  type NormalizedCohort,
  type SavedCohort,
} from "@/lib/cohort";

const SAVED_KEY = "medflow.cohorts";

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadSaved(): SavedCohort[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SAVED_KEY);
    return raw ? (JSON.parse(raw) as SavedCohort[]) : [];
  } catch {
    return [];
  }
}

function persistSaved(cohorts: SavedCohort[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SAVED_KEY, JSON.stringify(cohorts));
  } catch {
    // storage unavailable; saving is best-effort.
  }
}

export function CohortBuilder(): JSX.Element {
  const t = useTranslations("cohort");
  const tc = useTranslations("common");
  const { toast } = useToast();
  const cohort = useCohort();

  const [criteria, setCriteria] = useState<CohortCriterion[]>([
    { id: uid(), type: "ageRange", minAge: 18, maxAge: 90 },
  ]);
  const [result, setResult] = useState<NormalizedCohort | null>(null);
  const [saved, setSaved] = useState<SavedCohort[]>([]);
  const [cohortName, setCohortName] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSaved(loadSaved());
  }, []);

  // Debounced cohort preview (400ms) whenever criteria change.
  const runPreview = useCallback(
    (next: CohortCriterion[]) => {
      cohort.mutate(next, {
        onSuccess: (data) => setResult(data),
      });
    },
    [cohort],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runPreview(criteria), 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criteria]);

  const conditionOptions = valuesets.conditions;
  const medicationOptions = valuesets.medications;

  const addCriterion = (type: CohortCriterion["type"]): void => {
    setCriteria((prev) => {
      if (type === "ageRange") return [...prev, { id: uid(), type, minAge: 0, maxAge: 100 }];
      if (type === "gender") return [...prev, { id: uid(), type, gender: "female" }];
      return prev; // condition/medication added via autocomplete
    });
  };

  const removeCriterion = (id: string): void => {
    setCriteria((prev) => prev.filter((c) => c.id !== id));
  };

  const move = (index: number, delta: number): void => {
    setCriteria((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target] as CohortCriterion, next[index] as CohortCriterion];
      return next;
    });
  };

  const updateCriterion = (id: string, patch: Partial<CohortCriterion>): void => {
    setCriteria((prev) =>
      prev.map((c) => (c.id === id ? ({ ...c, ...patch } as CohortCriterion) : c)),
    );
  };

  const save = (): void => {
    const name = cohortName.trim();
    if (!name) return;
    const entry: SavedCohort = { name, criteria, savedAt: new Date().toISOString() };
    const next = [...saved.filter((s) => s.name !== name), entry];
    setSaved(next);
    persistSaved(next);
    setCohortName("");
    toast({ title: `${tc("save")}: ${name}`, variant: "success" });
  };

  const loadCohort = (entry: SavedCohort): void => {
    setCriteria(entry.criteria.map((c) => ({ ...c, id: uid() })));
  };

  const deleteCohort = (name: string): void => {
    const next = saved.filter((s) => s.name !== name);
    setSaved(next);
    persistSaved(next);
  };

  const exportCsv = (): void => {
    const csv = criteriaToCsv(criteria, result);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cohort-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const genderValues: GenderCriterionValue[] = ["male", "female", "other"];

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem,1fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">{t("criteria")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-3">
              {criteria.map((c, index) => (
                <li key={c.id} className="rounded-md border border-border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">
                      {t(c.type === "ageRange" ? "ageRange" : c.type)}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label={t("moveUp")}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label={t("moveDown")}
                        disabled={index === criteria.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        ↓
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label={tc("remove")}
                        onClick={() => removeCriterion(c.id)}
                      >
                        ✕
                      </Button>
                    </div>
                  </div>

                  {c.type === "ageRange" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs">
                        {t("minAge")}
                        <Input
                          type="number"
                          min={0}
                          max={120}
                          value={c.minAge}
                          onChange={(e) =>
                            updateCriterion(c.id, { minAge: Number(e.target.value) })
                          }
                        />
                      </label>
                      <label className="text-xs">
                        {t("maxAge")}
                        <Input
                          type="number"
                          min={0}
                          max={120}
                          value={c.maxAge}
                          onChange={(e) =>
                            updateCriterion(c.id, { maxAge: Number(e.target.value) })
                          }
                        />
                      </label>
                    </div>
                  ) : null}

                  {c.type === "gender" ? (
                    <Select
                      aria-label={t("gender")}
                      value={c.gender}
                      onChange={(e) =>
                        updateCriterion(c.id, {
                          gender: e.target.value as GenderCriterionValue,
                        })
                      }
                    >
                      {genderValues.map((g) => (
                        <option key={g} value={g}>
                          {t(g)}
                        </option>
                      ))}
                    </Select>
                  ) : null}

                  {c.type === "condition" || c.type === "medication" ? (
                    <p className="text-sm">
                      <span className="font-medium">{c.display}</span>{" "}
                      <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onClick={() => addCriterion("ageRange")}>
                + {t("ageRange")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => addCriterion("gender")}>
                + {t("gender")}
              </Button>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">{t("condition")}</span>
              <CodeAutocomplete
                options={conditionOptions}
                label={t("condition")}
                placeholder={t("conditionPlaceholder")}
                onSelect={(opt) =>
                  setCriteria((prev) => [
                    ...prev,
                    { id: uid(), type: "condition", code: opt.code, display: opt.display },
                  ])
                }
              />
            </div>
            <div className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">{t("medication")}</span>
              <CodeAutocomplete
                options={medicationOptions}
                label={t("medication")}
                placeholder={t("medicationPlaceholder")}
                onSelect={(opt) =>
                  setCriteria((prev) => [
                    ...prev,
                    { id: uid(), type: "medication", code: opt.code, display: opt.display },
                  ])
                }
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("savedCohorts")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                aria-label={t("cohortName")}
                placeholder={t("cohortName")}
                value={cohortName}
                onChange={(e) => setCohortName(e.target.value)}
              />
              <Button size="sm" onClick={save} disabled={!cohortName.trim()}>
                {tc("save")}
              </Button>
            </div>
            {saved.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noSaved")}</p>
            ) : (
              <ul className="space-y-1">
                {saved.map((s) => (
                  <li key={s.name} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{s.name}</span>
                    <span className="flex shrink-0 gap-1">
                      <Button size="sm" variant="ghost" onClick={() => loadCohort(s)}>
                        {t("load")}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label={t("deleteSaved")}
                        onClick={() => deleteCohort(s.name)}
                      >
                        ✕
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("result")}</h2>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!result}>
            {t("exportCsv")}
          </Button>
        </div>

        {cohort.isPending && !result ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t("computing")}
          </p>
        ) : null}

        {result ? (
          <>
            <StatCard
              title={t("count")}
              value={<span data-testid="cohort-count">{result.count.toLocaleString()}</span>}
            />
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("ageHistogram")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {result.ageBuckets.length > 0 ? (
                    <AgeHistogram data={result.ageBuckets} summary={t("ageHistogramSummary")} />
                  ) : (
                    <p className="text-sm text-muted-foreground">{tc("none")}</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("genderBreakdown")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {result.genderBreakdown.length > 0 ? (
                    <GenderPie data={result.genderBreakdown} summary={t("genderPieSummary")} />
                  ) : (
                    <p className="text-sm text-muted-foreground">{tc("none")}</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        ) : (
          <EmptyState title={t("noResult")} />
        )}
      </div>
    </div>
  );
}
