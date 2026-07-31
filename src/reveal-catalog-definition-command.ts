import * as vscode from "vscode";
import { resolveCatalogDefinition } from "./catalog-definition-provider";

export interface RevealCatalogDefinitionArgs {
  catalogName?: string;
  name: string;
  uri: string;
}

export async function revealCatalogDefinition(
  args: RevealCatalogDefinitionArgs
): Promise<void> {
  const sourceUri = vscode.Uri.parse(args.uri);
  const location = await resolveCatalogDefinition(sourceUri.fsPath, {
    catalogName: args.catalogName,
    name: args.name,
  });
  if (location === undefined) {
    vscode.window.showWarningMessage(
      `Bun Deps: could not find the catalog definition for ${args.name}.`
    );
    return;
  }
  const doc = await vscode.workspace.openTextDocument(location.uri);
  await vscode.window.showTextDocument(doc, { selection: location.range });
}
