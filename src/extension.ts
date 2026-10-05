import { basename, dirname } from "node:path";
import * as vscode from "vscode";
import { analyze } from "./analyzer";
import { BumpCodeActionProvider } from "./bump-code-action-provider";
import { bumpToLatest } from "./bump-command";
import { BumpInlayHintsProvider } from "./bump-inlay-hints-provider";
import {
  BunNotFoundError,
  getBunVersion,
  isVersionAtLeast,
  MIN_BUN_VERSION,
} from "./bun/runner";
import { CatalogDefinitionProvider } from "./catalog-definition-provider";
import { DepDecorator } from "./decorations";
import { dependencyLocations } from "./document-locations";
import { computeAnnotations } from "./installed";
import {
  type InstalledSnapshot,
  InstalledSnapshotCache,
} from "./installed-snapshot";
import { revealCatalogDefinition } from "./reveal-catalog-definition-command";
import type { DepStatus, Severity } from "./types";

const ANALYSIS_DEBOUNCE_MS = 600;
const RENDER_DEBOUNCE_MS = 200;
const INSTALLED_REFRESH_MS = 30_000;
const installedSnapshots = new InstalledSnapshotCache();

let decorator: DepDecorator;
let bumpHints: BumpInlayHintsProvider;
let output: vscode.OutputChannel;
const analysisCache = new Map<string, Map<string, DepStatus>>();
const analysisTimers = new Map<string, ReturnType<typeof setTimeout>>();
const renderTimers = new Map<string, ReturnType<typeof setTimeout>>();
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let installedRefreshTimer: ReturnType<typeof setInterval> | undefined;
let bunUnavailableWarned = false;

export function activate(context: vscode.ExtensionContext): void {
  decorator = new DepDecorator();
  bumpHints = new BumpInlayHintsProvider(getCachedStatuses);
  output = vscode.window.createOutputChannel("Bun Deps");
  const lockWatcher = vscode.workspace.createFileSystemWatcher("**/bun.lock*");
  context.subscriptions.push(decorator, bumpHints, output, lockWatcher);

  const packageJsonSelector: vscode.DocumentFilter = {
    language: "json",
    pattern: "**/package.json",
  };
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      packageJsonSelector,
      new CatalogDefinitionProvider()
    ),
    vscode.languages.registerCodeActionsProvider(
      packageJsonSelector,
      new BumpCodeActionProvider(getCachedStatuses),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    ),
    vscode.languages.registerInlayHintsProvider(packageJsonSelector, bumpHints),
    vscode.commands.registerCommand("bunDeps.bumpToLatest", (args) =>
      bumpToLatest(args).catch(reportError)
    ),
    vscode.commands.registerCommand("bunDeps.revealCatalogDefinition", (args) =>
      revealCatalogDefinition(args).catch(reportError)
    ),
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
      forEachEditor(doc, scheduleRender);
      forEachEditor(doc, scheduleAnalysis);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (basename(doc.fileName) !== "package.json") {
        return;
      }
      const key = doc.uri.toString();
      analysisCache.delete(key);
      bumpHints.refresh();
      dependencyLocations.delete(key);
      if (doc.uri.scheme === "file") {
        installedSnapshots.delete(dirname(doc.uri.fsPath));
      }
      for (const timers of [analysisTimers, renderTimers]) {
        clearTimeout(timers.get(key));
        timers.delete(key);
      }
    }),
    // `bun i` (or any install) rewrites the lockfile — re-analyse so versions
    // and the pending hint reflect the new install.
    lockWatcher.onDidChange(invalidateInstalled),
    lockWatcher.onDidCreate(invalidateInstalled),
    lockWatcher.onDidDelete(invalidateInstalled),
    vscode.workspace.onDidChangeWorkspaceFolders(invalidateInstalled),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("bunDeps")) {
        bumpHints.refresh();
        refreshAllVisible();
      }
    })
  );

  setupBackgroundRefresh(context);
  installedRefreshTimer = setInterval(
    refreshVisibleInstalled,
    INSTALLED_REFRESH_MS
  );
  context.subscriptions.push({
    dispose: () => {
      clearInterval(installedRefreshTimer);
      installedSnapshots.clear();
      dependencyLocations.clear();
    },
  });
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
  clearInterval(installedRefreshTimer);
  installedSnapshots.clear();
  dependencyLocations.clear();
  analysisCache.clear();
}

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("bunDeps");
}

function getCachedStatuses(uri: string): Map<string, DepStatus> | undefined {
  return analysisCache.get(uri);
}

function isPackageJson(doc: vscode.TextDocument): boolean {
  // Virtual revisions share fsPath but must not own working-copy snapshots.
  return (
    doc.uri.scheme === "file" &&
    doc.languageId === "json" &&
    basename(doc.fileName) === "package.json"
  );
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

function invalidateInstalled(): void {
  installedSnapshots.clear();
  for (const editor of vscode.window.visibleTextEditors) {
    if (isPackageJson(editor.document)) {
      scheduleRender(editor);
    }
  }
  refreshAllVisible();
}

function refreshVisibleInstalled(): void {
  if (!config().get<boolean>("enable", true)) {
    return;
  }
  const documents = new Set(
    vscode.window.visibleTextEditors.map((editor) => editor.document)
  );
  for (const doc of documents) {
    if (isPackageJson(doc) && dependencyLocations.get(doc).length > 0) {
      refreshInstalled(doc).catch(reportError);
    }
  }
}

async function refreshInstalled(
  doc: vscode.TextDocument
): Promise<InstalledSnapshot | undefined> {
  if (doc.isClosed) {
    return;
  }
  const snapshot = await installedSnapshots.refresh(
    dirname(doc.uri.fsPath),
    dependencyLocations.get(doc)
  );
  if (snapshot !== undefined && !doc.isClosed) {
    renderDocument(doc);
  }
  return snapshot;
}

function renderDocument(doc: vscode.TextDocument): void {
  if (doc.isClosed) {
    return;
  }
  const locations = dependencyLocations.get(doc);
  if (locations.length === 0) {
    installedSnapshots.delete(dirname(doc.uri.fsPath));
  }
  if (locations.length === 0 || !config().get<boolean>("enable", true)) {
    forEachEditor(doc, (editor) => decorator.clear(editor));
    return;
  }
  const { snapshot, loading } = installedSnapshots.ensure(
    dirname(doc.uri.fsPath),
    locations
  );
  loading
    ?.then((loaded) => {
      if (loaded !== undefined && !doc.isClosed) {
        renderDocument(doc);
      }
    })
    .catch(reportError);
  forEachEditor(doc, (editor) => renderEditor(editor, snapshot));
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
    () => renderDocument(editor.document)
  );
}

// Warm edits only consult versioned document locations and installed snapshots.
function renderEditor(
  editor: vscode.TextEditor,
  snapshot?: InstalledSnapshot
): void {
  const cfg = config();
  if (!cfg.get<boolean>("enable", true)) {
    decorator.clear(editor);
    return;
  }

  const doc = editor.document;
  if (doc.isClosed) {
    return;
  }
  const locations = dependencyLocations.get(doc);
  if (locations.length === 0) {
    decorator.clear(editor);
    return;
  }

  const statuses = analysisCache.get(doc.uri.toString()) ?? new Map();
  const { pending, conflicts, unusedCatalogs, catalogConsumerCounts } =
    computeAnnotations(snapshot ?? { installed: new Map() }, locations);
  output.appendLine(
    `[render] ${doc.fileName}: ${locations.length} deps, ${statuses.size} analysed, ${pending.size} pending install, ${conflicts.size} catalog conflict(s), ${unusedCatalogs.size} unused catalog(s)`
  );
  decorator.render(
    editor,
    locations,
    statuses,
    cfg.get<boolean>("showInlineVersions", true),
    pending,
    conflicts,
    unusedCatalogs,
    catalogConsumerCounts
  );
}

async function runAnalysis(editor: vscode.TextEditor): Promise<void> {
  const cfg = config();
  if (!cfg.get<boolean>("enable", true)) {
    decorator.clear(editor);
    return;
  }

  const doc = editor.document;
  if (doc.isClosed) {
    return;
  }
  const cwd = dirname(doc.uri.fsPath);
  const locations = dependencyLocations.get(doc);
  if (locations.length === 0) {
    installedSnapshots.delete(cwd);
    decorator.clear(editor);
    output.appendLine(
      `[analyze] ${doc.fileName}: no dependency sections found`
    );
    return;
  }

  const snapshot = await refreshInstalled(doc);
  if (snapshot === undefined || doc.isClosed || !(await ensureBunAvailable())) {
    return;
  }

  const depNames = [...new Set(locations.map((loc) => loc.name))];
  const severityThreshold = cfg.get<Severity>("severityThreshold", "high");
  output.appendLine(
    `[analyze] ${doc.fileName} in ${cwd}: checking ${depNames.length} dep(s)`
  );

  try {
    const statuses = await analyze(cwd, locations, severityThreshold, snapshot);
    if (doc.isClosed) {
      return;
    }
    analysisCache.set(doc.uri.toString(), statuses);
    bumpHints.refresh();
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
    renderDocument(doc);
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
