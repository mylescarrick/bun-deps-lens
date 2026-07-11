import { maxSeverity } from "./bun/audit";
import type {
  Advisory,
  AuditMap,
  DepStatus,
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
