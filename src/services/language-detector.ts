import { franc } from "franc-min";
import { iso6393To1 } from "iso-639-3";

const FALLBACK_MAP: Record<string, string> = {
  cmn: "zh",
  yue: "zh",
  arz: "ar",
  hbs: "sr",
};

// ponytail: Intl.DisplayNames replaces the full iso-639-3 dataset (~9000 entries).
// Accepts both ISO 639-1 (2-letter) and 639-3 (3-letter) codes natively.
const displayNames = new Intl.DisplayNames(["en"], { type: "language", fallback: "code" });

export function detectLanguage(text: string): string {
  if (!text || !text.trim()) return "en";
  const detected = franc(text, { minLength: 5 });
  if (detected === "und") return "en";
  return iso6393To1[detected] ?? FALLBACK_MAP[detected] ?? "en";
}

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
