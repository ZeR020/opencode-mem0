import { describe, it, expect } from "vitest";
import { UserProfileValidator } from "../src/services/ai/validators/user-profile-validator.js";

describe("UserProfileValidator", () => {
  describe("validate", () => {
    it("rejects null data", () => {
      const result = UserProfileValidator.validate(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Response is not an object");
    });

    it("rejects undefined data", () => {
      const result = UserProfileValidator.validate(undefined);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Response is not an object");
    });

    it("rejects array data", () => {
      const result = UserProfileValidator.validate([]);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Response cannot be an array");
    });

    it("rejects empty object", () => {
      const result = UserProfileValidator.validate({});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Response object is empty");
    });

    it("rejects object with null fields", () => {
      const result = UserProfileValidator.validate({ a: null, b: undefined });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Field 'a' is null or undefined");
      expect(result.errors).toContain("Field 'b' is null or undefined");
    });

    it("validates basic object without profile fields", () => {
      const result = UserProfileValidator.validate({ foo: "bar" });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.data).toEqual({ foo: "bar" });
    });

    it("validates preferences array", () => {
      const result = UserProfileValidator.validate({
        preferences: [
          { category: "style", description: "Concise", confidence: 0.9, evidence: ["e1"] },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it("rejects non-array preferences", () => {
      const result = UserProfileValidator.validate({ preferences: "string" });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("preferences must be an array");
    });

    it("rejects preference without category", () => {
      const result = UserProfileValidator.validate({
        preferences: [{ description: "test", confidence: 0.5, evidence: ["e"] }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("category is missing or invalid");
    });

    it("rejects preference without description", () => {
      const result = UserProfileValidator.validate({
        preferences: [{ category: "test", confidence: 0.5, evidence: ["e"] }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("description is missing or invalid");
    });

    it("rejects preference without numeric confidence", () => {
      const result = UserProfileValidator.validate({
        preferences: [
          { category: "test", description: "desc", confidence: "high", evidence: ["e"] },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("confidence is missing or invalid");
    });

    it("rejects preference without evidence array", () => {
      const result = UserProfileValidator.validate({
        preferences: [{ category: "test", description: "desc", confidence: 0.5 }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("evidence must be an array");
    });

    it("rejects preference with empty evidence", () => {
      const result = UserProfileValidator.validate({
        preferences: [{ category: "test", description: "desc", confidence: 0.5, evidence: [] }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("evidence cannot be empty");
    });

    it("validates patterns array", () => {
      const result = UserProfileValidator.validate({
        patterns: [{ category: "domain", description: "Backend" }],
      });
      expect(result.valid).toBe(true);
    });

    it("rejects non-array patterns", () => {
      const result = UserProfileValidator.validate({ patterns: "string" });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("patterns must be an array");
    });

    it("rejects pattern without category", () => {
      const result = UserProfileValidator.validate({
        patterns: [{ description: "test" }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("category is missing or invalid");
    });

    it("rejects pattern without description", () => {
      const result = UserProfileValidator.validate({
        patterns: [{ category: "test" }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("description is missing or invalid");
    });

    it("validates workflows array", () => {
      const result = UserProfileValidator.validate({
        workflows: [{ description: "TDD", steps: ["write test", "implement"] }],
      });
      expect(result.valid).toBe(true);
    });

    it("rejects non-array workflows", () => {
      const result = UserProfileValidator.validate({ workflows: "string" });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("workflows must be an array");
    });

    it("rejects workflow without description", () => {
      const result = UserProfileValidator.validate({
        workflows: [{ steps: ["s1"] }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("description is missing or invalid");
    });

    it("rejects workflow without steps array", () => {
      const result = UserProfileValidator.validate({
        workflows: [{ description: "test" }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("steps must be an array");
    });

    it("rejects workflow with empty steps", () => {
      const result = UserProfileValidator.validate({
        workflows: [{ description: "test", steps: [] }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("steps cannot be empty");
    });

    it("validates complete profile with all sections", () => {
      const result = UserProfileValidator.validate({
        preferences: [
          { category: "style", description: "Concise", confidence: 0.9, evidence: ["e1"] },
        ],
        patterns: [{ category: "domain", description: "Backend" }],
        workflows: [{ description: "TDD", steps: ["test", "code"] }],
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("reports multiple errors across sections", () => {
      const result = UserProfileValidator.validate({
        preferences: [{ category: "", description: "", confidence: "bad", evidence: null }],
        patterns: [{ category: "", description: "" }],
        workflows: [{ description: "", steps: null }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(3);
    });

    it("rejects primitive values in preference array", () => {
      const result = UserProfileValidator.validate({
        preferences: ["string"],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("is not an object");
    });
  });
});
