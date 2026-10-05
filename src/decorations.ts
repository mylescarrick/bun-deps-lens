import * as vscode from "vscode";
import { computeBumpTarget } from "./bump-target";
import { catalogReferenceFromDeclaredRange } from "./catalog-link";
import type { Pending } from "./installed";
import {
  conflictInline,
  conflictTooltip,
  inlineLabel,
  pendingInline,
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
  private readonly hoverType = vscode.window.createTextEditorDecorationType({});
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
    const hovers: vscode.DecorationOptions[] = [];

    for (const location of locations) {
      const rendered = renderLocation(
        location,
        statuses,
        showInlineVersions,
        pending,
        conflicts,
        unusedCatalogs,
        catalogConsumerCounts,
        editor.document
      );
      if (rendered !== undefined) {
        buckets[rendered.color].push(...rendered.options);
        hovers.push(rendered.hover);
      }
    }

    editor.setDecorations(this.types.green, buckets.green);
    editor.setDecorations(this.types.amber, buckets.amber);
    editor.setDecorations(this.types.red, buckets.red);
    editor.setDecorations(this.types.unused, buckets.unused);
    editor.setDecorations(this.hoverType, hovers);
  }

  clear(editor: vscode.TextEditor): void {
    editor.setDecorations(this.types.green, []);
    editor.setDecorations(this.types.amber, []);
    editor.setDecorations(this.types.red, []);
    editor.setDecorations(this.types.unused, []);
    editor.setDecorations(this.hoverType, []);
  }

  dispose(): void {
    this.types.green.dispose();
    this.types.amber.dispose();
    this.types.red.dispose();
    this.types.unused.dispose();
    this.hoverType.dispose();
  }
}

interface RenderedDecoration {
  color: DecorationColor;
  hover: vscode.DecorationOptions;
  options: vscode.DecorationOptions[];
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
  document: vscode.TextDocument
): RenderedDecoration | undefined {
  const range = rangeForLocation(location);
  const anchor = annotationAnchor(document, location);
  const pendingEntry = pending.get(location.name);
  if (pendingEntry !== undefined) {
    return pendingDecoration(
      location,
      range,
      anchor,
      pendingEntry,
      showInlineVersions,
      document.isDirty
    );
  }
  if (isCatalogLocation(location) && unusedCatalogs.has(location.name)) {
    return unusedCatalogDecoration(location, range, anchor, showInlineVersions);
  }
  return statusDecoration(
    location,
    range,
    anchor,
    statuses.get(location.name),
    conflicts.get(location.name),
    showInlineVersions,
    catalogConsumerCounts.get(location.name),
    document.uri
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

// Anchors the inline annotation to the right of a trailing comma, so it reads
// as a note about the line rather than sitting between the value and its own
// comma (`"^0.18.12", 0.18.12 → 0.18.13` instead of `"^0.18.12" ● ..., `).
function annotationAnchor(
  document: vscode.TextDocument,
  location: DepLocation
): vscode.Position {
  const line = document.lineAt(location.valueEndLine).text;
  const col =
    line.charAt(location.valueEndCol) === ","
      ? location.valueEndCol + 1
      : location.valueEndCol;
  return new vscode.Position(location.valueEndLine, col);
}

function pendingDecoration(
  location: DepLocation,
  range: vscode.Range,
  anchor: vscode.Position,
  pendingEntry: Pending,
  showInlineVersions: boolean,
  isDirty: boolean
): RenderedDecoration {
  return decoration(
    range,
    anchor,
    pendingTooltip(
      location.name,
      pendingEntry.declared,
      pendingEntry.installed,
      isDirty
    ),
    showInlineVersions ? pendingInline(isDirty) : undefined,
    "amber"
  );
}

function unusedCatalogDecoration(
  location: DepLocation,
  range: vscode.Range,
  anchor: vscode.Position,
  showInlineVersions: boolean
): RenderedDecoration {
  return decoration(
    range,
    anchor,
    unusedCatalogTooltip(location.name, location.declaredRange),
    showInlineVersions ? UNUSED_CATALOG_INLINE : undefined,
    "unused"
  );
}

function statusDecoration(
  location: DepLocation,
  range: vscode.Range,
  anchor: vscode.Position,
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
  return decoration(
    range,
    anchor,
    tooltip,
    showInlineVersions ? inline : undefined,
    color
  );
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
      location,
      newValue: target.newValue,
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

// Colour only the value and anchor the annotation after the comma. A separate
// unstyled range owns their shared tooltip so VS Code cannot show it twice.
function decoration(
  range: vscode.Range,
  anchor: vscode.Position,
  tooltip: string,
  inline: string | undefined,
  color: DecorationColor
): RenderedDecoration {
  const hover = new vscode.MarkdownString(tooltip);
  hover.supportThemeIcons = true;
  hover.isTrusted = {
    enabledCommands: [
      "bunDeps.bumpToLatest",
      "bunDeps.revealCatalogDefinition",
    ],
  };

  const hoverOption: vscode.DecorationOptions = {
    hoverMessage: hover,
    range: new vscode.Range(
      range.start,
      inline === undefined ? range.end : anchor
    ),
  };
  const valueOption: vscode.DecorationOptions = { range };
  if (inline === undefined) {
    return { color, hover: hoverOption, options: [valueOption] };
  }

  const annotationOption: vscode.DecorationOptions = {
    range: new vscode.Range(anchor, anchor),
    renderOptions: {
      after: {
        color: new vscode.ThemeColor(THEME_COLOR[color]),
        contentText: ` ${inline}`,
        fontStyle: "italic",
      },
    },
  };
  return {
    color,
    hover: hoverOption,
    options: [valueOption, annotationOption],
  };
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
