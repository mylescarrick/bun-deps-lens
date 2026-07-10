import { describe, expect, test } from "bun:test";
import { maxSeverity, parseAudit } from "../src/bun/audit";

// Trimmed from real `bun audit --json` output.
const AUDIT_JSON = JSON.stringify({
  lodash: [
    {
      id: 1_106_913,
      severity: "high",
      title: "Command Injection in lodash",
      url: "https://github.com/advisories/GHSA-35jh-r3h4-6jhm",
      vulnerable_versions: "<4.17.21",
    },
    {
      id: 1_108_258,
      severity: "moderate",
      title: "ReDoS in lodash",
      url: "https://github.com/advisories/GHSA-29mw-wpgm-hmr9",
      vulnerable_versions: ">=4.0.0 <4.17.21",
    },
  ],
  minimist: [
    {
      id: 1_097_678,
      severity: "critical",
      title: "Prototype Pollution in minimist",
      url: "https://github.com/advisories/GHSA-xvch-5gv4-984h",
      vulnerable_versions: ">=1.0.0 <1.2.6",
    },
  ],
});

describe("parseAudit", () => {
  test("parses advisories keyed by package name", () => {
    const audit = parseAudit(AUDIT_JSON);
    expect(Object.keys(audit).sort()).toEqual(["lodash", "minimist"]);
    expect(audit.lodash).toHaveLength(2);
    expect(audit.lodash?.[0]?.vulnerableVersions).toBe("<4.17.21");
  });

  test("returns empty object for clean or unparseable output", () => {
    expect(parseAudit("")).toEqual({});
    expect(parseAudit("not json")).toEqual({});
    expect(parseAudit("null")).toEqual({});
  });

  test("drops advisories with an unknown severity", () => {
    const audit = parseAudit(
      JSON.stringify({ foo: [{ severity: "spicy", title: "x" }] })
    );
    expect(audit.foo).toBeUndefined();
  });
});

describe("maxSeverity", () => {
  test("returns the highest severity present", () => {
    const audit = parseAudit(AUDIT_JSON);
    expect(maxSeverity(audit.lodash ?? [])).toBe("high");
    expect(maxSeverity(audit.minimist ?? [])).toBe("critical");
  });

  test("returns undefined for no advisories", () => {
    expect(maxSeverity([])).toBeUndefined();
  });
});
