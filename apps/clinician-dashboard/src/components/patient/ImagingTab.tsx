"use client";

import { Button, EmptyState, Skeleton, useToast } from "@medflow/ui";
import type { ImagingStudy } from "@medflow/fhir-types";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

import { useChestXray, useImagingStudies } from "@/lib/api/hooks";

// Default window/level for a typical 8-bit chest X-ray render.
const DEFAULT_WW = 256;
const DEFAULT_WC = 128;

interface CornerstoneHandle {
  setWindowLevel: (ww: number, wc: number) => void;
  destroy: () => void;
}

/**
 * Initializes Cornerstone3D + the WADO-URI DICOM loader entirely client-side.
 * Returns a small imperative handle, or null if init fails / no DICOM is
 * available (we then fall back to a synthetic canvas render).
 */
async function initCornerstone(
  element: HTMLDivElement,
  imageId: string,
): Promise<CornerstoneHandle | null> {
  if (typeof window === "undefined") return null;
  // Minimal structural views of the Cornerstone API so this module does not
  // couple to the library's exact (and version-dependent) type surface.
  interface CsViewport {
    setStack: (ids: string[]) => Promise<void>;
    setProperties: (p: { voiRange: { lower: number; upper: number } }) => void;
    render: () => void;
  }
  interface CsRenderingEngine {
    enableElement: (opts: { viewportId: string; type: string; element: HTMLDivElement }) => void;
    getViewport: (viewportId: string) => CsViewport;
    destroy: () => void;
  }
  interface CsCore {
    init: () => Promise<void>;
    RenderingEngine: new (id: string) => CsRenderingEngine;
    Enums: { ViewportType: { STACK: string } };
  }
  interface CsLoader {
    external?: { cornerstone?: unknown; dicomParser?: unknown };
  }

  try {
    const core = (await import("@cornerstonejs/core")) as unknown as CsCore;
    const dicomImageLoader = (await import("@cornerstonejs/dicom-image-loader")) as unknown as CsLoader;
    const dicomParser = await import("dicom-parser");

    await core.init();

    // Wire the DICOM image loader to Cornerstone core.
    if (dicomImageLoader.external) {
      dicomImageLoader.external.cornerstone = core;
      dicomImageLoader.external.dicomParser = dicomParser;
    }

    const engineId = "medflow-engine";
    const viewportId = "medflow-viewport";
    const renderingEngine = new core.RenderingEngine(engineId);

    renderingEngine.enableElement({
      viewportId,
      type: core.Enums.ViewportType.STACK,
      element,
    });

    const viewport = renderingEngine.getViewport(viewportId);
    await viewport.setStack([imageId]);
    viewport.render();

    return {
      setWindowLevel: (ww, wc) => {
        viewport.setProperties({ voiRange: { lower: wc - ww / 2, upper: wc + ww / 2 } });
        viewport.render();
      },
      destroy: () => {
        try {
          renderingEngine.destroy();
        } catch {
          // already torn down
        }
      },
    };
  } catch {
    return null;
  }
}

/** Draws a synthetic gradient so the viewer renders with no real DICOM. */
function drawPlaceholder(canvas: HTMLCanvasElement, ww: number, wc: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  const image = ctx.createImageData(width, height);
  const lower = wc - ww / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Radial chest-like phantom.
      const dx = (x - width / 2) / (width / 2);
      const dy = (y - height / 2) / (height / 2);
      const r = Math.sqrt(dx * dx + dy * dy);
      const raw = 255 * Math.max(0, 1 - r) + 20 * Math.sin(x / 8);
      const v = Math.max(0, Math.min(255, ((raw - lower) / ww) * 255));
      const idx = (y * width + x) * 4;
      image.data[idx] = v;
      image.data[idx + 1] = v;
      image.data[idx + 2] = v;
      image.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export function ImagingTab({ patientId }: { patientId: string }): JSX.Element {
  const t = useTranslations("patient.imaging");
  const { toast } = useToast();
  const studies = useImagingStudies(patientId);
  const chestXray = useChestXray();

  const viewerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<CornerstoneHandle | null>(null);

  const [ww, setWw] = useState(DEFAULT_WW);
  const [wc, setWc] = useState(DEFAULT_WC);
  const [useFallback, setUseFallback] = useState(false);
  const [showGradcam, setShowGradcam] = useState(false);
  const [gradcamOpacity, setGradcamOpacity] = useState(0.5);

  const wwId = useId();
  const wcId = useId();
  const opacityId = useId();

  const study: ImagingStudy | undefined = studies.data?.[0];
  const hasInstances = Boolean(study?.series?.some((s) => (s.instance?.length ?? 0) > 0));

  // A WADO-URI image id if endpoints exist; otherwise we render the phantom.
  const imageId =
    study?.series?.[0]?.endpoint?.[0]?.reference ??
    study?.endpoint?.[0]?.reference ??
    "";

  useEffect(() => {
    let cancelled = false;
    if (!viewerRef.current) return;
    if (!hasInstances || !imageId) {
      setUseFallback(true);
      return;
    }
    initCornerstone(viewerRef.current, `wadouri:${imageId}`).then((handle) => {
      if (cancelled) {
        handle?.destroy();
        return;
      }
      if (handle) {
        handleRef.current = handle;
        handle.setWindowLevel(ww, wc);
      } else {
        setUseFallback(true);
      }
    });
    return () => {
      cancelled = true;
      handleRef.current?.destroy();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId, hasInstances]);

  // Apply window/level changes to whichever renderer is active.
  useEffect(() => {
    if (handleRef.current) {
      handleRef.current.setWindowLevel(ww, wc);
    } else if (useFallback && canvasRef.current) {
      drawPlaceholder(canvasRef.current, ww, wc);
    }
  }, [ww, wc, useFallback]);

  const runModel = (): void => {
    chestXray.mutate(
      { patientId, studyUid: study?.id },
      {
        onSuccess: (res) => {
          if (res.gradcamPng) setShowGradcam(true);
          toast({
            title: res.finding ? `${t("finding")}: ${res.finding}` : t("title"),
            variant: "success",
          });
        },
      },
    );
  };

  if (studies.isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (!study) {
    return (
      <div className="space-y-4">
        <EmptyState title={t("empty")} description={t("emptyDesc")} />
        {/* Controls remain wired even without a study, per spec. */}
        <ViewerControls
          ww={ww}
          wc={wc}
          wwId={wwId}
          wcId={wcId}
          opacityId={opacityId}
          gradcamOpacity={gradcamOpacity}
          showGradcam={showGradcam}
          onWw={setWw}
          onWc={setWc}
          onReset={() => {
            setWw(DEFAULT_WW);
            setWc(DEFAULT_WC);
          }}
          onToggleGradcam={setShowGradcam}
          onOpacity={setGradcamOpacity}
          gradcamReady={Boolean(chestXray.data?.gradcamPng)}
          analyzing={chestXray.isPending}
          onAnalyze={runModel}
          t={t}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr,18rem]">
      <div className="relative aspect-square w-full max-w-xl overflow-hidden rounded-lg border border-border bg-black">
        {/* Cornerstone target */}
        <div ref={viewerRef} className="absolute inset-0 h-full w-full" aria-hidden={useFallback} />
        {/* Fallback synthetic render */}
        {useFallback ? (
          <canvas
            ref={canvasRef}
            width={512}
            height={512}
            className="absolute inset-0 h-full w-full"
            role="img"
            aria-label={t("viewerError")}
          />
        ) : null}
        {/* Grad-CAM overlay composited over the base image */}
        {showGradcam && chestXray.data?.gradcamPng ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt="Grad-CAM saliency overlay"
            src={`data:image/png;base64,${chestXray.data.gradcamPng}`}
            className="pointer-events-none absolute inset-0 h-full w-full mix-blend-screen"
            style={{ opacity: gradcamOpacity }}
          />
        ) : null}
      </div>

      <ViewerControls
        ww={ww}
        wc={wc}
        wwId={wwId}
        wcId={wcId}
        opacityId={opacityId}
        gradcamOpacity={gradcamOpacity}
        showGradcam={showGradcam}
        onWw={setWw}
        onWc={setWc}
        onReset={() => {
          setWw(DEFAULT_WW);
          setWc(DEFAULT_WC);
        }}
        onToggleGradcam={setShowGradcam}
        onOpacity={setGradcamOpacity}
        gradcamReady={Boolean(chestXray.data?.gradcamPng)}
        analyzing={chestXray.isPending}
        onAnalyze={runModel}
        finding={chestXray.data?.finding}
        t={t}
      />
    </div>
  );
}

interface ViewerControlsProps {
  ww: number;
  wc: number;
  wwId: string;
  wcId: string;
  opacityId: string;
  gradcamOpacity: number;
  showGradcam: boolean;
  gradcamReady: boolean;
  analyzing: boolean;
  finding?: string;
  onWw: (v: number) => void;
  onWc: (v: number) => void;
  onReset: () => void;
  onToggleGradcam: (v: boolean) => void;
  onOpacity: (v: number) => void;
  onAnalyze: () => void;
  t: (key: string) => string;
}

function ViewerControls({
  ww,
  wc,
  wwId,
  wcId,
  opacityId,
  gradcamOpacity,
  showGradcam,
  gradcamReady,
  analyzing,
  finding,
  onWw,
  onWc,
  onReset,
  onToggleGradcam,
  onOpacity,
  onAnalyze,
  t,
}: ViewerControlsProps): JSX.Element {
  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="space-y-2">
        <label htmlFor={wwId} className="flex items-center justify-between text-sm font-medium">
          {t("windowWidth")}
          <span className="font-mono text-xs text-muted-foreground">{ww}</span>
        </label>
        <input
          id={wwId}
          type="range"
          min={1}
          max={4096}
          value={ww}
          onChange={(e) => onWw(Number(e.target.value))}
          className="w-full accent-[hsl(var(--primary))]"
        />
      </div>
      <div className="space-y-2">
        <label htmlFor={wcId} className="flex items-center justify-between text-sm font-medium">
          {t("windowCenter")}
          <span className="font-mono text-xs text-muted-foreground">{wc}</span>
        </label>
        <input
          id={wcId}
          type="range"
          min={-1024}
          max={3072}
          value={wc}
          onChange={(e) => onWc(Number(e.target.value))}
          className="w-full accent-[hsl(var(--primary))]"
        />
      </div>
      <Button variant="outline" size="sm" onClick={onReset} className="w-full">
        {t("reset")}
      </Button>

      <div className="border-t border-border pt-4">
        <Button onClick={onAnalyze} loading={analyzing} className="w-full">
          {analyzing ? t("analyzing") : t("analyze")}
        </Button>
        {finding ? (
          <p className="mt-2 text-sm">
            <span className="text-muted-foreground">{t("finding")}: </span>
            <span className="font-medium">{finding}</span>
          </p>
        ) : null}

        <div className="mt-4 space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={showGradcam}
              disabled={!gradcamReady}
              onChange={(e) => onToggleGradcam(e.target.checked)}
              className="h-4 w-4 accent-[hsl(var(--primary))]"
            />
            {t("gradcam")}
          </label>
          {!gradcamReady ? (
            <p className="text-xs text-muted-foreground">{t("noHeatmap")}</p>
          ) : null}
          <label htmlFor={opacityId} className="flex items-center justify-between text-sm">
            {t("gradcamOpacity")}
            <span className="font-mono text-xs text-muted-foreground">
              {Math.round(gradcamOpacity * 100)}%
            </span>
          </label>
          <input
            id={opacityId}
            type="range"
            min={0}
            max={100}
            value={Math.round(gradcamOpacity * 100)}
            onChange={(e) => onOpacity(Number(e.target.value) / 100)}
            disabled={!gradcamReady || !showGradcam}
            className="w-full accent-[hsl(var(--primary))]"
          />
        </div>
      </div>
    </div>
  );
}
