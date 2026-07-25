import { parseAudit } from "./bun/audit";
import { parseOutdated } from "./bun/outdated";
import { runBun } from "./bun/runner";
import { computeResolvedVersions } from "./installed";
import { buildStatuses } from "./status";
import type { DepLocation, DepStatus, Severity } from "./types";

export async function analyze(
  cwd: string,
  locations: DepLocation[],
  severityThreshold: Severity,
  bunPath = "bun"
): Promise<Map<string, DepStatus>> {
  const [outdatedResult, auditResult] = await Promise.all([
    // `--filter '*'` checks every workspace, not just the one at `cwd`. Without
    // it, a catalog entry defined at the repo root but consumed only by child
    // workspaces is invisible when the root package.json is open, so it shows
    // up as "latest" even when a newer version exists.
    runBun(["outdated", "--no-progress", "--filter", "*"], cwd, bunPath),
    runBun(["audit", "--json"], cwd, bunPath),
  ]);

  const outdated = parseOutdated(outdatedResult.stdout);
  // `bun audit` may print advisories on stdout even on a non-zero exit; parse
  // whatever we got and treat unparseable output as "no vulnerability data".
  const audit = parseAudit(auditResult.stdout);

  const depNames = [...new Set(locations.map((loc) => loc.name))];
  const resolvedVersions = computeResolvedVersions(cwd, locations);

  return buildStatuses(
    depNames,
    outdated,
    audit,
    severityThreshold,
    resolvedVersions
  );
}
