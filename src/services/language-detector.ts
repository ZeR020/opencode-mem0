import { franc } from "franc-min";

const FALLBACK_MAP: Record<string, string> = {
  cmn: "zh",
  yue: "zh",
  arz: "ar",
  hbs: "sr",
};

const normalizeDetectedLanguage = (code: string): string => {
  const mapped = FALLBACK_MAP[code];
  if (mapped) return mapped;

  try {
    const language = new Intl.Locale(code).language;
    return language.length === 2 ? language : "en";
  } catch {
    return "en";
  }
};

// ponytail: Intl APIs avoid bundling a full language-code dataset for display names.
// DisplayNames accepts both ISO 639-1 (2-letter) and many ISO 639-3 (3-letter) codes.
const displayNames = new Intl.DisplayNames(["en"], { type: "language", fallback: "code" });

/**
 * Detect the likely language of user text for auto-capture prompts.
 *
 * @param text - User-authored text to classify.
 * @returns A two-letter language code when available, otherwise `"en"`.
 */
export function detectLanguage(text: string): string {
  if (!text || !text.trim()) return "en";
  const detected = franc(text, { minLength: 5 });
  return detected === "und" ? "en" : normalizeDetectedLanguage(detected);
}

/**
 * Resolve a language code to an English display name.
 *
 * @param code - ISO language code, including common two- or three-letter codes.
 * @returns English display name, or `"English"` when the code is empty or unknown.
 */
export function getLanguageName(code: string): string {
  if (!code) return "English";
  try {
    const name = displayNames.of(code);
    // Unknown codes fall back to themselves with fallback:'code'; map to English.
    return name && name !== code ? name : "English";
  } catch {
    return "English";
  }
}
