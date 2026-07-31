import * as vscode from "vscode";
import { bumpRange } from "./bump";
import type { DepLocation, DepStatus } from "./types";

export interface BumpTarget {
  name: string;
  newValue: string;
  range: vscode.Range;
}

// The value range from DepLocation spans the quotes; the replacement only
// touches the text between them.
export function computeBumpTarget(
  location: DepLocation,
  status: DepStatus | undefined
): BumpTarget | undefined {
  if (status?.latest === undefined) {
    return;
  }
  const newValue = bumpRange(location.declaredRange, status.latest);
  if (newValue === undefined) {
    return;
  }
  return {
    name: location.name,
    newValue,
    range: new vscode.Range(
      location.valueStartLine,
      location.valueStartCol + 1,
      location.valueEndLine,
      location.valueEndCol - 1
    ),
  };
}
