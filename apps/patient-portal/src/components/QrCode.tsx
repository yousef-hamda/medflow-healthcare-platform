"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * Renders a QR code for the given value as an <img>. Generation happens only in
 * a client effect (qrcode is browser-safe but we keep it off the server path).
 */
export function QrCode({ value, size = 192, alt }: { value: string; size?: number; alt: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    setDataUrl(null);
    QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (error) {
    return (
      <div className="grid place-items-center rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground" style={{ width: size, height: size }}>
        QR unavailable
      </div>
    );
  }

  if (!dataUrl) {
    return <div className="animate-pulse rounded-lg bg-muted" style={{ width: size, height: size }} aria-hidden="true" />;
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={dataUrl} alt={alt} width={size} height={size} className="rounded-lg border border-border bg-white p-2" />;
}
