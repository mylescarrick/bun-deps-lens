import * as vscode from "vscode";
import { computeBumpTarget } from "./bump-target";
import { dependencyLocations } from "./document-locations";
import type { DepStatus } from "./types";

export class BumpCodeActionProvider implements vscode.CodeActionProvider {
  private readonly getStatuses: (
    uri: string
  ) => Map<string, DepStatus> | undefined;

  constructor(
    getStatuses: (uri: string) => Map<string, DepStatus> | undefined
  ) {
    this.getStatuses = getStatuses;
  }

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range
  ): vscode.CodeAction[] {
    const statuses = this.getStatuses(document.uri.toString());
    if (statuses === undefined) {
      return [];
    }

    const actions: vscode.CodeAction[] = [];
    for (const location of dependencyLocations.get(document)) {
      const valueRange = new vscode.Range(
        location.valueStartLine,
        location.valueStartCol,
        location.valueEndLine,
        location.valueEndCol
      );
      if (valueRange.intersection(range) === undefined) {
        continue;
      }
      const target = computeBumpTarget(location, statuses.get(location.name));
      if (target === undefined) {
        continue;
      }
      const action = new vscode.CodeAction(
        `Update ${location.name} to ${target.newValue}`,
        vscode.CodeActionKind.QuickFix
      );
      action.command = {
        arguments: [
          {
            location,
            newValue: target.newValue,
            uri: document.uri.toString(),
          },
        ],
        command: "bunDeps.bumpToLatest",
        title: action.title,
      };
      actions.push(action);
    }
    return actions;
  }
}
