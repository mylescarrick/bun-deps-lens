import type { DepLocation, DepSection } from "./types";

const WORKSPACES_RE = /"workspaces"\s*:\s*\{/;
const CATALOG_RE = /"catalog"\s*:\s*\{/;
const CATALOGS_RE = /"catalogs"\s*:\s*\{/;
const NAMED_CATALOG_RE = /"[^"]+"\s*:\s*\{/g;

const SECTIONS: DepSection[] = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "workspaces.catalog",
  "workspaces.catalogs",
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

    if (block.blocks !== undefined) {
      for (const nested of block.blocks) {
        parseEntries(text, locations, "workspaces.catalogs", nested);
      }
      continue;
    }

    // Catalog values use catalog: in consumer sections, but the catalog block
    // itself contains plain semver ranges. Treat those as the declared range.
    parseEntries(text, locations, section, block);
  }

  return locations;
}

function parseEntries(
  text: string,
  locations: DepLocation[],
  section: DepSection,
  block: { body: string; start: number }
): void {
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

function findSectionBlock(
  text: string,
  section: DepSection
):
  | { start: number; body: string; blocks?: undefined }
  | {
      blocks: { start: number; body: string }[];
      body?: undefined;
      start?: undefined;
    }
  | null {
  if (section === "workspaces.catalog") {
    return findCatalogBlock(text);
  }
  if (section === "workspaces.catalogs") {
    return findNamedCatalogBlocks(text);
  }

  const keyRe = new RegExp(`"${section}"\\s*:\\s*\\{`);
  const keyMatch = keyRe.exec(text);
  if (keyMatch === null) {
    return null;
  }

  const bodyStart = keyMatch.index + keyMatch[0].length;
  const bodyEnd = findMatchingBrace(text, bodyStart);
  if (bodyEnd === null) {
    return null;
  }

  return { body: text.slice(bodyStart, bodyEnd - 1), start: bodyStart };
}

function findWorkspacesBody(
  text: string
): { start: number; end: number } | null {
  const wsMatch = WORKSPACES_RE.exec(text);
  if (wsMatch === null) {
    return null;
  }

  const wsBodyStart = wsMatch.index + wsMatch[0].length;
  const wsBodyEnd = findMatchingBrace(text, wsBodyStart);
  if (wsBodyEnd === null) {
    return null;
  }

  return { end: wsBodyEnd, start: wsBodyStart };
}

function findCatalogBlock(
  text: string
): { start: number; body: string } | null {
  const wsBody = findWorkspacesBody(text);
  if (wsBody === null) {
    return null;
  }

  const catalogMatch = CATALOG_RE.exec(text.slice(wsBody.start, wsBody.end));
  if (catalogMatch === null) {
    return null;
  }

  const catBodyStart =
    wsBody.start + catalogMatch.index + catalogMatch[0].length;
  const catBodyEnd = findMatchingBrace(text, catBodyStart);
  if (catBodyEnd === null) {
    return null;
  }

  return {
    body: text.slice(catBodyStart, catBodyEnd - 1),
    start: catBodyStart,
  };
}

function findNamedCatalogBlocks(
  text: string
): { blocks: { start: number; body: string }[] } | null {
  const wsBody = findWorkspacesBody(text);
  if (wsBody === null) {
    return null;
  }

  const catalogsMatch = CATALOGS_RE.exec(text.slice(wsBody.start, wsBody.end));
  if (catalogsMatch === null) {
    return null;
  }

  const catalogsBodyStart =
    wsBody.start + catalogsMatch.index + catalogsMatch[0].length;
  const catalogsBodyEnd = findMatchingBrace(text, catalogsBodyStart);
  if (catalogsBodyEnd === null) {
    return null;
  }

  const blocks: { start: number; body: string }[] = [];
  const slice = text.slice(catalogsBodyStart, catalogsBodyEnd - 1);
  let match: RegExpExecArray | null = NAMED_CATALOG_RE.exec(slice);
  while (match !== null) {
    const nestedStart = catalogsBodyStart + match.index + match[0].length;
    const nestedEnd = findMatchingBrace(text, nestedStart);
    if (nestedEnd !== null) {
      blocks.push({
        body: text.slice(nestedStart, nestedEnd - 1),
        start: nestedStart,
      });
    }
    match = NAMED_CATALOG_RE.exec(slice);
  }

  return { blocks };
}

function findMatchingBrace(text: string, bodyStart: number): number | null {
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
  return depth === 0 ? i : null;
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
