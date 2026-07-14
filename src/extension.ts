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
import { computeAnnotations } from "./installed";
import { findDependencyLocations } from "./package-json";
import type { DepStatus, Severity } from "./types";

const ANALYSIS_DEBOUNCE_MS = 600;
const RENDER_DEBOUNCE_MS = 200;

let decorator: DepDecorator;
let output: vscode.OutputChannel;
const analysisCache = new Map<string, Map<string, DepStatus>>();
const analysisTimers = new Map<string, ReturnType<typeof setTimeout>>();
const renderTimers = new Map<string, ReturnType<typeof setTimeout>>();
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let bunUnavailableWarned = false;

export function activate(context: vscode.ExtensionContext): void {
  decorator = new DepDecorator();
  output = vscode.window.createOutputChannel("Bun Deps");
  const lockWatcher = vscode.workspace.createFileSystemWatcher("**/bun.lock*");
  context.subscriptions.push(decorator, output, lockWatcher);

  context.subscriptions.push(
    vscode.commands.registerCommand("bunDeps.refresh", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && isPackageJson(editor.document)) {
        runAnalysis(editor).catch(reportError);
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && isPackageJson(editor.document)) {
        scheduleAnalysis(editor);
      }
    }),
    // Live edits re-render immediately (cheap, no network) so the pending-install
    // hint appears as you type; the registry data comes from the cache.
    vscode.workspace.onDidChangeTextDocument((event) => {
      forEachEditor(event.document, scheduleRender);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      forEachEditor(doc, scheduleAnalysis);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      analysisCache.delete(doc.uri.toString());
    }),
    // `bun i` (or any install) rewrites the lockfile — re-analyse so versions
    // and the pending hint reflect the new install.
    lockWatcher.onDidChange(refreshAllVisible),
    lockWatcher.onDidCreate(refreshAllVisible),
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
  for (const timer of [...analysisTimers.values(), ...renderTimers.values()]) {
    clearTimeout(timer);
  }
  analysisTimers.clear();
  renderTimers.clear();
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
      scheduleAnalysis(editor);
    }
  }
}

function debounce(
  timers: Map<string, ReturnType<typeof setTimeout>>,
  key: string,
  delay: number,
  fn: () => void
): void {
  const existing = timers.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      fn();
    }, delay)
  );
}

function scheduleAnalysis(editor: vscode.TextEditor): void {
  debounce(
    analysisTimers,
    editor.document.uri.toString(),
    ANALYSIS_DEBOUNCE_MS,
    () => runAnalysis(editor).catch(reportError)
  );
}

function scheduleRender(editor: vscode.TextEditor): void {
  debounce(
    renderTimers,
    editor.document.uri.toString(),
    RENDER_DEBOUNCE_MS,
    () => renderEditor(editor)
  );
}

// Cheap: re-parse the live text, recompute the pending-install hint from
// node_modules, and render using whatever registry data is already cached.
function renderEditor(editor: vscode.TextEditor): void {
  const cfg = config();
  if (!cfg.get<boolean>("enable", true)) {
    decorator.clear(editor);
    return;
  }

  const doc = editor.document;
  const locations = findDependencyLocations(doc.getText());
  if (locations.length === 0) {
    decorator.clear(editor);
    return;
  }

  const statuses = analysisCache.get(doc.uri.toString()) ?? new Map();
  const { pending, conflicts } = computeAnnotations(
    dirname(doc.uri.fsPath),
    locations
  );
  if (doc.isClosed) {
    return;
  }
  output.appendLine(
    `[render] ${doc.fileName}: ${locations.length} deps, ${statuses.size} analysed, ${pending.size} pending install, ${conflicts.size} catalog conflict(s)`
  );
  decorator.render(
    editor,
    locations,
    statuses,
    cfg.get<boolean>("showInlineVersions", true),
    pending,
    conflicts
  );
}

async function runAnalysis(editor: vscode.TextEditor): Promise<void> {
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
    output.appendLine(
      `[analyze] ${doc.fileName}: no dependency sections found`
    );
    return;
  }

  if (!(await ensureBunAvailable())) {
    return;
  }

  const depNames = [...new Set(locations.map((loc) => loc.name))];
  const severityThreshold = cfg.get<Severity>("severityThreshold", "high");
  output.appendLine(
    `[analyze] ${doc.fileName} in ${cwd}: checking ${depNames.length} dep(s)`
  );

  try {
    const statuses = await analyze(cwd, depNames, severityThreshold);
    analysisCache.set(doc.uri.toString(), statuses);
    const outdated = [...statuses.values()].filter((s) => s.outdated).length;
    const vulnerable = [...statuses.values()].filter(
      (s) => s.color === "red"
    ).length;
    output.appendLine(
      `[analyze] ${doc.fileName}: ${statuses.size} status(es), ${outdated} outdated, ${vulnerable} vulnerable`
    );
  } catch (error) {
    if (error instanceof BunNotFoundError) {
      warnBunUnavailable(error.message);
      return;
    }
    output.appendLine(`Analysis failed: ${(error as Error).message}`);
    return;
  }

  if (!doc.isClosed) {
    renderEditor(editor);
  }
}

async function ensureBunAvailable(): Promise<boolean> {
  const version = await getBunVersion();
  if (version === null) {
    warnBunUnavailable('Could not find "bun" on PATH.');
    return false;
  }
  output.appendLine(`[bun] detected version ${version}`);
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
  output.appendLine(`[bun] ${message}`);
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
