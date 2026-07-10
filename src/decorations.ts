import * as vscode from "vscode";
import type { DepLocation, DepStatus, StatusColor } from "./types";

const BACKGROUNDS: Record<StatusColor, string> = {
  amber: "rgba(210, 153, 34, 0.16)",
  green: "rgba(63, 185, 80, 0.14)",
  red: "rgba(248, 81, 73, 0.18)",
};

export class DepDecorator implements vscode.Disposable {
  private readonly backgrounds: Record<
    StatusColor,
    vscode.TextEditorDecorationType
  >;
  private readonly inline: vscode.TextEditorDecorationType;

  constructor() {
    this.backgrounds = {
      amber: makeBackground(BACKGROUNDS.amber),
      green: makeBackground(BACKGROUNDS.green),
      red: makeBackground(BACKGROUNDS.red),
    };
    this.inline = vscode.window.createTextEditorDecorationType({
      after: {
        color: new vscode.ThemeColor("editorCodeLens.foreground"),
        fontStyle: "italic",
        margin: "0 0 0 1rem",
      },
    });
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
    const inlineOptions: vscode.DecorationOptions[] = [];

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
      hover.isTrusted = false;
      buckets[status.color].push({ hoverMessage: hover, range: valueRange });

      if (
        showInlineVersions &&
        status.outdated &&
        status.current &&
        status.latest
      ) {
        inlineOptions.push({
          range: new vscode.Range(
            location.valueEndLine,
            location.valueEndCol,
            location.valueEndLine,
            location.valueEndCol
          ),
          renderOptions: {
            after: { contentText: `${status.current} → ${status.latest}` },
          },
        });
      }
    }

    editor.setDecorations(this.backgrounds.green, buckets.green);
    editor.setDecorations(this.backgrounds.amber, buckets.amber);
    editor.setDecorations(this.backgrounds.red, buckets.red);
    editor.setDecorations(this.inline, inlineOptions);
  }

  clear(editor: vscode.TextEditor): void {
    editor.setDecorations(this.backgrounds.green, []);
    editor.setDecorations(this.backgrounds.amber, []);
    editor.setDecorations(this.backgrounds.red, []);
    editor.setDecorations(this.inline, []);
  }

  dispose(): void {
    this.backgrounds.green.dispose();
    this.backgrounds.amber.dispose();
    this.backgrounds.red.dispose();
    this.inline.dispose();
  }
}

function makeBackground(color: string): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    backgroundColor: color,
    borderRadius: "3px",
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
}
