import { z } from "zod";
import type { UserProfileData } from "../../user-profile/types.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  data?: UserProfileData;
}

// ponytail: zod schema replaces 107 lines of hand-rolled type checks.
// Custom error messages preserve the ValidationResult contract callers rely on.
const preferenceSchema = z.object({
  category: z
    .string({ message: "category is missing or invalid" })
    .min(1, { message: "category is missing or invalid" }),
  description: z
    .string({ message: "description is missing or invalid" })
    .min(1, { message: "description is missing or invalid" }),
  confidence: z.number({ message: "confidence is missing or invalid" }),
  evidence: z
    .array(z.string(), { message: "evidence must be an array" })
    .nonempty({ message: "evidence cannot be empty" }),
});

const patternSchema = z.object({
  category: z
    .string({ message: "category is missing or invalid" })
    .min(1, { message: "category is missing or invalid" }),
  description: z
    .string({ message: "description is missing or invalid" })
    .min(1, { message: "description is missing or invalid" }),
});

const workflowSchema = z.object({
  description: z
    .string({ message: "description is missing or invalid" })
    .min(1, { message: "description is missing or invalid" }),
  steps: z
    .array(z.string(), { message: "steps must be an array" })
    .nonempty({ message: "steps cannot be empty" }),
});

const profileSchema = z
  .object({
    preferences: z.array(preferenceSchema).optional(),
    patterns: z.array(patternSchema).optional(),
    workflows: z.array(workflowSchema).optional(),
  })
  .passthrough();

/**
 * Convert zod issues to the error-message format callers and tests expect.
 * `preferences[0].category is missing or invalid` / `preferences[0] is not an object`.
 */
function formatError(issue: z.ZodIssue): string {
  if (issue.path.length === 0) return issue.message;
  const [section, index, ...rest] = issue.path;
  if (typeof index === "number" && typeof section === "string") {
    // Array element that isn't an object: "preferences[0] is not an object"
    if (rest.length === 0 && issue.message.includes("expected object")) {
      return `${section}[${index}] is not an object`;
    }
    const field = rest.join(".");
    return `${section}[${index}]${field ? `.${field}` : ""} ${issue.message}`;
  }
  return issue.message;
}

export class UserProfileValidator {
  static validate(data: unknown): ValidationResult {
    if (data === null || data === undefined) {
      return { valid: false, errors: ["Response is not an object"] };
    }
    if (Array.isArray(data)) {
      return { valid: false, errors: ["Response cannot be an array"] };
    }
    if (typeof data !== "object") {
      return { valid: false, errors: ["Response is not an object"] };
    }

    const obj = data as Record<string, unknown>;
    if (Object.keys(obj).length === 0) {
      return { valid: false, errors: ["Response object is empty"] };
    }

    // Reject null/undefined field values at the root level
    const nullErrors: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) {
        nullErrors.push(`Field '${key}' is null or undefined`);
      }
    }
    if (nullErrors.length > 0) {
      return { valid: false, errors: nullErrors };
    }

    // Validate section arrays with custom messages
    const errors: string[] = [];
    for (const section of ["preferences", "patterns", "workflows"] as const) {
      const value = obj[section];
      if (value !== undefined && !Array.isArray(value)) {
        errors.push(`${section} must be an array`);
      }
    }

    const result = profileSchema.safeParse(data);
    if (!result.success) {
      errors.push(...result.error.issues.map(formatError));
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }
    return { valid: true, errors: [], data: result.data as unknown as UserProfileData };
  }
}
