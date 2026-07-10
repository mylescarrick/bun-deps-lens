import { describe, expect, test } from "bun:test";
import { parseAudit } from "../src/bun/audit";
import { buildStatuses } from "../src/status";
import type { OutdatedEntry } from "../src/types";

const outdated: OutdatedEntry[] = [
  {
    current: "4.17.20",
    dev: false,
    latest: "4.18.1",
    name: "lodash",
    update: "4.17.20",
  },
  {
    current: "18.3.1",
    dev: false,
    latest: "19.2.7",
    name: "react",
    update: "18.3.1",
  },
];

const audit = parseAudit(
  JSON.stringify({
    lodash: [{ id: 1, severity: "high", title: "Command Injection", url: "" }],
    minimist: [
      { id: 2, severity: "critical", title: "Proto Pollution", url: "" },
    ],
  })
);

describe("buildStatuses", () => {
  test("red when a high/critical vuln meets the threshold, even if also outdated", () => {
    const statuses = buildStatuses(["lodash"], outdated, audit, "high");
    expect(statuses.get("lodash")?.color).toBe("red");
    expect(statuses.get("lodash")?.outdated).toBe(true);
  });

  test("amber when outdated with no qualifying vuln", () => {
    const statuses = buildStatuses(["react"], outdated, audit, "high");
    const react = statuses.get("react");
    expect(react?.color).toBe("amber");
    expect(react?.current).toBe("18.3.1");
    expect(react?.latest).toBe("19.2.7");
  });

  test("green when current and not vulnerable", () => {
    const statuses = buildStatuses(["typescript"], outdated, audit, "high");
    expect(statuses.get("typescript")?.color).toBe("green");
    expect(statuses.get("typescript")?.outdated).toBe(false);
  });

  test("severityThreshold gates the red escalation", () => {
    const lowThreshold = buildStatuses(["minimist"], outdated, audit, "high");
    expect(lowThreshold.get("minimist")?.color).toBe("red");

    const highOnly = buildStatuses(["react"], outdated, audit, "critical");
    expect(highOnly.get("react")?.color).toBe("amber");
  });

  test("tooltip includes the version transition and advisory titles", () => {
    const statuses = buildStatuses(["lodash"], outdated, audit, "high");
    const tooltip = statuses.get("lodash")?.tooltip ?? "";
    expect(tooltip).toContain("4.17.20");
    expect(tooltip).toContain("4.18.1");
    expect(tooltip).toContain("Command Injection");
  });
});
