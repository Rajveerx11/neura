import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isolate } from './isolation.mjs';
import { pinnedPi } from './pinned-pi.mjs';
const scratch = isolate();
process.env.NEURA = '1';
process.env.PI_OFFLINE = '1';
const repo = path.resolve(import.meta.dirname, '../..');
pinnedPi(repo);
const { CommandLauncher, launcherActions, searchLauncher, registerCommandLauncher, LAUNCHER_SHORTCUT } = await import('../../agent/neura/command-launcher.ts');
const modes = await import('../../agent/neura/mode-state.ts');
const { patchCockpit } = await import('../../agent/neura/cockpit-state.ts');
const { TuiMainScreen, Input, Container, visibleWidth, CURSOR_MARKER } = await import('@earendil-works/pi-tui');
const { InteractiveMode, initTheme, createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import('@earendil-works/pi-coding-agent');
const { KeybindingsManager } = await import('../../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js');
initTheme('dark', false);
const keys = new KeybindingsManager();
const theme = { fg: (_color, value) => value };
const command = (name, source = 'extension', description = 'Public action') => ({ name, source, description, sourceInfo: { path: 'synthetic-hidden-state' } });
let registry = ['mode', 'health', 'ship', 'learn', 'undo', 'clip', 'launcher', 'mcp', 'skill-doctor', 'remember', 'memory'].map(name => command(name));
registry.push(command('writing', 'prompt'), command('skill:example', 'skill'), command('unsafe\n/health'), command('redacted', 'extension', 'Authorization: Bearer synthetic-launcher-secret'));
modes.setMode('work');
patchCockpit({ copy: { available: false, codeBlocks: 0 } });
let actions = launcherActions(registry, true);
assert.equal(actions.filter(item => item.mode).length, modes.MODES.length);
assert.deepEqual(searchLauncher(actions, 'human-away').map(item => item.command), ['/mode human-away']);
assert.match(searchLauncher(actions, 'human-away')[0].description, /PREVIEW/);
assert.ok(searchLauncher(actions, 'shift+tab').every(item => item.name === 'mode'));
assert.equal(searchLauncher(actions, LAUNCHER_SHORTCUT)[0].name, 'launcher');
assert.equal(searchLauncher(actions, 'Public action').length > 0, true);
assert.equal(searchLauncher(actions, 'nonsense').length, 0);
assert.equal(actions.some(item => item.name.includes('\n')), false);
assert.doesNotMatch(JSON.stringify(actions), /synthetic-hidden-state|synthetic-launcher-secret/);
assert.equal(searchLauncher(actions, 'ctrl+shift+x').length, 0);
patchCockpit({ copy: { available: true, codeBlocks: 1 } });
assert.equal(searchLauncher(launcherActions(registry, true), 'ctrl+shift+x')[0].name, 'clip');
for (const mode of modes.MODES) {
  modes.setMode(mode);
  actions = launcherActions(registry, true);
  for (const name of ['health', 'undo', 'mcp', 'remember', 'memory']) {
    assert.equal(Boolean(actions.find(item => item.name === name).disabled), mode !== 'yolo');
  }
  assert.equal(actions.find(item => item.name === 'skill-doctor').disabled, undefined, `read-only skill-doctor unavailable in ${mode}`);
  assert.equal(Boolean(actions.find(item => item.name === 'ship').disabled), !['work', 'yolo'].includes(mode));
  assert.equal(Boolean(actions.find(item => item.name === 'learn').disabled), mode !== 'learn');
}
modes.setMode('yolo');
const release = modes.acquireHostOperation();
assert.ok(launcherActions(registry, true).every(item => /host operation/.test(item.disabled)));
const draining = modes.restoreMode('work');
assert.ok(launcherActions(registry, true).every(item => /draining/.test(item.disabled)));
release();
await draining;
assert.ok(launcherActions(registry, false).every(item => /active turn/.test(item.disabled)));

// Native Pi custom-screen host + native TUI on a synthetic terminal, no live UI.
const terminal = { columns: 80, rows: 24, kittyProtocolActive: false, write() {}, hideCursor() {}, showCursor() {} };
const tui = new TuiMainScreen(terminal);
tui.requestRender = () => {};
const editor = new Input();
editor.getText = () => editor.getValue();
editor.setText = value => editor.setValue(value);
const editorContainer = new Container();
editorContainer.addChild(editor);
tui.addChild(editorContainer);
tui.setFocus(editor);
const host = { ui: tui, editor, editorContainer, keybindings: keys, disposeActiveSelector() {} };
let component;
const custom = (factory, options) => InteractiveMode.prototype.showExtensionCustom.call(host, (t, th, kb, done) => {
  component = factory(t, th, kb, done);
  return component;
}, options);
const tick = () => new Promise(resolve => setImmediate(resolve));
const type = text => { for (const char of text) component.handleInput(char); };
async function screen(read) {
  const result = custom((t, th, kb, done) => new CommandLauncher(t, th, kb, read, done));
  await tick();
  assert.equal(editor.focused, false);
  assert.equal(component.focused, true);
  assert.ok(component.render(80).join('').includes(CURSOR_MARKER), 'IME cursor not propagated');
  return { result };
}
let source = [command('alpha'), command('beta'), command('gamma')];
const read = () => launcherActions(source, true);
editor.setValue('unsent draft');
let screenResult = await screen(read);
for (const width of [1, 2, 8, 24, 40, 80, 120]) {
  const lines = component.render(width);
  assert.ok(lines.length <= 10);
  assert.ok(lines.every(line => visibleWidth(line) <= width), `overflow at ${width}`);
  component.invalidate();
  assert.deepEqual(component.render(width), lines, 'motion-free rendering changed without input');
}
component.handleInput('\x1b[B');
component.handleInput('\r');
assert.equal((await screenResult.result).name, 'beta');
assert.equal(editor.focused, true);
assert.equal(editor.getValue(), 'unsent draft');
screenResult = await screen(read);
component.handleInput('\x1b[A');
component.handleInput('\r');
assert.equal((await screenResult.result).name, 'gamma', 'native wrapping navigation');
screenResult = await screen(read);
component.handleInput('\x1b[6~');
component.handleInput('\r');
assert.equal((await screenResult.result).name, 'gamma', 'page-down navigation');
screenResult = await screen(read);
component.handleInput('\x1b[6~');
component.handleInput('\x1b[5~');
component.handleInput('\r');
assert.equal((await screenResult.result).name, 'alpha', 'page-up navigation');
screenResult = await screen(read);
type('不存在');
assert.match(component.render(80).join(''), /No matching commands/);
component.handleInput('\r');
assert.equal(component.focused, true, 'empty selection closed screen');
component.handleInput('\x1b');
assert.equal(await screenResult.result, undefined);
assert.equal(editor.focused, true);
screenResult = await screen(read);
source = [command('beta')];
component.handleInput('\r');
assert.equal(component.focused, true, 'removed selected command invoked another action');
component.handleInput('\x1b');
await screenResult.result;
// #38 makes skill-doctor read-only; registry descriptions are not authorization.
source = [command('skill-doctor', 'extension', 'Legacy description: requires YOLO')];
for (const mode of ['work', 'plan', 'yolo']) {
  modes.setMode(mode);
  screenResult = await screen(read);
  type('skill-doctor');
  assert.doesNotMatch(component.render(80).join(''), /\[disabled\]/);
  component.handleInput('\r');
  assert.equal((await screenResult.result).command, '/skill-doctor', `skill-doctor selection failed in ${mode}`);
  assert.equal(editor.focused, true);
}
source = [command('health')];
modes.setMode('yolo');
screenResult = await screen(read);
modes.setMode('plan');
component.handleInput('\r');
assert.match(component.render(80).join(''), /Requires YOLO/);
assert.equal(component.focused, true);
component.handleInput('\x03');
await screenResult.result;
assert.equal(editor.focused, true);

// Supported API wiring: dispatch options, stale post-close checks, redacted failures,
// draft protection, duplicate open, non-TUI and session invalidation.
let commandHandler, shortcutHandler, sent = [], notifications = [], events = new Map();
let failDispatch = false;
let idle = true;
const api = {
  getCommands: () => source,
  registerCommand(_name, definition) { commandHandler = definition.handler; },
  registerShortcut(key, definition) { assert.equal(key, LAUNCHER_SHORTCUT); shortcutHandler = definition.handler; },
  on(name, handler) { events.set(name, handler); },
  sendUserMessage(text, options) { if (failDispatch) throw Error('synthetic-private-error'); sent.push({ text, options }); },
};
registerCommandLauncher(api);
const ui = { custom, getEditorText: () => editor.getValue(), setEditorText: value => editor.setValue(value), notify: (message, level) => notifications.push({ message, level }) };
const ctx = { mode: 'tui', hasUI: true, ui, isIdle: () => idle };
modes.setMode('work');
source = [command('alpha')];
let pending = shortcutHandler(ctx);
await tick();
await commandHandler('', ctx); // already open, does not create another screen
component.handleInput('\r');
await pending;
assert.deepEqual(sent, [{ text: '/alpha', options: { expandPromptTemplates: true } }]);
assert.equal(editor.getValue(), 'unsent draft');
assert.equal(editor.focused, true);
failDispatch = true;
pending = commandHandler('', ctx);
await tick();
component.handleInput('\r');
await pending;
assert.equal(notifications.at(-1).level, 'error');
assert.doesNotMatch(JSON.stringify(notifications), /synthetic-private-error/);
assert.equal(editor.focused, true);
failDispatch = false;
for (const sourceType of ['prompt', 'skill']) {
  source = [command(sourceType === 'skill' ? 'skill:example' : 'writing', sourceType)];
  pending = commandHandler('', ctx);
  await tick();
  component.handleInput('\r');
  await pending;
  assert.equal(editor.getValue(), 'unsent draft', 'staging overwrote draft');
  editor.setValue('  ');
  pending = commandHandler('', ctx);
  await tick();
  component.handleInput('\r');
  await pending;
  assert.equal(editor.getValue(), '  ', 'staging overwrote whitespace draft');
  editor.setValue('');
  pending = commandHandler('', ctx);
  await tick();
  component.handleInput('\r');
  await pending;
  assert.equal(editor.getValue(), `/${source[0].name} `);
  assert.equal(sent.length, 1, 'prompt/skill executed automatically');
  editor.setValue('unsent draft');
}
source = [command('alpha')];
pending = commandHandler('', ctx);
await tick();
component.handleInput('\r');
source = []; // registry changes between closing UI and dispatch
await pending;
assert.equal(sent.length, 1);
source = [command('alpha')];
pending = commandHandler('', ctx);
await tick();
component.handleInput('\r');
idle = false;
await pending;
assert.equal(sent.length, 1);
idle = true;
for (const event of ['session_start', 'session_shutdown']) {
  pending = commandHandler('', ctx);
  await tick();
  events.get(event)();
  await pending;
  assert.equal(editor.focused, true);
  assert.equal(sent.length, 1);
}
await commandHandler('', { ...ctx, mode: 'rpc' });
await shortcutHandler({ ...ctx, hasUI: false });
assert.equal(sent.length, 1);

// Real pinned Pi loader/session registry and normal command dispatch, no model calls.
const cwd = path.join(scratch, 'workspace');
fs.mkdirSync(path.join(cwd, '.pi/prompts'), { recursive: true });
fs.writeFileSync(path.join(cwd, '.pi/prompts/writing.md'), '---\ndescription: Synthetic writing template\n---\nSynthetic prompt.');
const agentDir = process.env.PI_CODING_AGENT_DIR;
const settingsManager = SettingsManager.inMemory({ packages: [] }, { projectTrusted: true });
const modelRuntime = await ModelRuntime.create({ authPath: path.join(agentDir, 'synthetic-auth.json'), modelsPath: null, refreshOnCreate: false });
let executions = 0;
const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, noContextFiles: true, noSkills: true, noThemes: true,
  additionalExtensionPaths: [path.join(repo, 'agent/extensions/modes.ts'), path.join(repo, 'agent/extensions/neura.ts')],
  disabledBuiltinExtensions: ['mcp'],
  extensionFactories: [pi => {
    pi.registerCommand('fixture', { description: 'Synthetic action', handler: async () => { executions++; } });
    pi.registerCommand('fixture_error', { description: 'Synthetic failure', handler: async () => { throw Error('synthetic handler failure'); } });
  }],
});
await loader.reload();
assert.deepEqual(loader.getExtensions().errors, []);
const { session } = await createAgentSession({ cwd, agentDir, modelRuntime, settingsManager, resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd), model: modelRuntime.getModels()[0] });
let confirmation = false, confirmations = 0;
const errors = [];
await session.bindExtensions({ mode: 'tui', uiContext: {
  ...ui, theme, setTitle() {}, setWidget() {}, setStatus() {}, setEditorComponent() {}, getEditorComponent() {}, getTheme() {},
  confirm: async () => { confirmations++; return confirmation; },
}, onError: error => errors.push(error) });
async function invoke(query) {
  const opened = session.sendUserMessage('/launcher', { expandPromptTemplates: true });
  await tick();
  type(query);
  component.handleInput('\r');
  await opened;
  await tick();
}
try {
  await invoke('fixture Synthetic action');
  assert.equal(executions, 1, 'normal extension dispatch failed');
  await invoke('mode yolo');
  assert.equal(confirmations, 1);
  assert.equal(modes.getMode(), 'work', 'launcher bypassed rejected YOLO confirmation');
  confirmation = true;
  await invoke('mode yolo');
  assert.equal(confirmations, 2);
  assert.equal(modes.getMode(), 'yolo');
  await invoke('mode plan');
  assert.equal(modes.getMode(), 'plan');
  for (const tool of ['write', 'edit']) assert.equal(session.getActiveToolNames().includes(tool), false, `launcher bypassed Plan boundary for ${tool}`);
  editor.setValue('');
  await invoke('writing');
  assert.equal(editor.getValue(), '/writing ');
  assert.equal(session.messages.length, 0, 'prompt staging triggered a model turn');
  await invoke('fixture_error');
  assert.ok(errors.some(error => error.error.includes('synthetic handler failure')), 'Pi did not report async handler error');
  assert.equal(editor.focused, true);
  const opened = session.sendUserMessage('/launcher', { expandPromptTemplates: true });
  await tick();
  type('new');
  assert.match(component.render(80).join(''), /No matching commands/, 'invented built-in registry entry');
  component.handleInput('\x1b');
  await opened;
} finally {
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' });
  session.dispose();
}
delete process.env.NEURA;
await loader.reload();
assert.equal(loader.getExtensions().extensions.some(extension => extension.commands.has('launcher')), false, 'plain Pi gained launcher');
assert.equal(loader.getExtensions().extensions.some(extension => extension.shortcuts.has(LAUNCHER_SHORTCUT)), false);
console.log('PASS launcher: public registry/search, mode availability, native keyboard/IME/focus/width/no-motion, stale state, dispatch/staging/errors, real loader/YOLO confirmation, stock Pi');
