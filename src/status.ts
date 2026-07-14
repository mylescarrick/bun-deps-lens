import { maxSeverity } from "./bun/audit";
import type {
  Advisory,
  AuditMap,
  DepStatus,
  HoistConflict,
  OutdatedEntry,
  Severity,
} from "./types";
import { SEVERITY_RANK } from "./types";

export function buildStatuses(
  depNames: string[],
  outdated: OutdatedEntry[],
  audit: AuditMap,
  severityThreshold: Severity
): Map<string, DepStatus> {
  const outdatedByName = new Map(outdated.map((entry) => [entry.name, entry]));
  const statuses = new Map<string, DepStatus>();

  for (const name of depNames) {
    statuses.set(
      name,
      computeStatus(
        name,
        outdatedByName.get(name),
        audit[name] ?? [],
        severityThreshold
      )
    );
  }

  return statuses;
}

function computeStatus(
  name: string,
  entry: OutdatedEntry | undefined,
  advisories: Advisory[],
  severityThreshold: Severity
): DepStatus {
  const highest = maxSeverity(advisories);
  const isVulnerable =
    highest !== undefined &&
    SEVERITY_RANK[highest] >= SEVERITY_RANK[severityThreshold];
  const outdated = entry !== undefined && entry.current !== entry.latest;

  let color: DepStatus["color"] = "green";
  if (isVulnerable) {
    color = "red";
  } else if (outdated) {
    color = "amber";
  }

  return {
    advisories,
    color,
    current: entry?.current,
    latest: entry?.latest,
    maxSeverity: highest,
    name,
    outdated,
    tooltip: buildTooltip(name, entry, advisories, highest),
  };
}

export const PENDING_INLINE = "● run bun i to apply";
export const UNUSED_CATALOG_INLINE = "○ unused catalog entry";

export function unusedCatalogTooltip(name: string, declared: string): string {
  return [
    "$(package) **Bun Deps**",
    "",
    `**${name}**`,
    "Unused catalog entry.",
    `Declared \`${declared}\`, but no workspace in \`bun.lock\` references this package via \`catalog:\` or a named catalog.`,
    "Remove the catalog entry, or switch a workspace dependency to `catalog:` if it should use this version.",
  ].join("\n");
}

// Compact inline note for a catalog entry whose hoisted root copy differs from
// the catalog resolution, naming the workspace responsible when we know it.
export function conflictInline(conflict: HoistConflict): string {
  const [dependent] = conflict.dependents;
  return dependent === undefined
    ? `⚠ hoisted ${conflict.hoisted}`
    : `⚠ hoisted ${conflict.hoisted} via ${dependent.workspace}`;
}

export function conflictTooltip(conflict: HoistConflict): string {
  const lines = [
    "**Hoisted version conflict**",
    `Installed at the workspace root: \`${conflict.hoisted}\` — does not match the catalog resolution.`,
  ];
  if (conflict.dependents.length > 0) {
    const via = conflict.dependents
      .map(
        (dependent) => `\`${dependent.workspace}\` pins \`${dependent.spec}\``
      )
      .join(", ");
    lines.push(
      `Cause: ${via} directly. That copy is hoisted to the root, so tools resolving from the root see it instead of the catalog version.`,
      "Fix: switch that workspace to `catalog:` (or align its version), then run `bun i`."
    );
  }
  return lines.join("\n");
}

export function pendingTooltip(
  name: string,
  declared: string,
  installed?: string
): string {
  const lines = [
    "$(package) **Bun Deps**",
    "",
    `**${name}**`,
    "Run `bun i` to apply your change.",
    installed === undefined
      ? `Declared \`${declared}\` is not installed yet.`
      : `Declared \`${declared}\`, installed \`${installed}\`.`,
  ];
  return lines.join("\n");
}

// Short label rendered inline after the dependency line. Green is intentionally
// silent — the coloured value text already says "nothing to do here".
export function inlineLabel(status: DepStatus): string | undefined {
  const transition =
    status.current && status.latest
      ? `${status.current} → ${status.latest}`
      : undefined;

  if (status.color === "red") {
    const severity = status.maxSeverity ?? "known";
    return transition
      ? `● ${severity} vuln · ${transition}`
      : `● ${severity} vuln`;
  }
  if (status.color === "amber") {
    return transition ? `● ${transition}` : "● update available";
  }
}

function buildTooltip(
  name: string,
  entry: OutdatedEntry | undefined,
  advisories: Advisory[],
  highest: Severity | undefined
): string {
  const lines: string[] = ["$(package) **Bun Deps**", "", `**${name}**`];

  if (entry && entry.current !== entry.latest) {
    lines.push(`Current \`${entry.current}\` → latest \`${entry.latest}\``);
    if (entry.update !== entry.latest) {
      lines.push(`Latest in range: \`${entry.update}\``);
    }
  } else {
    lines.push("On the latest published version.");
  }

  if (advisories.length > 0) {
    lines.push("");
    lines.push(
      `Vulnerabilities (${highest ?? "unknown"} max):`,
      ...advisories.map(
        (advisory) => `- ${severityLabel(advisory.severity)} ${advisory.title}`
      )
    );
  }

  return lines.join("\n");
}

function severityLabel(severity: Severity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}
