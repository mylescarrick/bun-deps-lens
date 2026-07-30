import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as vscode from "vscode";
import { loadLockfileIndex } from "./bun/lockfile";
import { findCatalogDefinition, findCatalogReference } from "./catalog-link";
import { findDependencyLocations } from "./package-json";
import type { DepLocation } from "./types";

export class CatalogDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Location | undefined {
    const locations = findDependencyLocations(document.getText());
    const reference = findCatalogReference(locations, {
      character: position.character,
      line: position.line,
    });
    if (reference === undefined) {
      return;
    }

    const root = loadLockfileIndex(dirname(document.uri.fsPath))?.root;
    if (root === undefined) {
      return;
    }
    const rootPath = join(root, "package.json");

    const rootLocations =
      rootPath === document.uri.fsPath
        ? locations
        : findDependencyLocations(readRootPackageJson(rootPath));
    const definition = findCatalogDefinition(rootLocations, reference);
    if (definition === undefined) {
      return;
    }

    return new vscode.Location(
      vscode.Uri.file(rootPath),
      rangeForLocation(definition)
    );
  }
}

function readRootPackageJson(path: string): string {
  const open = vscode.workspace.textDocuments.find(
    (doc) => doc.uri.fsPath === path
  );
  return open === undefined ? readFileSync(path, "utf8") : open.getText();
}

function rangeForLocation(location: DepLocation): vscode.Range {
  return new vscode.Range(
    location.valueStartLine,
    location.valueStartCol,
    location.valueEndLine,
    location.valueEndCol
  );
}
