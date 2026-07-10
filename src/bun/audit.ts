import type { Advisory, AuditMap, Severity } from "../types";
import { SEVERITY_RANK } from "../types";

const VALID_SEVERITIES = new Set<Severity>([
  "low",
  "moderate",
  "high",
  "critical",
]);

interface RawAdvisory {
  id?: number;
  severity?: string;
  title?: string;
  url?: string;
  vulnerable_versions?: string;
}

// `bun audit --json` returns an object keyed by installed package name, whose
// values are arrays of advisories. Presence means the installed version is
// vulnerable (Bun already filters by installed version).
export function parseAudit(stdout: string): AuditMap {
  const text = stdout.trim();
  if (text.length === 0) {
    return {};
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }

  if (raw === null || typeof raw !== "object") {
    return {};
  }

  const result: AuditMap = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) {
      continue;
    }
    const advisories = value
      .map(toAdvisory)
      .filter((advisory): advisory is Advisory => advisory !== null);
    if (advisories.length > 0) {
      result[name] = advisories;
    }
  }

  return result;
}

export function maxSeverity(advisories: Advisory[]): Severity | undefined {
  let highest: Severity | undefined;
  for (const advisory of advisories) {
    if (
      highest === undefined ||
      SEVERITY_RANK[advisory.severity] > SEVERITY_RANK[highest]
    ) {
      highest = advisory.severity;
    }
  }
  return highest;
}

function toAdvisory(value: unknown): Advisory | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const raw = value as RawAdvisory;
  if (
    typeof raw.severity !== "string" ||
    !VALID_SEVERITIES.has(raw.severity as Severity)
  ) {
    return null;
  }
  return {
    id: raw.id ?? 0,
    severity: raw.severity as Severity,
    title: raw.title ?? "",
    url: raw.url ?? "",
    vulnerableVersions: raw.vulnerable_versions ?? "",
  };
}
