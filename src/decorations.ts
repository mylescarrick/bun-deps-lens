import * as vscode from "vscode";
import { computeBumpTarget } from "./bump-target";
import { catalogReferenceFromDeclaredRange } from "./catalog-link";
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
    unusedCatalogs: Set<string>,
    catalogConsumerCounts: Map<string, number>
  ): void {
    const buckets = emptyBuckets();

    for (const location of locations) {
      const rendered = renderLocation(
        location,
        statuses,
        showInlineVersions,
        pending,
        conflicts,
        unusedCatalogs,
        catalogConsumerCounts,
        editor.document.uri
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
  unusedCatalogs: Set<string>,
  catalogConsumerCounts: Map<string, number>,
  documentUri: vscode.Uri
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
    showInlineVersions,
    catalogConsumerCounts.get(location.name),
    documentUri
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
  showInlineVersions: boolean,
  catalogConsumerCount: number | undefined,
  documentUri: vscode.Uri
): RenderedDecoration | undefined {
  if (status === undefined && conflict === undefined) {
    return;
  }
  const color = status?.color ?? "amber";
  const { inline, tooltip } = statusCopy(
    location,
    status,
    conflict,
    catalogConsumerCount,
    documentUri
  );
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
  conflict: HoistConflict | undefined,
  catalogConsumerCount: number | undefined,
  documentUri: vscode.Uri
): { inline?: string; tooltip: string } {
  let tooltip =
    status?.tooltip ?? `$(package) **Bun Deps**\n\n**${location.name}**`;
  let inline = status ? inlineLabel(status) : undefined;
  if (conflict !== undefined) {
    tooltip = `${tooltip}\n\n${conflictTooltip(conflict)}`;
    const note = conflictInline(conflict);
    inline = inline === undefined ? `● ${note}` : `${inline} · ${note}`;
  }
  const catalogLink =
    catalogConsumerCount === undefined
      ? undefined
      : catalogRevealLink(location, catalogConsumerCount, documentUri);
  if (catalogLink === undefined) {
    const bumpLink = bumpUpdateLink(location, status, documentUri);
    if (bumpLink !== undefined) {
      tooltip = `${tooltip}\n\n${bumpLink}`;
    }
  } else {
    tooltip = `${tooltip}\n\n${catalogLink}`;
  }
  return { inline, tooltip };
}

function commandUri(command: string, args: unknown): string {
  return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`;
}

function bumpUpdateLink(
  location: DepLocation,
  status: DepStatus | undefined,
  documentUri: vscode.Uri
): string | undefined {
  const target = computeBumpTarget(location, status);
  if (target === undefined) {
    return;
  }
  const args = [
    {
      endCol: target.range.end.character,
      endLine: target.range.end.line,
      newValue: target.newValue,
      startCol: target.range.start.character,
      startLine: target.range.start.line,
      uri: documentUri.toString(),
    },
  ];
  return `[⬆ Update to ${target.newValue}](${commandUri("bunDeps.bumpToLatest", args)})`;
}

function catalogRevealLink(
  location: DepLocation,
  consumerCount: number,
  documentUri: vscode.Uri
): string | undefined {
  const reference = catalogReferenceFromDeclaredRange(
    location.name,
    location.declaredRange
  );
  if (reference === undefined) {
    return;
  }
  const args = [
    {
      catalogName: reference.catalogName,
      name: reference.name,
      uri: documentUri.toString(),
    },
  ];
  const workspaces =
    consumerCount === 1 ? "1 workspace" : `${consumerCount} workspaces`;
  return `[Cmd+click/Ctrl+click "catalog" to upgrade (affects ${workspaces})](${commandUri("bunDeps.revealCatalogDefinition", args)})`;
}

function decoration(
  range: vscode.Range,
  tooltip: string,
  inline: string | undefined,
  color: DecorationColor
): vscode.DecorationOptions {
  const hover = new vscode.MarkdownString(tooltip);
  hover.supportThemeIcons = true;
  hover.isTrusted = {
    enabledCommands: [
      "bunDeps.bumpToLatest",
      "bunDeps.revealCatalogDefinition",
    ],
  };

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
