#!/usr/bin/env bash
# Run the bundled extension under Node with editor/process adapters, no VS Code download.
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
build=$(mktemp -d "${TMPDIR:-/tmp}/bun-deps-lifecycle.XXXXXX")
trap 'rm -rf "$build"' EXIT
bun build "$repo/src/extension.ts" --target node --format cjs --external vscode --outfile "$build/extension.cjs" >/dev/null
node - "$build/extension.cjs" <<'JS'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const realReadFile = fsPromises.readFile;
let trackLockReads = false;
let lockReads = 0;
let trackManifestReads = false;
const manifestReads = [];
fsPromises.readFile = function(file, ...args) {
  if (trackLockReads && String(file).endsWith('/bun.lock')) lockReads++;
  if (trackManifestReads && String(file).includes('/node_modules/') && String(file).endsWith('/package.json')) manifestReads.push(String(file));
  return realReadFile.call(this, file, ...args);
};
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const childProcess = require('node:child_process');
const { promisify } = require('node:util');
let trackAsync = false;
let asyncCalls = 0;
for (const name of Object.keys(fsPromises).filter(name => typeof fsPromises[name] === 'function')) {
  const original = fsPromises[name];
  fsPromises[name] = function(...args) { if (trackAsync) asyncCalls++; return original.apply(this, args); };
}
const realTimeout = global.setTimeout;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bun-deps-editor-'));
const timers = new Map();
const intervals = new Map();
let timerId = 0;
global.setTimeout = (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; };
global.clearTimeout = id => timers.delete(id);
global.setInterval = (fn, delay) => { const id = ++timerId; intervals.set(id, { fn, delay }); return id; };
global.clearInterval = id => intervals.delete(id);
const events = {};
const providers = {};
const commands = [];
const configurationListeners = [];
const openDocuments = new Map();
const disposable = () => ({ dispose() {} });
const listen = key => fn => { events[key] = fn; return disposable(); };
const registerProvider = key => (_, provider) => { providers[key] = provider; return disposable(); };
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(...args) {
    if (args.length === 2) [this.start, this.end] = args;
    else { this.start = new Position(args[0], args[1]); this.end = new Position(args[2], args[3]); }
  }
  intersection() { return this; }
}
class MarkdownString { constructor(value) { this.value = value; } }
class ThemeColor { constructor(id) { this.id = id; } }
class Location { constructor(uri, range) { this.uri = uri; this.range = range; } }
const fileUri = fsPath => ({ scheme: 'file', fsPath, toString() { return `file://${this.fsPath}`; } });
let text = JSON.stringify({ dependencies: { foo: '1.0.0' } }, null, 2);
let textReads = 0;
const doc = {
  getText() { textReads++; return text; },
  lineAt(line) { return { text: text.split('\n')[line] }; },
  fileName: path.join(root, 'package.json'),
  languageId: 'json',
  version: 1,
  isClosed: false,
  uri: fileUri(path.join(root, 'package.json'))
};
const editor = () => ({ document: doc, buckets: new Map(), setDecorations(type, values) { this.buckets.set(type.color.id, values); } });
const editors = [editor(), editor()];
const vscode = {
  Position, Range, MarkdownString, ThemeColor, Location,
  Uri: { file: fileUri },
  CodeActionKind: { QuickFix: 'quickfix' },
  window: {
    visibleTextEditors: editors,
    activeTextEditor: editors[0],
    createTextEditorDecorationType: options => ({ ...options, dispose() {} }),
    createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
    onDidChangeActiveTextEditor: listen('active'),
    showWarningMessage() {}
  },
  workspace: {
    openTextDocument: async uri => { const document = openDocuments.get(uri.toString()); assert.ok(document, 'expected an already-open root buffer'); return document; },
    createFileSystemWatcher: () => ({ onDidChange: listen('lockChange'), onDidCreate: listen('lockCreate'), onDidDelete: listen('lockDelete'), dispose() {} }),
    getConfiguration: () => ({ get: (name, fallback) => name === 'refreshIntervalMinutes' ? 0 : fallback }),
    onDidChangeTextDocument: listen('edit'),
    onDidSaveTextDocument: listen('save'),
    onDidCloseTextDocument: listen('close'),
    onDidChangeWorkspaceFolders: listen('folders'),
    onDidChangeConfiguration: fn => { configurationListeners.push(fn); return disposable(); }
  },
  languages: {
    registerDefinitionProvider: registerProvider('definition'),
    registerCodeActionsProvider: registerProvider('actions'),
    registerInlayHintsProvider: registerProvider('inlay')
  },
  commands: { registerCommand: (key, fn) => { events[key] = fn; return disposable(); } }
};
const originalLoad = Module._load;
Module._load = function(name, ...args) { return name === 'vscode' ? vscode : originalLoad.call(this, name, ...args); };
const execFile = () => { throw new Error('Use the promisified process adapter'); };
execFile[promisify.custom] = async (_, args) => {
  commands.push(args);
  return { stdout: args[0] === '--version' ? '1.4.2' : args[0] === 'audit' ? '{}' : '', stderr: '' };
};
childProcess.execFile = execFile;
let trackSync = false;
let syncCalls = 0;
for (const name of Object.keys(fs).filter(name => name.endsWith('Sync') && typeof fs[name] === 'function')) {
  const original = fs[name];
  fs[name] = function(...args) { if (trackSync) syncCalls++; return original.apply(this, args); };
}
function install(name, version) {
  const dir = path.join(root, 'node_modules', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version }));
}
function flush(delay) {
  for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.fn(); }
}
function pending(editor) {
  return pendingOnLine(editor);
}
function pendingOnLine(editor, line) {
  return [...editor.buckets.values()].flat().some(item => (line === undefined || item.range.start.line === line) && item.renderOptions?.after?.contentText.includes('run bun i'));
}
async function waitFor(predicate, message = 'Timed out waiting for extension callback') {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise(resolve => realTimeout(resolve, 5));
  }
}
(async () => {
  const extension = require(process.argv[2]);
  const context = { subscriptions: [] };
  try {
    install('foo', '1.0.0');
    extension.activate(context);
    flush(600);
    await waitFor(() => commands.length === 3 && editors.every(editor => editor.buckets.get('charts.green')?.length === 1));
    assert.equal(textReads, 1, 'initial snapshot, analysis and split renders share one parse');
    assert.equal(intervals.size, 1, 'local revalidation runs even with registry interval disabled');
    assert.equal([...intervals.values()][0].delay, 30000);

    text = JSON.stringify({ dependencies: { foo: '2.0.0' } }, null, 2);
    doc.version++;
    textReads = 0;
    trackSync = true;
    trackAsync = true;
    events.edit({ document: doc });
    flush(200);
    await waitFor(() => editors.every(pending));
    const range = new Range(0, 0, 10, 0);
    providers.actions.provideCodeActions(doc, range);
    providers.inlay.provideInlayHints(doc, range);
    await providers.definition.provideDefinition(doc, new Position(2, 14));
    trackSync = false;
    trackAsync = false;
    assert.equal(asyncCalls, 0, 'known-name warm edits perform no asynchronous filesystem operations either');
    assert.equal(syncCalls, 0, 'warm edits and provider requests do no synchronous filesystem I/O');
    assert.equal(textReads, 1, 'both split editors and providers share the new document parse');
    assert.equal(commands.length, 3, 'editing does not query the registry');

    for (const listener of configurationListeners) listener({ affectsConfiguration: section => section === 'bunDeps' });
    doc.version++;
    events.edit({ document: doc });
    flush(200);
    assert.ok(editors.every(pending), 'settings changes retain the cached installed version until a real refresh');

    events.close({ ...doc, languageId: 'markdown', fileName: path.join(root, 'README.md'), uri: { fsPath: path.join(root, 'README.md'), toString: () => `file://${root}/README.md` } });
    doc.version++;
    events.edit({ document: doc });
    flush(200);
    assert.ok(editors.every(pending), 'closing an unrelated buffer must not evict the warm package snapshot');

    install('foo', '2.0.0');
    [...intervals.values()][0].fn();
    await waitFor(() => editors.every(editor => !pending(editor)));
    assert.equal(commands.length, 3, 'local revalidation does not query the registry');

    install('bar', '3.0.0');
    trackManifestReads = true;
    text = JSON.stringify({ dependencies: { foo: '2.0.0', bar: '4.0.0' } }, null, 2);
    doc.version++;
    events.edit({ document: doc });
    flush(200);
    assert.ok(editors.every(editor => !pendingOnLine(editor, 3)), 'a new name remains unknown until its async load finishes');
    await waitFor(() => editors.every(editor => pendingOnLine(editor, 3)), 'new-name bar must become pending after its manifest load');
    assert.deepEqual(manifestReads, [path.join(root, 'node_modules', 'bar', 'package.json')], 'adding one name reads only that new manifest, even with split editors');
    trackManifestReads = false;
    text = JSON.stringify({ dependencies: { foo: '2.0.0', bar: '3.0.0' } }, null, 2);
    doc.version++;
    events.edit({ document: doc });
    flush(200);
    assert.ok(editors.every(editor => !pendingOnLine(editor, 3)), 'a range edit immediately uses the newly loaded installed version');

    install('foo', '3.0.0');
    events.lockDelete();
    flush(200);
    assert.ok(editors.every(editor => [...editor.buckets.values()].flat().length > 0), 'cached registry decorations stay visible during the async install reload');
    await waitFor(() => editors.every(editor => pendingOnLine(editor, 2)));
    assert.equal(commands.length, 3, 'install invalidation renders locally before queued registry work');

    const gitDoc = { ...doc, isClosed: true, uri: { scheme: 'git', fsPath: doc.uri.fsPath, toString() { return `git:${this.fsPath}?ref=HEAD`; } } };
    asyncCalls = 0;
    trackAsync = true;
    events.close(gitDoc);
    doc.version++;
    events.edit({ document: doc });
    flush(200);
    assert.ok(editors.every(editor => pendingOnLine(editor, 2)), 'closing a Git diff retains the working copy installed snapshot');
    trackAsync = false;
    assert.equal(asyncCalls, 0, 'the working edit after Git-buffer close remains memory-only');
    const virtualDoc = { ...gitDoc, isClosed: false, getText() { throw new Error('virtual buffers must not enter working-snapshot analysis'); } };
    const virtualEditor = { ...editor(), document: virtualDoc };
    vscode.window.visibleTextEditors = [virtualEditor];
    const timerCount = timers.size;
    events.active(virtualEditor);
    events.edit({ document: virtualDoc });
    events.save(virtualDoc);
    assert.equal(timers.size, timerCount, 'virtual buffers do not schedule working-copy analysis or rendering');
    [...intervals.values()][0].fn();
    vscode.window.visibleTextEditors = editors;
    doc.version++;
    trackAsync = true;
    events.edit({ document: doc });
    flush(200);
    assert.ok(editors.every(editor => pendingOnLine(editor, 2)), 'virtual views cannot replace working-copy snapshot names');
    trackAsync = false;
    assert.equal(asyncCalls, 0);

    text = JSON.stringify({ workspaces: { catalog: { foo: '^1.0.0' }, catalogs: { build: { bar: '^3.0.0' } } } }, null, 2);
    doc.version++;
    openDocuments.set(doc.uri.toString(), doc);
    fs.writeFileSync(doc.fileName, JSON.stringify({ workspaces: { catalog: { foo: '^0.0.1' } } }));
    fs.writeFileSync(path.join(root, 'bun.lock'), JSON.stringify({ packages: {}, workspaces: {} }));
    const consumerDir = path.join(root, 'packages', 'app');
    fs.mkdirSync(consumerDir, { recursive: true });
    const consumer = {
      getText: () => JSON.stringify({ dependencies: { foo: 'catalog:', bar: 'catalog:build' } }, null, 2),
      uri: fileUri(path.join(consumerDir, 'package.json')),
      version: 1
    };
    trackLockReads = true;
    const defaultDefinition = await providers.definition.provideDefinition(consumer, new Position(2, 14));
    assert.equal(defaultDefinition?.uri.toString(), doc.uri.toString());
    assert.equal(defaultDefinition?.range.start.line, 3);
    assert.equal(lockReads, 0, 'catalog navigation locates the lockfile without reading its contents');
    const namedDefinition = await providers.definition.provideDefinition(consumer, new Position(3, 14));
    assert.equal(namedDefinition?.range.start.line, 7);
    text = text.replace('^1.0.0', '^2.0.0');
    doc.version++;
    const unsavedDefinition = await providers.definition.provideDefinition(consumer, new Position(2, 14));
    assert.equal(text.split('\n')[3].slice(unsavedDefinition.range.start.character, unsavedDefinition.range.end.character), '"^2.0.0"');
    assert.equal(lockReads, 0, 'repeated catalog requests and unsaved edits never parse the lockfile');
    fs.rmSync(path.join(root, 'bun.lock'));
    fs.writeFileSync(path.join(root, 'bun.lockb'), 'binary lock');
    assert.equal(await providers.definition.provideDefinition(consumer, new Position(2, 14)), undefined, 'binary locks retain the unsupported-catalog behavior');
    assert.equal(lockReads, 0);
    trackLockReads = false;

    doc.isClosed = true;
    doc.languageId = 'jsonc';
    events.close(doc);
    assert.equal(timers.size, 0, 'close clears pending document callbacks');
    extension.deactivate();
    for (const subscription of context.subscriptions) subscription.dispose();
    assert.equal(intervals.size, 0, 'deactivation disposes local refresh');
    console.log('Extension lifecycle passed: zero-I/O warm edits, shared parsing, cached colors, incremental names, local polling, path-only catalog navigation, virtual-buffer isolation and disposal.');
  } finally {
    extension.deactivate();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
JS
