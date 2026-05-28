import { franc } from "franc-min";
import { iso6393, iso6393To1 } from "iso-639-3";

type ISO6393Entry = { iso6391?: string; iso6393: string; name: string };

const FALLBACK_MAP: Record<string, string> = {
  cmn: "zh",
  yue: "zh",
  arz: "ar",
  hbs: "sr",
};

const nameByCode1 = new Map<string, string>();
const nameByCode3 = new Map<string, string>();
for (const entry of iso6393 as ISO6393Entry[]) {
  if (entry.iso6391) nameByCode1.set(entry.iso6391, entry.name);
  nameByCode3.set(entry.iso6393, entry.name);
}

export function detectLanguage(text: string): string {
  if (!text || !text.trim()) return "en";
  const detected = franc(text, { minLength: 5 });
  if (detected === "und") return "en";
  return iso6393To1[detected] ?? FALLBACK_MAP[detected] ?? "en";
}

export function getLanguageName(code: string): string {
  return nameByCode1.get(code) ?? nameByCode3.get(code) ?? "English";
}
