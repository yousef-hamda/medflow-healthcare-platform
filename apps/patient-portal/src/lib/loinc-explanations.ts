/**
 * Plain-language explanations for ~20 common LOINC lab codes.
 *
 * `short` is a concise human-friendly test name; `plain` explains what the test
 * measures in everyday language. These are educational summaries only.
 */
export interface LoincExplanation {
  /** LOINC code. */
  code: string;
  /** Short human name, e.g. "Creatinine". */
  short: string;
  /** Friendly, plain-language explanation of what the test measures. */
  plain: string;
}

export const LOINC_EXPLANATIONS: Readonly<Record<string, LoincExplanation>> = {
  "2160-0": {
    code: "2160-0",
    short: "Creatinine",
    plain: "A waste product your kidneys filter out of your blood. It helps show how well your kidneys are working.",
  },
  "718-7": {
    code: "718-7",
    short: "Hemoglobin",
    plain: "The protein in red blood cells that carries oxygen around your body. Low levels can mean anemia.",
  },
  "4548-4": {
    code: "4548-4",
    short: "Hemoglobin A1c",
    plain: "Your average blood sugar over the past two to three months. It's used to monitor diabetes.",
  },
  "2345-7": {
    code: "2345-7",
    short: "Glucose",
    plain: "The amount of sugar in your blood right now. It's your body's main source of energy.",
  },
  "2951-2": {
    code: "2951-2",
    short: "Sodium",
    plain: "A mineral and electrolyte that helps balance fluids and supports nerve and muscle function.",
  },
  "2823-3": {
    code: "2823-3",
    short: "Potassium",
    plain: "An electrolyte important for your heart rhythm and muscle function. Both high and low levels matter.",
  },
  "33914-3": {
    code: "33914-3",
    short: "Estimated GFR (eGFR)",
    plain: "An estimate of how much blood your kidneys clean each minute. Higher numbers generally mean better kidney function.",
  },
  "1742-6": {
    code: "1742-6",
    short: "ALT (liver enzyme)",
    plain: "An enzyme found mainly in the liver. Higher levels can be a sign the liver is irritated or inflamed.",
  },
  "1920-8": {
    code: "1920-8",
    short: "AST (liver enzyme)",
    plain: "An enzyme found in the liver and muscles. Along with ALT, it helps check on liver health.",
  },
  "2093-3": {
    code: "2093-3",
    short: "Total cholesterol",
    plain: "A fatty substance in your blood. Tracking it helps estimate your risk of heart disease.",
  },
  "2085-9": {
    code: "2085-9",
    short: "HDL cholesterol",
    plain: "The 'good' cholesterol that helps remove other cholesterol from your blood. Higher is usually better.",
  },
  "13457-7": {
    code: "13457-7",
    short: "LDL cholesterol (calculated)",
    plain: "The 'bad' cholesterol that can build up in your arteries. Lower levels are usually better for your heart.",
  },
  "2571-8": {
    code: "2571-8",
    short: "Triglycerides",
    plain: "A type of fat in your blood. High levels, especially with high cholesterol, can raise heart risk.",
  },
  "6690-2": {
    code: "6690-2",
    short: "White blood cell count",
    plain: "The number of infection-fighting cells in your blood. Changes can signal infection or inflammation.",
  },
  "789-8": {
    code: "789-8",
    short: "Red blood cell count",
    plain: "The number of cells that carry oxygen in your blood. It's part of a complete blood count.",
  },
  "777-3": {
    code: "777-3",
    short: "Platelet count",
    plain: "Tiny cells that help your blood clot and stop bleeding. Too few or too many can cause problems.",
  },
  "4544-3": {
    code: "4544-3",
    short: "Hematocrit",
    plain: "The percentage of your blood made up of red blood cells. Low values can point to anemia.",
  },
  "1975-2": {
    code: "1975-2",
    short: "Bilirubin (total)",
    plain: "A yellow substance made when red blood cells break down. High levels can relate to the liver or gallbladder.",
  },
  "2532-0": {
    code: "2532-0",
    short: "LDH",
    plain: "An enzyme found in many tissues. Raised levels can be a general sign of cell or tissue damage.",
  },
  "3094-0": {
    code: "3094-0",
    short: "BUN (blood urea nitrogen)",
    plain: "A waste product filtered by your kidneys. Along with creatinine, it helps check kidney function and hydration.",
  },
};

/**
 * Returns the plain-language explanation for a LOINC code, or `undefined` if we
 * don't have one on file.
 */
export function explainLoinc(code: string | undefined | null): LoincExplanation | undefined {
  if (!code) return undefined;
  return LOINC_EXPLANATIONS[code.trim()];
}
