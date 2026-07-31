import { dirname, join } from "node:path";
import * as vscode from "vscode";
import { loadLockfileIndex } from "./bun/lockfile";
import {
  type CatalogReference,
  findCatalogDefinition,
  findCatalogReference,
} from "./catalog-link";
import { findDependencyLocations } from "./package-json";
import type { DepLocation } from "./types";

export class CatalogDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Location | undefined> {
    const reference = findCatalogReference(
      findDependencyLocations(document.getText()),
      { character: position.character, line: position.line }
    );
    if (reference === undefined) {
      return;
    }
    return await resolveCatalogDefinition(document.uri.fsPath, reference);
  }
}

// Resolves a catalog reference to its declaration in the workspace root,
// wherever the reference was found. Prefers an already-open buffer over disk
// so unsaved catalog edits resolve correctly.
export async function resolveCatalogDefinition(
  sourceFsPath: string,
  reference: CatalogReference
): Promise<vscode.Location | undefined> {
  const root = loadLockfileIndex(dirname(sourceFsPath))?.root;
  if (root === undefined) {
    return;
  }
  const rootUri = vscode.Uri.file(join(root, "package.json"));
  const rootDoc = await vscode.workspace.openTextDocument(rootUri);
  const definition = findCatalogDefinition(
    findDependencyLocations(rootDoc.getText()),
    reference
  );
  return definition === undefined
    ? undefined
    : new vscode.Location(rootUri, rangeForLocation(definition));
}

function rangeForLocation(location: DepLocation): vscode.Range {
  return new vscode.Range(
    location.valueStartLine,
    location.valueStartCol,
    location.valueEndLine,
    location.valueEndCol
  );
}
