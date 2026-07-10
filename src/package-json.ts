import type { DepLocation, DepSection } from "./types";

const SECTIONS: DepSection[] = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

interface Offset {
  col: number;
  line: number;
}

// Locates each dependency's version-string value in the raw package.json text
// so callers can decorate the exact `"^1.2.3"` range. Uses a tolerant scan
// rather than JSON.parse so it still works while the user is mid-edit.
export function findDependencyLocations(text: string): DepLocation[] {
  const locations: DepLocation[] = [];

  for (const section of SECTIONS) {
    const block = findSectionBlock(text, section);
    if (block === null) {
      continue;
    }

    const entryRe = /"((?:[^"\\]|\\.)+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let match: RegExpExecArray | null = entryRe.exec(block.body);
    while (match !== null) {
      const name = match[1] as string;
      const declaredRange = match[2] as string;
      const valueQuoteOffset =
        block.start + match.index + match[0].lastIndexOf(`"${declaredRange}"`);
      const start = toOffset(text, valueQuoteOffset);
      const end = toOffset(text, valueQuoteOffset + declaredRange.length + 2);

      locations.push({
        declaredRange,
        name,
        section,
        valueEndCol: end.col,
        valueEndLine: end.line,
        valueStartCol: start.col,
        valueStartLine: start.line,
      });
      match = entryRe.exec(block.body);
    }
  }

  return locations;
}

function findSectionBlock(
  text: string,
  section: DepSection
): { start: number; body: string } | null {
  const keyRe = new RegExp(`"${section}"\\s*:\\s*\\{`);
  const keyMatch = keyRe.exec(text);
  if (keyMatch === null) {
    return null;
  }

  const bodyStart = keyMatch.index + keyMatch[0].length;
  let depth = 1;
  let i = bodyStart;
  for (; i < text.length && depth > 0; i += 1) {
    const ch = text[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
    }
  }

  return { body: text.slice(bodyStart, i - 1), start: bodyStart };
}

function toOffset(text: string, index: number): Offset {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { col: index - lineStart, line };
}
