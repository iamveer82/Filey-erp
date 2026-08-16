// Just enough markdown for what an LLM actually writes: headings, bullets,
// numbered lists, bold/italic/code, fenced code, block quotes, rules, links.
//
// Deliberately not a library. react-markdown brings a remark/unified tree for
// a feature set this app never shows, and the repo already keeps its
// dependency list short on purpose. Deliberately not dangerouslySetInnerHTML
// either: this renders model output, which is downstream of tool results and
// therefore of other people's data. Building React nodes means a reply can
// never inject markup, no sanitiser to keep correct.
//
// ponytail: no tables, no images, no nested lists. Add them when a reply
// actually needs one — every rule here is one the agent's replies hit daily.
import { Fragment, type ReactNode } from "react";

/** `**bold**`, `*italic*`, `` `code` ``, [text](url) — applied in one pass so
 *  the earliest match wins and markers inside code stay literal. */
const INLINE =
  /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|(?<![*\w])\*[^*\n]+\*(?!\*))/g;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const tok = m[0];
    const key = `${keyBase}-i${i++}`;
    if (tok.startsWith("**") || tok.startsWith("__")) {
      out.push(
        <strong key={key} className="font-semibold text-foreground">
          {tok.slice(2, -2)}
        </strong>
      );
    } else if (tok.startsWith("`")) {
      out.push(
        <code
          key={key}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.92em] text-foreground"
        >
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("[")) {
      const cut = tok.indexOf("](");
      const href = tok.slice(cut + 2, -1);
      // http(s) only: a model is perfectly capable of writing javascript: into
      // a link, and this text is not always the model's own words.
      const safe = /^https?:\/\//i.test(href);
      out.push(
        safe ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 hover:text-foreground"
          >
            {tok.slice(1, cut)}
          </a>
        ) : (
          <Fragment key={key}>{tok.slice(1, cut)}</Fragment>
        )
      );
    } else {
      out.push(
        <em key={key} className="italic">
          {tok.slice(1, -1)}
        </em>
      );
    }
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^(#{1,4})\s+(.*)$/;

export default function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code — everything until the closing fence stays verbatim.
    if (line.trimStart().startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        body.push(lines[i]);
        i++;
      }
      i++; // closing fence (or EOF mid-stream, which is fine)
      blocks.push(
        <pre
          key={key++}
          className="my-2 overflow-x-auto rounded-lg border border-border bg-muted p-3 font-mono text-[12px] leading-relaxed text-foreground"
        >
          <code>{body.join("\n")}</code>
        </pre>
      );
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="my-3 border-border" />);
      i++;
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      const level = h[1].length;
      blocks.push(
        <p
          key={key++}
          className={
            level <= 2
              ? "mb-1 mt-3 text-[14px] font-semibold text-foreground first:mt-0"
              : "mb-1 mt-2.5 text-[13px] font-semibold text-foreground first:mt-0"
          }
        >
          {inline(h[2], `h${key}`)}
        </p>
      );
      i++;
      continue;
    }

    if (line.trimStart().startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith(">")) {
        body.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote
          key={key++}
          className="my-2 border-l-2 border-border pl-3 text-muted-foreground"
        >
          {inline(body.join(" "), `q${key}`)}
        </blockquote>
      );
      continue;
    }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = !BULLET.test(line) && NUMBERED.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && (BULLET.test(lines[i]) || NUMBERED.test(lines[i]))) {
        const m = BULLET.exec(lines[i]) ?? NUMBERED.exec(lines[i]);
        const body = m ? (m.length === 2 ? m[1] : m[2]) : lines[i];
        items.push(<li key={items.length}>{inline(body, `l${key}-${items.length}`)}</li>);
        i++;
      }
      blocks.push(
        ordered ? (
          <ol key={key++} className="my-1.5 list-decimal space-y-1 pl-5 marker:text-muted-foreground">
            {items}
          </ol>
        ) : (
          <ul key={key++} className="my-1.5 list-disc space-y-1 pl-5 marker:text-muted-foreground">
            {items}
          </ul>
        )
      );
      continue;
    }

    // Paragraph: consecutive plain lines, single newlines preserved as breaks.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trimStart().startsWith("```") &&
      !lines[i].trimStart().startsWith(">") &&
      !HEADING.test(lines[i]) &&
      !BULLET.test(lines[i]) &&
      !NUMBERED.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="my-1.5 whitespace-pre-wrap first:mt-0 last:mb-0">
        {inline(para.join("\n"), `p${key}`)}
      </p>
    );
  }

  return <>{blocks}</>;
}
