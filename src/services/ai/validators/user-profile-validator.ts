import type { UserProfileData } from "../../user-profile/types.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  data?: UserProfileData;
}

export class UserProfileValidator {
  static validate(data: any): ValidationResult {
    const errors: string[] = [];
    if (!data || typeof data !== "object") {
      return { valid: false, errors: ["Response is not an object"] };
    }
    if (Array.isArray(data)) {
      return { valid: false, errors: ["Response cannot be an array"] };
    }
    const keys = Object.keys(data);
    if (keys.length === 0) {
      return { valid: false, errors: ["Response object is empty"] };
    }
    for (const key of keys) {
      if (data[key] === undefined || data[key] === null) {
        errors.push(`Field '${key}' is null or undefined`);
      }
    }
    if (errors.length > 0) {
      return { valid: false, errors };
    }
    const sections: Array<{ key: string; validator: (data: any) => string[] }> = [
      { key: "preferences", validator: (d) => this.validatePreferences(d) },
      { key: "patterns", validator: (d) => this.validatePatterns(d) },
      { key: "workflows", validator: (d) => this.validateWorkflows(d) },
    ];
    for (const { key, validator } of sections) {
      if (Object.hasOwn(data, key)) errors.push(...validator(data[key]));
    }
    if (errors.length > 0) {
      return { valid: false, errors };
    }
    return { valid: true, errors: [], data: data as UserProfileData };
  }

  private static validateArraySection(
    section: any,
    sectionName: string,
    fieldChecks: Array<{
      field: string;
      type: "string" | "number" | "array";
      required?: boolean;
      cannotBeEmpty?: boolean;
    }>
  ): string[] {
    if (!Array.isArray(section)) return [`${sectionName} must be an array`];
    const errors: string[] = [];
    for (let i = 0; i < section.length; i++) {
      const item = section[i];
      if (!item || typeof item !== "object") {
        errors.push(`${sectionName}[${i}] is not an object`);
        continue;
      }
      for (const check of fieldChecks) {
        const value = item[check.field];
        if (check.type === "string") {
          if (!value || typeof value !== "string") {
            errors.push(`${sectionName}[${i}].${check.field} is missing or invalid`);
          }
        } else if (check.type === "number") {
          if (typeof value !== "number") {
            errors.push(`${sectionName}[${i}].${check.field} is missing or invalid`);
          }
        } else if (check.type === "array") {
          if (!Array.isArray(value)) {
            errors.push(`${sectionName}[${i}].${check.field} must be an array`);
          } else if (check.cannotBeEmpty && value.length === 0) {
            errors.push(`${sectionName}[${i}].${check.field} cannot be empty`);
          }
        }
      }
    }
    return errors;
  }

  private static validatePreferences(preferences: any): string[] {
    return this.validateArraySection(preferences, "preferences", [
      { field: "category", type: "string" },
      { field: "description", type: "string" },
      { field: "confidence", type: "number" },
      { field: "evidence", type: "array", cannotBeEmpty: true },
    ]);
  }

  private static validatePatterns(patterns: any): string[] {
    return this.validateArraySection(patterns, "patterns", [
      { field: "category", type: "string" },
      { field: "description", type: "string" },
    ]);
  }

  private static validateWorkflows(workflows: any): string[] {
    return this.validateArraySection(workflows, "workflows", [
      { field: "description", type: "string" },
      { field: "steps", type: "array", cannotBeEmpty: true },
    ]);
  }
}
