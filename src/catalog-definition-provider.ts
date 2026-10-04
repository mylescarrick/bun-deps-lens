import { dirname, join } from "node:path";
import * as vscode from "vscode";
import { findLockfile } from "./bun/lockfile";
import {
  type CatalogReference,
  findCatalogDefinition,
  findCatalogReference,
} from "./catalog-link";
import { dependencyLocations } from "./document-locations";
import type { DepLocation } from "./types";

export class CatalogDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Location | undefined> {
    const reference = findCatalogReference(dependencyLocations.get(document), {
      character: position.character,
      line: position.line,
    });
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
  const lockfile = await findLockfile(dirname(sourceFsPath));
  if (lockfile === null || lockfile.endsWith(".lockb")) {
    return;
  }
  const rootUri = vscode.Uri.file(join(dirname(lockfile), "package.json"));
  const rootDoc = await vscode.workspace.openTextDocument(rootUri);
  const definition = findCatalogDefinition(
    dependencyLocations.get(rootDoc),
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
