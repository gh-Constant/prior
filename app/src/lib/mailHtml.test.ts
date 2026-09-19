import { describe, expect, it } from "vitest";
import { sanitizeMailHtml } from "./mailHtml";

describe("sanitizeMailHtml", () => {
  it("strips scripts, iframes and event handlers", () => {
    const out = sanitizeMailHtml(
      `<div onclick="steal()"><script>alert(1)</script><p>Hello</p><iframe src="https://evil.example"></iframe></div>`,
    );
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<iframe");
    expect(out).not.toContain("onclick");
    expect(out).toContain("<p>Hello</p>");
  });

  it("neutralizes javascript: URLs but keeps https links", () => {
    const out = sanitizeMailHtml(
      `<a href="javascript:alert(1)">bad</a><a href="https://example.com/x">good</a>`,
    );
    expect(out).not.toContain("javascript:");
    expect(out).toContain('href="https://example.com/x"');
    expect(out).toContain('target="_blank"');
  });

  it("keeps inline images and layout styles without expressions", () => {
    const out = sanitizeMailHtml(
      `<img src="data:image/png;base64,AAA" style="color: red; width: 10px"><span style="color: expression(alert(1))">x</span>`,
    );
    expect(out).toContain("data:image/png");
    expect(out).toContain("color: red");
    expect(out).not.toContain("expression(");
  });

  it("returns empty string for empty or unparseable input", () => {
    expect(sanitizeMailHtml("")).toBe("");
  });
});
