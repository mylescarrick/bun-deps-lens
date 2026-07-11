import { dirname } from "node:path";
import * as vscode from "vscode";
import { analyze } from "./analyzer";
import {
  BunNotFoundError,
  getBunVersion,
  isVersionAtLeast,
  MIN_BUN_VERSION,
} from "./bun/runner";
import { DepDecorator } from "./decorations";
import { findDependencyLocations } from "./package-json";
import type { DepStatus, Severity } from "./types";

const DEBOUNCE_MS = 600;

let decorator: DepDecorator;
let output: vscode.OutputChannel;
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let bunUnavailableWarned = false;

export function activate(context: vscode.ExtensionContext): void {
  decorator = new DepDecorator();
  output = vscode.window.createOutputChannel("Bun Deps");
  context.subscriptions.push(decorator, output);

  context.subscriptions.push(
    vscode.commands.registerCommand("bunDeps.refresh", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && isPackageJson(editor.document)) {
        refresh(editor).catch(reportError);
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && isPackageJson(editor.document)) {
        scheduleRefresh(editor);
      }
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      forEachEditor(doc, (editor) => scheduleRefresh(editor));
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("bunDeps")) {
        refreshAllVisible();
      }
    })
  );

  setupBackgroundRefresh(context);
  refreshAllVisible();
}

export function deactivate(): void {
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
}

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("bunDeps");
}

function isPackageJson(doc: vscode.TextDocument): boolean {
  return doc.languageId === "json" && doc.fileName.endsWith("package.json");
}

function forEachEditor(
  doc: vscode.TextDocument,
  fn: (editor: vscode.TextEditor) => void
): void {
  if (!isPackageJson(doc)) {
    return;
  }
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document === doc) {
      fn(editor);
    }
  }
}

function refreshAllVisible(): void {
  for (const editor of vscode.window.visibleTextEditors) {
    if (isPackageJson(editor.document)) {
      scheduleRefresh(editor);
    }
  }
}

function scheduleRefresh(editor: vscode.TextEditor): void {
  const key = editor.document.uri.toString();
  const existing = debounceTimers.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  debounceTimers.set(
    key,
    setTimeout(() => {
      debounceTimers.delete(key);
      refresh(editor).catch(reportError);
    }, DEBOUNCE_MS)
  );
}

async function refresh(editor: vscode.TextEditor): Promise<void> {
  const cfg = config();
  if (!cfg.get<boolean>("enable", true)) {
    decorator.clear(editor);
    return;
  }

  const doc = editor.document;
  const cwd = dirname(doc.uri.fsPath);
  const locations = findDependencyLocations(doc.getText());
  if (locations.length === 0) {
    decorator.clear(editor);
    return;
  }

  if (!(await ensureBunAvailable())) {
    return;
  }

  const depNames = [...new Set(locations.map((loc) => loc.name))];
  const severityThreshold = cfg.get<Severity>("severityThreshold", "high");

  let statuses: Map<string, DepStatus>;
  try {
    statuses = await analyze(cwd, depNames, severityThreshold);
  } catch (error) {
    if (error instanceof BunNotFoundError) {
      warnBunUnavailable(error.message);
      return;
    }
    output.appendLine(`Analysis failed: ${(error as Error).message}`);
    return;
  }

  if (editor.document.isClosed) {
    return;
  }
  decorator.render(
    editor,
    locations,
    statuses,
    cfg.get<boolean>("showInlineVersions", true)
  );
}

async function ensureBunAvailable(): Promise<boolean> {
  const version = await getBunVersion();
  if (version === null) {
    warnBunUnavailable('Could not find "bun" on PATH.');
    return false;
  }
  if (!isVersionAtLeast(version, MIN_BUN_VERSION)) {
    output.appendLine(
      `Bun ${version} is older than the supported minimum ${MIN_BUN_VERSION}; results may be incomplete.`
    );
  }
  return true;
}

function reportError(error: unknown): void {
  output.appendLine(`Unexpected error: ${(error as Error).message}`);
}

function warnBunUnavailable(message: string): void {
  output.appendLine(message);
  if (!bunUnavailableWarned) {
    bunUnavailableWarned = true;
    vscode.window.showWarningMessage(
      `Bun Deps: ${message} Install Bun or set it on PATH to enable annotations.`
    );
  }
}

function setupBackgroundRefresh(context: vscode.ExtensionContext): void {
  const schedule = () => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = undefined;
    }
    const minutes = config().get<number>("refreshIntervalMinutes", 15);
    if (minutes > 0) {
      refreshTimer = setInterval(refreshAllVisible, minutes * 60 * 1000);
    }
  };

  schedule();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("bunDeps.refreshIntervalMinutes")) {
        schedule();
      }
    }),
    { dispose: () => refreshTimer && clearInterval(refreshTimer) }
  );
}
