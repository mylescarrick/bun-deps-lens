import * as vscode from "vscode";
import type { Pending } from "./installed";
import {
  conflictInline,
  conflictTooltip,
  inlineLabel,
  PENDING_INLINE,
  pendingTooltip,
  UNUSED_CATALOG_INLINE,
  unusedCatalogTooltip,
} from "./status";
import type {
  DepLocation,
  DepStatus,
  HoistConflict,
  StatusColor,
} from "./types";

type DecorationColor = StatusColor | "unused";

// Theme-aware colours adapt across light/dark/high-contrast themes. Unused
// catalog entries are intentionally subdued instead of warning-coloured.
const THEME_COLOR: Record<DecorationColor, string> = {
  amber: "charts.orange",
  green: "charts.green",
  red: "charts.red",
  unused: "descriptionForeground",
};

export class DepDecorator implements vscode.Disposable {
  private readonly types: Record<
    DecorationColor,
    vscode.TextEditorDecorationType
  >;

  constructor() {
    this.types = {
      amber: makeType("amber"),
      green: makeType("green"),
      red: makeType("red"),
      unused: makeType("unused"),
    };
  }

  render(
    editor: vscode.TextEditor,
    locations: DepLocation[],
    statuses: Map<string, DepStatus>,
    showInlineVersions: boolean,
    pending: Map<string, Pending>,
    conflicts: Map<string, HoistConflict>,
    unusedCatalogs: Set<string>
  ): void {
    const buckets = emptyBuckets();

    for (const location of locations) {
      const rendered = renderLocation(
        location,
        statuses,
        showInlineVersions,
        pending,
        conflicts,
        unusedCatalogs
      );
      if (rendered !== undefined) {
        buckets[rendered.color].push(rendered.option);
      }
    }

    editor.setDecorations(this.types.green, buckets.green);
    editor.setDecorations(this.types.amber, buckets.amber);
    editor.setDecorations(this.types.red, buckets.red);
    editor.setDecorations(this.types.unused, buckets.unused);
  }

  clear(editor: vscode.TextEditor): void {
    editor.setDecorations(this.types.green, []);
    editor.setDecorations(this.types.amber, []);
    editor.setDecorations(this.types.red, []);
    editor.setDecorations(this.types.unused, []);
  }

  dispose(): void {
    this.types.green.dispose();
    this.types.amber.dispose();
    this.types.red.dispose();
    this.types.unused.dispose();
  }
}

interface RenderedDecoration {
  color: DecorationColor;
  option: vscode.DecorationOptions;
}

function emptyBuckets(): Record<DecorationColor, vscode.DecorationOptions[]> {
  return {
    amber: [],
    green: [],
    red: [],
    unused: [],
  };
}

function renderLocation(
  location: DepLocation,
  statuses: Map<string, DepStatus>,
  showInlineVersions: boolean,
  pending: Map<string, Pending>,
  conflicts: Map<string, HoistConflict>,
  unusedCatalogs: Set<string>
): RenderedDecoration | undefined {
  const range = rangeForLocation(location);
  const pendingEntry = pending.get(location.name);
  if (pendingEntry !== undefined) {
    return pendingDecoration(location, range, pendingEntry, showInlineVersions);
  }
  if (isCatalogLocation(location) && unusedCatalogs.has(location.name)) {
    return unusedCatalogDecoration(location, range, showInlineVersions);
  }
  return statusDecoration(
    location,
    range,
    statuses.get(location.name),
    conflicts.get(location.name),
    showInlineVersions
  );
}

function rangeForLocation(location: DepLocation): vscode.Range {
  return new vscode.Range(
    location.valueStartLine,
    location.valueStartCol,
    location.valueEndLine,
    location.valueEndCol
  );
}

function pendingDecoration(
  location: DepLocation,
  range: vscode.Range,
  pendingEntry: Pending,
  showInlineVersions: boolean
): RenderedDecoration {
  return {
    color: "amber",
    option: decoration(
      range,
      pendingTooltip(
        location.name,
        pendingEntry.declared,
        pendingEntry.installed
      ),
      showInlineVersions ? PENDING_INLINE : undefined,
      "amber"
    ),
  };
}

function unusedCatalogDecoration(
  location: DepLocation,
  range: vscode.Range,
  showInlineVersions: boolean
): RenderedDecoration {
  return {
    color: "unused",
    option: decoration(
      range,
      unusedCatalogTooltip(location.name, location.declaredRange),
      showInlineVersions ? UNUSED_CATALOG_INLINE : undefined,
      "unused"
    ),
  };
}

function statusDecoration(
  location: DepLocation,
  range: vscode.Range,
  status: DepStatus | undefined,
  conflict: HoistConflict | undefined,
  showInlineVersions: boolean
): RenderedDecoration | undefined {
  if (status === undefined && conflict === undefined) {
    return;
  }
  const color = status?.color ?? "amber";
  const { inline, tooltip } = statusCopy(location, status, conflict);
  return {
    color,
    option: decoration(
      range,
      tooltip,
      showInlineVersions ? inline : undefined,
      color
    ),
  };
}

function statusCopy(
  location: DepLocation,
  status: DepStatus | undefined,
  conflict: HoistConflict | undefined
): { inline?: string; tooltip: string } {
  let tooltip =
    status?.tooltip ?? `$(package) **Bun Deps**\n\n**${location.name}**`;
  let inline = status ? inlineLabel(status) : undefined;
  if (conflict !== undefined) {
    tooltip = `${tooltip}\n\n${conflictTooltip(conflict)}`;
    const note = conflictInline(conflict);
    inline = inline === undefined ? `● ${note}` : `${inline} · ${note}`;
  }
  return { inline, tooltip };
}

function decoration(
  range: vscode.Range,
  tooltip: string,
  inline: string | undefined,
  color: DecorationColor
): vscode.DecorationOptions {
  const hover = new vscode.MarkdownString(tooltip);
  hover.supportThemeIcons = true;

  const option: vscode.DecorationOptions = { hoverMessage: hover, range };
  if (inline !== undefined) {
    option.renderOptions = {
      after: {
        color: new vscode.ThemeColor(THEME_COLOR[color]),
        contentText: `  ${inline}`,
        fontStyle: "italic",
      },
    };
  }
  return option;
}

function makeType(color: DecorationColor): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    color: new vscode.ThemeColor(THEME_COLOR[color]),
    fontWeight: color === "red" ? "bold" : "normal",
  });
}

function isCatalogLocation(location: DepLocation): boolean {
  return (
    location.section === "workspaces.catalog" ||
    location.section === "workspaces.catalogs"
  );
}
