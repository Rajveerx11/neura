// Repository-owned guidance only. Validation restricts eligibility; it never grants authority.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const skillRoot = path.dirname(fileURLToPath(import.meta.url));
export const selectionPath = () => path.join(os.homedir(), '.pi', 'neura-skills.json');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(`skill validation: ${code}`); };
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

function unlinked(file) {
  // lstat rejects Windows junctions as well as symlinks, including dangling links.
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) fail('linked path'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current === path.dirname(current)) break;
  }
}

export function validateSkillText(text, name, availableTools = ['read']) {
  const frontmatter = /^---\r?\nname: ([a-z0-9-]+)\r?\ndescription: ([^\r\n]+)\r?\n---\r?\n/.exec(text);
  if (!frontmatter || frontmatter[1] !== name || frontmatter[2].length > 1024 || !/^[A-Za-z][A-Za-z0-9 ,;().-]+$/.test(frontmatter[2])) fail('invalid skill metadata');
  if (!availableTools.includes('read') || /\bmcp__|\b(Artifact|AskUserQuestion|ToolSearch|Workflow)\b|\b(?:tool|tools):\s*(?!read\b)\w+/i.test(text)) fail('unavailable tool');
  for (const match of text.matchAll(/\b(?:use|call|invoke)\s+(?:the\s+)?([a-z][\w-]*)\s+tool\b/gi)) {
    if (match[1].toLowerCase() !== 'read' || !availableTools.includes(match[1].toLowerCase())) fail('unavailable or disallowed tool');
  }
  if (/\b(rm|Remove-Item|del|format|sudo|chmod)\b|\bgit\s+(reset|clean)\b/i.test(text)) fail('destructive command');
  if (/\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod|npm\s+(install|exec)|npx|pip\s+install|uvx|irm|iex)\b|https?:\/\//i.test(text)) fail('network or installer instruction');
  if (/@(?:latest|next|\*|\^|~)|\b(?:main|master|HEAD)\b(?=\s*(?:branch|ref))/.test(text)) fail('floating version');
  // This supported profile has no linked resources or executables, including images.
  if (/!?\[[^\]]*\]\([^)]*\)|\[[^\]]+\]:\s*\S+|<\/?(?:script|iframe)\b/i.test(text)) fail('unsupported reference');
}

export function inspectSkills({ root = skillRoot, selectionFile = selectionPath(), piVersion = '1.1.0', availableTools = ['read'] } = {}) {
  let manifestHash = 'unavailable';
  let manifest = null;
  try {
    const manifestFile = path.join(root, 'skills-manifest.json');
    unlinked(manifestFile);
    const raw = fs.readFileSync(manifestFile);
    manifestHash = sha256(raw);
    manifest = JSON.parse(raw.toString('utf8'));
    if (!exactKeys(manifest, ['schemaVersion', 'skills']) || manifest.schemaVersion !== 1 || !Array.isArray(manifest.skills) || !manifest.skills.length) fail('invalid manifest');
    const names = new Set();
    const paths = new Set();
    const packages = [];
    for (const skill of manifest.skills) {
      if (!exactKeys(skill, ['name', 'version', 'path', 'sha256', 'source', 'owner', 'updatePolicy', 'compatibility', 'permissions', 'dependencies', 'defaultEnabled'])) fail('invalid package metadata');
      if (typeof skill.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name) || names.has(skill.name.toLowerCase())) fail('duplicate or invalid name');
      names.add(skill.name.toLowerCase());
      if (!/^\d+\.\d+\.\d+$/.test(skill.version) || skill.path !== `skills/${skill.name}/${skill.version}/SKILL.md` || !/^[a-f0-9]{64}$/.test(skill.sha256)) fail('invalid immutable identity');
      if (!exactKeys(skill.source, ['repository', 'path', 'version']) || skill.source.repository !== 'https://github.com/Rajveerx11/neura' || skill.source.path !== `agent/neura/${skill.path}` || skill.source.version !== skill.version) fail('invalid provenance');
      if (skill.owner !== 'Rajveerx11' || skill.updatePolicy !== 'reviewed-version-and-digest-change-with-smoke-tests' || skill.defaultEnabled !== false) fail('invalid owner or update policy');
      if (!exactKeys(skill.compatibility, ['pi', 'profile']) || skill.compatibility.pi !== piVersion || skill.compatibility.profile !== 'read-only-guidance-v1') fail('unsupported compatibility');
      if (!exactKeys(skill.permissions, ['tools', 'filesystem', 'network', 'write', 'execute']) || JSON.stringify(skill.permissions.tools) !== '["read"]' || skill.permissions.filesystem !== 'authorized-repository-read-only' || skill.permissions.network !== false || skill.permissions.write !== false || skill.permissions.execute !== false) fail('permissions are restrictions, not grants');
      if (!Array.isArray(skill.dependencies) || skill.dependencies.length) fail('executable or floating dependencies unsupported');
      const file = path.resolve(root, skill.path);
      unlinked(file);
      const canonical = fs.realpathSync(file).toLowerCase();
      if (paths.has(canonical)) fail('duplicate package path');
      paths.add(canonical);
      const dir = path.dirname(file);
      if (fs.readdirSync(dir).join(',') !== 'SKILL.md' || !fs.lstatSync(file).isFile()) fail('private, generated, or executable package content');
      const bytes = fs.readFileSync(file);
      if (sha256(bytes) !== skill.sha256) fail('content digest mismatch');
      validateSkillText(bytes.toString('utf8'), skill.name, availableTools);
      packages.push({ name: skill.name, version: skill.version, sha256: skill.sha256, path: file });
    }
    // The entire package tree is immutable; unknown sibling files/directories
    // cannot hide personal state or an accidentally discoverable optional skill.
    const expectedFiles = new Set(packages.map(skill => path.resolve(skill.path)));
    // Empty retired directories are harmless: the existing installer owns files,
    // not directory containers, and must not recursively delete user state.
    const visit = dir => {
      unlinked(dir);
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        unlinked(file);
        if (entry.isDirectory()) visit(file);
        else if (!entry.isFile() || !expectedFiles.has(file)) fail('unknown package content');
      }
    };
    visit(path.resolve(root, 'skills'));
    let enabled = [];
    if (selectionFile !== null) unlinked(selectionFile);
    if (selectionFile !== null && fs.existsSync(selectionFile)) {
      const selected = JSON.parse(fs.readFileSync(selectionFile, 'utf8'));
      if (!exactKeys(selected, ['schemaVersion', 'enabled']) || selected.schemaVersion !== 1 || !Array.isArray(selected.enabled) || selected.enabled.some(name => typeof name !== 'string' || !names.has(name)) || new Set(selected.enabled).size !== selected.enabled.length) fail('invalid opt-in selection');
      enabled = selected.enabled;
    }
    const selected = packages.filter(skill => enabled.includes(skill.name)).sort((a, b) => a.name.localeCompare(b.name));
    return { valid: true, manifestHash, manifest, packages, enabled: selected.map(skill => skill.name), skillPaths: selected.map(skill => skill.path), errors: [] };
  } catch (error) {
    // Never echo package text, state content, or filesystem error paths into health.
    return { valid: false, manifestHash, manifest: null, packages: [], enabled: [], skillPaths: [], errors: [error.message?.startsWith('skill validation:') ? error.message : 'skill validation: unreadable or malformed registry'] };
  }
}

// Pi's public command registry exposes the actual discovered winner, not our
// requested paths. Inspect only reserved catalog names; unrelated skills stay stock.
export function inspectSkillDiscovery(report, commands, { allowMissing = false } = {}) {
  if (!report.valid) return report;
  const errors = [];
  if (!Array.isArray(commands)) {
    if (report.enabled.length) errors.push('skill validation: runtime discovery identity unavailable');
  } else {
    for (const skill of report.packages) {
      const discovered = commands.filter(command => command.source === 'skill' && command.name === `skill:${skill.name}`);
      const enabled = report.enabled.includes(skill.name);
      if (!discovered.length && (!enabled || allowMissing)) continue;
      try {
        if (!enabled || discovered.length !== 1 || typeof discovered[0].sourceInfo?.path !== 'string') fail('reserved name collision or missing runtime skill');
        const file = discovered[0].sourceInfo.path;
        unlinked(file);
        if (path.resolve(file) !== path.resolve(skill.path) || fs.realpathSync(file) !== fs.realpathSync(skill.path) || sha256(fs.readFileSync(file)) !== skill.sha256) fail('reserved name discovery identity mismatch');
      } catch {
        // Do not expose external paths, metadata, or contents in diagnostics.
        errors.push(`skill validation: ${skill.name} runtime identity unavailable or reserved name collision`);
      }
    }
  }
  return errors.length ? { ...report, valid: false, enabled: [], skillPaths: [], errors } : report;
}

export function skillValidationLabel(report) {
  return `manifest sha256:${report.manifestHash} · validation ${report.valid ? 'PASS' : 'FAIL'} · ${report.enabled.length} enabled`;
}
