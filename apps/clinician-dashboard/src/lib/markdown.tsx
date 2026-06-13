import { Fragment, type ReactNode } from "react";

/**
 * Minimal, safe markdown renderer for model cards. Supports ATX headings
 * (#..###), unordered lists (-/*), bold (**x**), inline code (`x`), and
 * paragraphs. No raw HTML is ever interpreted, so it is XSS-safe by construction.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  // Tokenize on **bold** and `code` while leaving the rest as plain text.
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return tokens
    .filter((t) => t.length > 0)
    .map((token, i) => {
      const key = `${keyPrefix}-${i}`;
      if (token.startsWith("**") && token.endsWith("**")) {
        return (
          <strong key={key} className="font-semibold">
            {token.slice(2, -2)}
          </strong>
        );
      }
      if (token.startsWith("`") && token.endsWith("`")) {
        return (
          <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            {token.slice(1, -1)}
          </code>
        );
      }
      return <Fragment key={key}>{token}</Fragment>;
    });
}

export function renderMarkdown(markdown: string): ReactNode {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];
  let paragraph: string[] = [];
  let key = 0;

  const flushParagraph = (): void => {
    if (paragraph.length) {
      const text = paragraph.join(" ");
      blocks.push(
        <p key={`p-${key++}`} className="text-sm leading-relaxed text-foreground">
          {renderInline(text, `p${key}`)}
        </p>,
      );
      paragraph = [];
    }
  };

  const flushList = (): void => {
    if (listItems.length) {
      blocks.push(
        <ul key={`ul-${key++}`} className="ms-5 list-disc space-y-1 text-sm text-foreground">
          {listItems.map((item, i) => (
            <li key={`li-${key}-${i}`}>{renderInline(item, `li${key}${i}`)}</li>
          ))}
        </ul>,
      );
      listItems = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const listItem = /^[-*]\s+(.*)$/.exec(line);

    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1]?.length ?? 1;
      const content = heading[2] ?? "";
      const cls =
        level === 1
          ? "text-lg font-semibold"
          : level === 2
            ? "text-base font-semibold"
            : "text-sm font-semibold";
      blocks.push(
        <p key={`h-${key++}`} className={`${cls} text-foreground`} role="heading" aria-level={level}>
          {renderInline(content, `h${key}`)}
        </p>,
      );
    } else if (listItem) {
      flushParagraph();
      listItems.push(listItem[1] ?? "");
    } else if (line.trim() === "") {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();

  return <div className="space-y-3">{blocks}</div>;
}
