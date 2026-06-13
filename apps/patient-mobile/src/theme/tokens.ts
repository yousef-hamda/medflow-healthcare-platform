/**
 * Design tokens — clinical teal/slate palette.
 * Mirrors tailwind.config.js; import these for non-className usages
 * (SVG charts, navigation theming, status bar).
 */

export const palette = {
  brand: {
    50: "#f0fdfa",
    100: "#ccfbf1",
    200: "#99f6e4",
    300: "#5eead4",
    400: "#2dd4bf",
    500: "#14b8a6",
    600: "#0d9488",
    700: "#0f766e",
    800: "#115e59",
    900: "#134e4a",
  },
  ink: {
    50: "#f8fafc",
    100: "#f1f5f9",
    200: "#e2e8f0",
    300: "#cbd5e1",
    400: "#94a3b8",
    500: "#64748b",
    600: "#475569",
    700: "#334155",
    800: "#1e293b",
    900: "#0f172a",
    950: "#020617",
  },
  clinical: {
    success: "#059669",
    warning: "#d97706",
    danger: "#dc2626",
    info: "#0284c7",
  },
} as const;

export const chartColors = {
  line: palette.brand[600],
  lineSecondary: palette.clinical.info,
  area: palette.brand[500],
  grid: palette.ink[200],
  gridDark: palette.ink[700],
  dot: palette.brand[700],
} as const;
