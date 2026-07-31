import * as vscode from "vscode";

export interface BumpCommandArgs {
  endCol: number;
  endLine: number;
  newValue: string;
  startCol: number;
  startLine: number;
  uri: string;
}

export async function bumpToLatest(args: BumpCommandArgs): Promise<void> {
  const uri = vscode.Uri.parse(args.uri);
  const range = new vscode.Range(
    args.startLine,
    args.startCol,
    args.endLine,
    args.endCol
  );
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, range, args.newValue);
  await vscode.workspace.applyEdit(edit);
}
