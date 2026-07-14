import * as vscode from "vscode";
import type { Pending } from "./installed";
import {
  conflictInline,
  conflictTooltip,
  inlineLabel,
  PENDING_INLINE,
  pendingTooltip,
} from "./status";
import type {
  DepLocation,
  DepStatus,
  HoistConflict,
  StatusColor,
} from "./types";

// Theme-aware chart colours adapt across light/dark/high-contrast themes.
const THEME_COLOR: Record<StatusColor, string> = {
  amber: "charts.orange",
  green: "charts.green",
  red: "charts.red",
};

export class DepDecorator implements vscode.Disposable {
  private readonly types: Record<StatusColor, vscode.TextEditorDecorationType>;

  constructor() {
    this.types = {
      amber: makeType("amber"),
      green: makeType("green"),
      red: makeType("red"),
    };
  }

  render(
    editor: vscode.TextEditor,
    locations: DepLocation[],
    statuses: Map<string, DepStatus>,
    showInlineVersions: boolean,
    pending: Map<string, Pending>,
    conflicts: Map<string, HoistConflict>
  ): void {
    const buckets: Record<StatusColor, vscode.DecorationOptions[]> = {
      amber: [],
      green: [],
      red: [],
    };

    for (const location of locations) {
      const valueRange = new vscode.Range(
        location.valueStartLine,
        location.valueStartCol,
        location.valueEndLine,
        location.valueEndCol
      );

      const pendingEntry = pending.get(location.name);
      if (pendingEntry !== undefined) {
        buckets.amber.push(
          decoration(
            valueRange,
            pendingTooltip(
              location.name,
              pendingEntry.declared,
              pendingEntry.installed
            ),
            showInlineVersions ? PENDING_INLINE : undefined,
            "amber"
          )
        );
        continue;
      }

      const status = statuses.get(location.name);
      const conflict = conflicts.get(location.name);
      if (status === undefined && conflict === undefined) {
        continue;
      }

      const color = status?.color ?? "amber";
      let tooltip =
        status?.tooltip ?? `$(package) **Bun Deps**\n\n**${location.name}**`;
      let inline = status ? inlineLabel(status) : undefined;
      if (conflict !== undefined) {
        tooltip = `${tooltip}\n\n${conflictTooltip(conflict)}`;
        const note = conflictInline(conflict);
        inline = inline === undefined ? `● ${note}` : `${inline} · ${note}`;
      }

      buckets[color].push(
        decoration(
          valueRange,
          tooltip,
          showInlineVersions ? inline : undefined,
          color
        )
      );
    }

    editor.setDecorations(this.types.green, buckets.green);
    editor.setDecorations(this.types.amber, buckets.amber);
    editor.setDecorations(this.types.red, buckets.red);
  }

  clear(editor: vscode.TextEditor): void {
    editor.setDecorations(this.types.green, []);
    editor.setDecorations(this.types.amber, []);
    editor.setDecorations(this.types.red, []);
  }

  dispose(): void {
    this.types.green.dispose();
    this.types.amber.dispose();
    this.types.red.dispose();
  }
}

function decoration(
  range: vscode.Range,
  tooltip: string,
  inline: string | undefined,
  color: StatusColor
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

function makeType(color: StatusColor): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    color: new vscode.ThemeColor(THEME_COLOR[color]),
    fontWeight: color === "red" ? "bold" : "normal",
  });
}
