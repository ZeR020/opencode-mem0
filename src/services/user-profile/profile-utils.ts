const parseJSON = (value: string): any => {
  try {
    return JSON.parse(value);
  } catch {
    try {
      return JSON.parse(value.trim().replace(/,$/, ""));
    } catch {
      return undefined;
    }
  }
};

export const safeArray = <T>(arr: any): T[] => {
  if (!arr) return [];
  const result = typeof arr === "string" ? parseJSON(arr) : arr;
  if (!Array.isArray(result)) return [];
  return result.flat(Infinity).filter((item: any) => item !== undefined && item !== null) as T[];
};

export const safeObject = <T extends object>(obj: any, fallback: T): T => {
  if (!obj) return fallback;
  const result = typeof obj === "string" ? parseJSON(obj) : obj;
  if (result && typeof result === "object" && !Array.isArray(result)) return result as T;
  return fallback;
};
