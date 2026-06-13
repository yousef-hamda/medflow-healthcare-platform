#!/usr/bin/env node
/**
 * Capture REAL screenshots + a screen-recording video of the running MedFlow apps.
 *
 * This replaces the representative mockups in docs/images/ with genuine captures of
 * the live UI. Run it AFTER the stack is up and seeded:
 *
 *   make dev
 *   make seed-patients N=500
 *   make sim-vitals            # so a sepsis alert is live for the patient view
 *   node scripts/capture_screens.mjs
 *
 * Requirements (one-time):
 *   npm i -D playwright && npx playwright install chromium
 *   # optional, for the MP4: ffmpeg on PATH (brew install ffmpeg)
 *
 * Output:
 *   docs/images/01-clinician-worklist.png … 08-marquez-lineage.png   (retina PNGs)
 *   docs/images/captures/*.webm  (raw screen recordings)
 *   docs/images/demo.mp4         (stitched tour, if ffmpeg is present)
 *
 * Env overrides (defaults in parentheses):
 *   DASH_URL (http://localhost:3000)  PORTAL_URL (http://localhost:3001)
 *   SUPERSET_URL (http://localhost:8088)  MARQUEZ_URL (http://localhost:3003)
 *   PATIENT_ID (first patient on the worklist)  DEMO_USER / DEMO_PASS (demo creds)
 */
import { chromium } from "playwright";
import { mkdirSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs", "images");
const CAPS = path.join(OUT, "captures");
mkdirSync(CAPS, { recursive: true });

const cfg = {
  dash: process.env.DASH_URL || "http://localhost:3000",
  portal: process.env.PORTAL_URL || "http://localhost:3001",
  superset: process.env.SUPERSET_URL || "http://localhost:8088",
  marquez: process.env.MARQUEZ_URL || "http://localhost:3003",
  patientId: process.env.PATIENT_ID || "",
  user: process.env.DEMO_USER || "demo.clinician",
  pass: process.env.DEMO_PASS || "demo",
};

// Retina viewport so PNGs are crisp.
const VIEWPORT = { width: 1440, height: 900 };
const SCALE = 2;

/** Best-effort standalone login; silently continues if the page is already open. */
async function login(page, baseUrl) {
  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle", timeout: 15000 });
    const user = page.locator('input[name="username"], input[type="email"], #username').first();
    if (await user.isVisible({ timeout: 3000 }).catch(() => false)) {
      await user.fill(cfg.user);
      await page.locator('input[type="password"]').first().fill(cfg.pass);
      await page.locator('button[type="submit"], button:has-text("Sign in")').first().click();
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    }
  } catch {
    /* no login page / already authenticated — keep going */
  }
}

async function shot(page, url, file, { wait = 1500, full = false } = {}) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(wait);
  const out = path.join(OUT, file);
  await page.screenshot({ path: out, fullPage: full });
  console.log("  📸", file);
}

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    colorScheme: "dark",
    recordVideo: { dir: CAPS, size: { width: VIEWPORT.width, height: VIEWPORT.height } },
  });
  const page = await context.newPage();

  console.log("→ Clinician dashboard");
  await login(page, cfg.dash);
  await shot(page, `${cfg.dash}/worklist`, "01-clinician-worklist.png");

  // Resolve a patient id from the worklist if none was supplied.
  let pid = cfg.patientId;
  if (!pid) {
    pid = await page
      .locator('a[href*="/patient/"]').first()
      .getAttribute("href").then((h) => (h ? h.split("/patient/")[1].split(/[/?#]/)[0] : ""))
      .catch(() => "");
  }
  if (pid) {
    await shot(page, `${cfg.dash}/patient/${pid}`, "02-patient-sepsis-detail.png", { wait: 2500 });
    await shot(page, `${cfg.dash}/patient/${pid}?tab=imaging`, "03-dicom-gradcam.png", { wait: 3000 });
    await shot(page, `${cfg.dash}/patient/${pid}/cohort`, "04-cohort-builder-trino.png", { wait: 2000 });
  } else {
    console.warn("  ! no patient found on the worklist — is the stack seeded? (make seed-patients)");
  }
  await shot(page, `${cfg.dash}/admin/audit`, "05-audit-explorer.png");

  console.log("→ Patient portal");
  await login(page, cfg.portal);
  await shot(page, `${cfg.portal}/me/share`, "06-patient-portal-disclosures.png");

  console.log("→ Analytics & lineage");
  await shot(page, cfg.superset, "07-superset-dashboard.png", { wait: 2500 });
  await shot(page, cfg.marquez, "08-marquez-lineage.png", { wait: 2500 });

  await context.close(); // flushes the .webm recording
  await browser.close();
  console.log("✓ screenshots written to docs/images/");

  // Optional: stitch the recordings into a single MP4 tour if ffmpeg is available.
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    const vids = readdirSync(CAPS).filter((f) => f.endsWith(".webm")).sort();
    if (vids.length) {
      const listFile = path.join(CAPS, "concat.txt");
      const list = vids.map((v) => `file '${path.join(CAPS, v)}'`).join("\n");
      const { writeFileSync } = await import("node:fs");
      writeFileSync(listFile, list);
      execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile,
        "-vf", "scale=1280:-2:flags=lanczos", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-crf", "23", "-movflags", "+faststart", path.join(OUT, "demo.mp4")], { stdio: "inherit" });
      console.log("✓ docs/images/demo.mp4");
    }
  } catch {
    console.log("ℹ ffmpeg not found — skipped MP4 (the per-screen .webm recordings are in docs/images/captures/)");
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
