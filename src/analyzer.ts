import { parseAudit } from "./bun/audit";
import { parseOutdated } from "./bun/outdated";
import { runBun } from "./bun/runner";
import { buildStatuses } from "./status";
import type { DepStatus, Severity } from "./types";

export async function analyze(
  cwd: string,
  depNames: string[],
  severityThreshold: Severity,
  bunPath = "bun"
): Promise<Map<string, DepStatus>> {
  const [outdatedResult, auditResult] = await Promise.all([
    runBun(["outdated", "--no-progress"], cwd, bunPath),
    runBun(["audit", "--json"], cwd, bunPath),
  ]);

  const outdated = parseOutdated(outdatedResult.stdout);
  // `bun audit` may print advisories on stdout even on a non-zero exit; parse
  // whatever we got and treat unparseable output as "no vulnerability data".
  const audit = parseAudit(auditResult.stdout);

  return buildStatuses(depNames, outdated, audit, severityThreshold);
}
