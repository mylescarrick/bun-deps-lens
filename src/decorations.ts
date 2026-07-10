import * as vscode from "vscode";
import { inlineLabel } from "./status";
import type { DepLocation, DepStatus, StatusColor } from "./types";

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
    showInlineVersions: boolean
  ): void {
    const buckets: Record<StatusColor, vscode.DecorationOptions[]> = {
      amber: [],
      green: [],
      red: [],
    };

    for (const location of locations) {
      const status = statuses.get(location.name);
      if (status === undefined) {
        continue;
      }

      const valueRange = new vscode.Range(
        location.valueStartLine,
        location.valueStartCol,
        location.valueEndLine,
        location.valueEndCol
      );

      const hover = new vscode.MarkdownString(status.tooltip);
      hover.supportThemeIcons = true;

      const option: vscode.DecorationOptions = {
        hoverMessage: hover,
        range: valueRange,
      };

      const label = showInlineVersions ? inlineLabel(status) : undefined;
      if (label !== undefined) {
        option.renderOptions = {
          after: {
            color: new vscode.ThemeColor(THEME_COLOR[status.color]),
            contentText: `  ${label}`,
            fontStyle: "italic",
          },
        };
      }

      buckets[status.color].push(option);
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

function makeType(color: StatusColor): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    color: new vscode.ThemeColor(THEME_COLOR[color]),
    fontWeight: color === "red" ? "bold" : "normal",
  });
}
