import * as vscode from "vscode";
import { computeBumpTarget } from "./bump-target";
import { dependencyLocations } from "./document-locations";
import type { DepStatus } from "./types";

export class BumpInlayHintsProvider
  implements vscode.InlayHintsProvider, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this.changed.event;

  refresh(): void {
    this.changed.fire();
  }

  dispose(): void {
    this.changed.dispose();
  }

  private readonly getStatuses: (
    uri: string
  ) => Map<string, DepStatus> | undefined;

  constructor(
    getStatuses: (uri: string) => Map<string, DepStatus> | undefined
  ) {
    this.getStatuses = getStatuses;
  }

  provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range
  ): vscode.InlayHint[] {
    if (
      !vscode.workspace.getConfiguration("bunDeps").get<boolean>("enable", true)
    ) {
      return [];
    }
    const statuses = this.getStatuses(document.uri.toString());
    if (statuses === undefined) {
      return [];
    }

    const hints: vscode.InlayHint[] = [];
    for (const location of dependencyLocations.get(document)) {
      if (
        location.valueEndLine < range.start.line ||
        location.valueStartLine > range.end.line
      ) {
        continue;
      }
      const target = computeBumpTarget(location, statuses.get(location.name));
      if (target === undefined) {
        continue;
      }

      const part = new vscode.InlayHintLabelPart("↑ update");
      part.tooltip = `Update ${location.name} to ${target.newValue}`;
      part.command = {
        arguments: [
          {
            location,
            newValue: target.newValue,
            uri: document.uri.toString(),
          },
        ],
        command: "bunDeps.bumpToLatest",
        title: `Update ${location.name} to ${target.newValue}`,
      };

      const hint = new vscode.InlayHint(
        new vscode.Position(location.valueEndLine, location.valueEndCol),
        [part]
      );
      hint.paddingLeft = true;
      hint.paddingRight = true;
      hints.push(hint);
    }
    return hints;
  }
}
