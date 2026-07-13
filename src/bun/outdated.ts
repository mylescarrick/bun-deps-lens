import type { OutdatedEntry } from "../types";

const DEV_MARKER = /\s*\(dev\)\s*$/;
const SEPARATOR_CELL = /^-+$/;
const HEADER_KEYS = new Set(["package", "current", "update", "latest"]);

// `bun outdated` has no --json flag (as of Bun 1.3.x); it prints a
// pipe-delimited table with columns: Package | Current | Update | Latest.
// In workspace projects Bun appends a Workspace column. Dev dependencies carry
// a " (dev)" suffix in the Package cell.
export function parseOutdated(stdout: string): OutdatedEntry[] {
  const entries: OutdatedEntry[] = [];

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("|")) {
      continue;
    }

    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

    if (cells.length !== 4 && cells.length !== 5) {
      continue;
    }
    if (isSeparatorRow(cells) || isHeaderRow(cells)) {
      continue;
    }

    const [packageCell, current, update, latest] = cells as [
      string,
      string,
      string,
      string,
    ];

    const dev = DEV_MARKER.test(packageCell);
    const name = packageCell.replace(DEV_MARKER, "").trim();

    if (name.length > 0) {
      entries.push({ current, dev, latest, name, update });
    }
  }

  return entries;
}

function isHeaderRow(cells: string[]): boolean {
  const [first] = cells;
  return first !== undefined && HEADER_KEYS.has(first.toLowerCase());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((cell) => cell.length === 0 || SEPARATOR_CELL.test(cell));
}
