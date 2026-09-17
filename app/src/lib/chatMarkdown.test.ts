import { describe, expect, it } from "vitest";
import { renderChatMarkdown } from "./chatMarkdown";

describe("renderChatMarkdown", () => {
  it("renders bold, italic and strikethrough", () => {
    expect(renderChatMarkdown("**list_tasks** and *habits*")).toBe(
      "<p><strong>list_tasks</strong> and <em>habits</em></p>",
    );
    expect(renderChatMarkdown("__strong__ and ~~gone~~")).toBe(
      "<p><strong>strong</strong> and <del>gone</del></p>",
    );
  });

  it("renders code spans without inner formatting", () => {
    expect(renderChatMarkdown("call `**not-bold**` now")).toBe(
      "<p>call <code>**not-bold**</code> now</p>",
    );
  });

  it("renders fenced code blocks with escaped content", () => {
    const html = renderChatMarkdown("```js\nconst a = 1 < 2;\n```");
    expect(html).toBe('<pre class="chat-code" data-language="js"><code>const a = 1 &lt; 2;</code></pre>');
  });

  it("escapes raw HTML to prevent XSS", () => {
    const html = renderChatMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("only allows safe link targets", () => {
    expect(renderChatMarkdown("[ok](https://example.com)")).toContain('href="https://example.com"');
    const bad = renderChatMarkdown("[x](javascript:alert(1))");
    expect(bad).not.toContain("javascript:");
    expect(bad).not.toContain("<a");
  });

  it("renders lists, headings and quotes", () => {
    expect(renderChatMarkdown("- **a**\n- b")).toBe("<ul><li><strong>a</strong></li><li>b</li></ul>");
    expect(renderChatMarkdown("1. first\n2. second")).toBe("<ol><li>first</li><li>second</li></ol>");
    expect(renderChatMarkdown("## Title")).toBe("<h3>Title</h3>");
    expect(renderChatMarkdown("> quoted")).toBe("<blockquote>quoted</blockquote>");
  });

  it("marks inline and display math for KaTeX hydration", () => {
    expect(renderChatMarkdown("value $x^2$ here")).toContain('<span class="chat-math">x^2</span>');
    expect(renderChatMarkdown("$$\\frac{a}{b}$$")).toContain('<span class="chat-math chat-math-display">\\frac{a}{b}</span>');
  });
});
