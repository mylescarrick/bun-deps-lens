import * as vscode from "vscode";
import { dependencyLocations } from "./document-locations";
import type { DepLocation } from "./types";

export interface BumpCommandArgs {
  location: Pick<
    DepLocation,
    "name" | "section" | "catalogName" | "declaredRange"
  >;
  newValue: string;
  uri: string;
}

const updates = new Map<string, Promise<void>>();
const ownedContents = new WeakMap<vscode.TextDocument, string>();

export async function bumpToLatest(args: BumpCommandArgs): Promise<void> {
  const previous = updates.get(args.uri) ?? Promise.resolve();
  const updating = previous.catch(() => undefined).then(() => applyBump(args));
  updates.set(args.uri, updating);
  try {
    await updating;
  } finally {
    if (updates.get(args.uri) === updating) {
      updates.delete(args.uri);
    }
  }
}

async function applyBump(args: BumpCommandArgs): Promise<void> {
  const uri = vscode.Uri.parse(args.uri);
  const document = await vscode.workspace.openTextDocument(uri);
  const location = dependencyLocations
    .get(document)
    .find(
      (candidate) =>
        candidate.name === args.location.name &&
        candidate.section === args.location.section &&
        candidate.catalogName === args.location.catalogName &&
        candidate.declaredRange === args.location.declaredRange
    );
  if (location === undefined) {
    vscode.window.showWarningMessage(
      "Bun Deps: This dependency changed. Reopen its update action and try again."
    );
    return;
  }
  const range = new vscode.Range(
    location.valueStartLine,
    location.valueStartCol + 1,
    location.valueEndLine,
    location.valueEndCol - 1
  );
  const before = document.getText();
  const maySave = !document.isDirty || ownedContents.get(document) === before;
  const expected =
    before.slice(0, document.offsetAt(range.start)) +
    args.newValue +
    before.slice(document.offsetAt(range.end));
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, range, args.newValue);
  if (!(await vscode.workspace.applyEdit(edit))) {
    vscode.window.showWarningMessage("Bun Deps: Could not apply the update.");
    return;
  }

  // Typing or another extension can edit the buffer while applyEdit is pending.
  if (!maySave || document.isClosed || document.getText() !== expected) {
    ownedContents.delete(document);
    vscode.window.showWarningMessage(
      "Bun Deps: Save package.json, then run bun i to apply. Other unsaved edits were left unsaved."
    );
    return;
  }
  ownedContents.set(document, expected);
  const saved = await document.save().then(
    (result) => result,
    () => false
  );
  if (saved) {
    ownedContents.delete(document);
  } else {
    vscode.window.showWarningMessage(
      "Bun Deps: Could not save package.json. Save it, then run bun i to apply."
    );
  }
}
