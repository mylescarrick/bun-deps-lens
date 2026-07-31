export type Severity = "low" | "moderate" | "high" | "critical";

export type StatusColor = "green" | "amber" | "red";

export type DepSection =
  | "dependencies"
  | "devDependencies"
  | "peerDependencies"
  | "optionalDependencies"
  | "workspaces.catalog"
  | "workspaces.catalogs";

export interface OutdatedEntry {
  current: string;
  dev: boolean;
  latest: string;
  name: string;
  update: string;
}

export interface Advisory {
  id: number;
  severity: Severity;
  title: string;
  url: string;
  vulnerableVersions: string;
}

export type AuditMap = Record<string, Advisory[]>;

export interface DepStatus {
  advisories: Advisory[];
  color: StatusColor;
  current?: string;
  latest?: string;
  maxSeverity?: Severity;
  name: string;
  outdated: boolean;
  tooltip: string;
}

export interface HoistConflict {
  dependents: { spec: string; workspace: string }[];
  hoisted: string;
}

export interface DepLocation {
  /** The enclosing named catalog (workspaces.catalogs.<name>). Undefined for
   * the default catalog (workspaces.catalog) and for non-catalog sections. */
  catalogName?: string;
  declaredRange: string;
  name: string;
  section: DepSection;
  valueEndCol: number;
  valueEndLine: number;
  valueStartCol: number;
  valueStartLine: number;
}

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  low: 1,
  moderate: 2,
};
