import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../src/web/index.html", import.meta.url), "utf8");
const appJs = readFileSync(new URL("../src/web/app.js", import.meta.url), "utf8");

describe("web dashboard sanitizer loading", () => {
  it("defers app.js after DOMPurify", () => {
    expect(html).toContain('<script defer src="/vendor/dompurify.min.js"></script>');
    expect(html).toContain('<script defer src="/app.js"></script>');
    expect(html.indexOf("/vendor/dompurify.min.js")).toBeLessThan(html.indexOf('src="/app.js"'));
  });

  it("sanitizeHtml fails closed when DOMPurify is missing", () => {
    expect(appJs).toContain("window.DOMPurify ? DOMPurify.sanitize(html) : esc(html)");
    expect(appJs).not.toMatch(/DOMPurify\.sanitize\(html\) : html/);
  });
});
