import { Fragment } from "react";

/**
 * An agent's reply, rendered.
 *
 * The models emit markdown whether or not they are asked not to, and raw
 * "**like this**" on screen reads worse than either plain text or real bold.
 * The prompts ask for plain short sentences; this makes the page correct even
 * when a model ignores that, which eventually it will.
 *
 * Deliberately tiny: bold, bullets, and tight spacing. Not a markdown parser —
 * headings and emphasis are stripped to plain text rather than rendered, since
 * a chat reply with an <h2> in it is the formatting problem, not the fix.
 */

function inline(text: string, keyBase: string) {
  // **bold** and *emphasis* — bold renders, single asterisks are just noise
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={`${keyBase}-${i}`} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <Fragment key={`${keyBase}-${i}`}>{part.replace(/\*/g, "")}</Fragment>;
  });
}

interface Chunk {
  kind: "text" | "list";
  lines: string[];
}

function chunk(content: string): Chunk[] {
  const out: Chunk[] = [];

  for (const raw of content.split("\n")) {
    const line = raw.replace(/^#{1,6}\s+/, "").trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const item = bullet?.[1] ?? numbered?.[1];

    if (item !== undefined) {
      const last = out[out.length - 1];
      if (last?.kind === "list") last.lines.push(item);
      else out.push({ kind: "list", lines: [item] });
      continue;
    }

    if (line.trim() === "") {
      const last = out[out.length - 1];
      // one blank line between paragraphs, never a run of them
      if (last?.kind === "text" && last.lines[last.lines.length - 1] !== "") last.lines.push("");
      continue;
    }

    const last = out[out.length - 1];
    if (last?.kind === "text") last.lines.push(line);
    else out.push({ kind: "text", lines: [line] });
  }

  return out;
}

export function Reply({ content }: { content: string }) {
  const chunks = chunk(content);

  return (
    <div className="space-y-2.5 text-sm leading-7">
      {chunks.map((c, i) =>
        c.kind === "list" ? (
          <ul key={i} className="space-y-1">
            {c.lines.map((line, j) => (
              <li key={j} className="flex gap-2">
                <span className="dim select-none">·</span>
                <span className="min-w-0 flex-1">{inline(line, `${i}-${j}`)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className="whitespace-pre-wrap">
            {inline(c.lines.join("\n").trim(), String(i))}
          </p>
        ),
      )}
    </div>
  );
}
