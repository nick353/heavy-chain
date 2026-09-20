#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

export const requiredFiles = [
  'src/lib/cloudflareApi.ts',
  'src/lib/cloudflareBrowserAuth.ts',
  'src/lib/mediaGateway.ts',
  'cloudflare/heavy-api/src/index.ts',
  'cloudflare/heavy-web/src/index.mjs',
];

export const runtimePaths = ['src', 'cloudflare/heavy-api/src', 'cloudflare/heavy-web/src'];

export const forbiddenRuntimePatterns = [
  /@supabase\//i,
  /https?:\/\/[^\s"'`]+\.supabase\.co/i,
  /\bVITE_SUPABASE_[A-Z0-9_]+\b/i,
  /\/auth\/v1\//i,
  /\/rest\/v1\//i,
  /\/functions\/v1\//i,
];

const sourceExtensions = new Set(['.cjs', '.js', '.jsx', '.mjs', '.sh', '.bash', '.zsh', '.ts', '.tsx']);
const resolvableExtensions = [...sourceExtensions, '.json'];
const dependencySections = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'bundledDependencies',
  'bundleDependencies',
];
const knownLegacyEntrypoints = new Set([
  'scripts/supabase-prod-verify.sh',
  'scripts/deploy-edge-functions.sh',
]);
const packageManagerCommands = new Set(['install', 'ci', 'exec', 'init', 'publish', 'pack', 'version', 'config', 'help', 'view', 'info', 'uninstall', 'update', 'link', 'login', 'logout', 'whoami', 'root', 'prefix', 'cache', 'run']);
const childProcessCalls = /\b(?:exec|execFile|execFileSync|execSync|execa|fork|run|runSync|spawn|spawnSync|Command)\s*\(/i;

function asPosix(value) {
  return value.split(sep).join('/');
}

function displayPath(rootDir, filePath) {
  const relativePath = relative(rootDir, filePath);
  return relativePath && !relativePath.startsWith('..') && !isAbsolute(relativePath)
    ? asPosix(relativePath)
    : asPosix(filePath);
}

function isFile(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(directoryPath) {
  try {
    return statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function isWithinRoot(rootDir, filePath) {
  const relativePath = relative(rootDir, filePath);
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

function sourceFiles(root) {
  if (!existsSync(root)) return [];

  const files = [];
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return files;
  }

  for (const entry of entries) {
    const filePath = join(root, entry);
    if (isDirectory(filePath)) files.push(...sourceFiles(filePath));
    else if (sourceExtensions.has(extname(entry).toLowerCase())) files.push(filePath);
  }
  return files;
}

function isLegacyDependency(name) {
  return /^@supabase(?:\/|$)/i.test(name) || /^supabase(?:$|[-_])/i.test(name);
}

function stripTokenPunctuation(token) {
  return token
    .replace(/^[\s"'`([{]+/, '')
    .replace(/[\s"'`,;:.)}\]]+$/, '')
    .replace(/\\(["'`\\])/g, '$1');
}

function shellTokens(command) {
  const tokens = [];
  let current = '';
  let quote = null;
  let escaped = false;

  const flush = () => {
    const token = stripTokenPunctuation(current);
    if (token) tokens.push(token);
    current = '';
  };

  for (const character of command) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === '\\' && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === '"' || character === "'" || character === '`') {
      quote = character;
    } else if (/\s/.test(character) || ';|&()'.includes(character)) {
      flush();
    } else {
      current += character;
    }
  }
  if (escaped) current += '\\';
  flush();
  return tokens;
}

function removeComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*#(?!\!).*$/gm, '');
}

function extractPackageScriptRefs(command) {
  const tokens = shellTokens(command);
  const refs = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!/^(?:npm|pnpm|yarn|bun)$/.test(token)) continue;

    let next = tokens[index + 1];
    if (next === 'run') {
      let nextIndex = index + 2;
      while (tokens[nextIndex]?.startsWith('-')) nextIndex += 1;
      next = tokens[nextIndex];
    }
    else if (packageManagerCommands.has(next)) next = undefined;

    if (next && !next.startsWith('-')) refs.push(next);
  }

  return refs;
}

function isSourcePath(filePath) {
  return sourceExtensions.has(extname(filePath).toLowerCase());
}

function hasGlob(value) {
  return /[*?\[]/.test(value);
}

function globToRegExp(pattern) {
  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') expression += '.*';
    else if (character === '?') expression += '.';
    else if (character === '[') {
      const end = pattern.indexOf(']', index + 1);
      if (end === -1) expression += '\\[';
      else {
        expression += pattern.slice(index, end + 1);
        index = end;
      }
    } else expression += character.replace(/[\\^$+{}.()|]/g, '\\$&');
  }
  return new RegExp(`${expression}$`);
}

function expandGlob(rootDir, pathPattern) {
  const normalizedPattern = asPosix(pathPattern);
  const pattern = globToRegExp(normalizedPattern);
  return sourceFiles(rootDir).filter((filePath) => pattern.test(asPosix(relative(rootDir, filePath))));
}

function isLocalPathToken(token, rootDir) {
  const normalizedToken = asPosix(token);
  if (!normalizedToken || normalizedToken.startsWith('-')) return false;

  const rootRelative = normalizedToken.replace(/^\.\//, '');
  if (/^(?:scripts|src|cloudflare|supabase)\//i.test(rootRelative)) return true;
  if (/^\.\.\/(?:scripts|src|cloudflare|supabase)(?:\/|$)/i.test(normalizedToken)) return true;
  if (/^\.\.?\//.test(normalizedToken) && (hasGlob(normalizedToken) || resolvableExtensions.includes(extname(normalizedToken).toLowerCase()))) return true;
  if (isAbsolute(token) && isWithinRoot(rootDir, resolve(token)) && (hasGlob(token) || isSourcePath(token))) return true;
  return false;
}

function resolveLocalPath(rootDir, fromFile, specifier, origin) {
  const normalizedSpecifier = specifier.replace(/\\/g, '/');
  const fromCommand = origin === 'command';
  const candidate = isAbsolute(specifier)
    ? resolve(specifier)
    : fromCommand
      ? resolve(rootDir, specifier)
      : resolve(dirname(fromFile), specifier);

  if (!isWithinRoot(rootDir, candidate)) return { ignored: true };
  const candidateExtension = extname(candidate).toLowerCase();
  if (candidateExtension && !resolvableExtensions.includes(candidateExtension)) return { ignored: true };

  if (hasGlob(normalizedSpecifier)) {
    const matches = expandGlob(rootDir, asPosix(relative(rootDir, candidate)));
    return matches.length ? { files: matches } : { unresolved: candidate };
  }

  if (isFile(candidate)) return { files: [candidate] };
  if (isDirectory(candidate)) {
    for (const extension of resolvableExtensions) {
      const indexFile = join(candidate, `index${extension}`);
      if (isFile(indexFile)) return { files: [indexFile] };
    }
  }

  if (extname(candidate)) return { unresolved: candidate };
  for (const extension of resolvableExtensions) {
    const withExtension = `${candidate}${extension}`;
    if (isFile(withExtension)) return { files: [withExtension] };
  }
  return { unresolved: candidate };
}

function isLegacyFunctionsPath(value) {
  return /(?:^|[./])supabase\/functions(?:\/|$)/i.test(value.replace(/\\/g, '/'));
}

function relativeContractPath(rootDir, filePath) {
  return asPosix(relative(rootDir, filePath)).replace(/^\.\//, '');
}

function isKnownLegacyEntrypoint(rootDir, filePathOrSpecifier) {
  const normalized = asPosix(filePathOrSpecifier).replace(/^\.\//, '');
  if (knownLegacyEntrypoints.has(normalized)) return true;
  if (isAbsolute(filePathOrSpecifier) && isWithinRoot(rootDir, resolve(filePathOrSpecifier))) {
    return knownLegacyEntrypoints.has(relativeContractPath(rootDir, resolve(filePathOrSpecifier)));
  }
  return false;
}

function extractImportSpecifiers(source) {
  const withoutComments = removeComments(source);
  const specifiers = [];
  const seen = new Set();
  const add = (specifier) => {
    if (!seen.has(specifier)) {
      seen.add(specifier);
      specifiers.push(specifier);
    }
  };

  const staticImportPattern = /(?:^|[;\n]\s*)(?:import|export)\s+(?:(?:[\s\S]*?\sfrom\s+))?['"]([^'"]+)['"]/gm;
  for (const match of withoutComments.matchAll(staticImportPattern)) add(match[1]);

  const dynamicImportPattern = /\bimport\s*\(\s*(["'`])([^"'`]+)\1\s*\)/g;
  for (const match of withoutComments.matchAll(dynamicImportPattern)) add(match[2]);

  const requirePattern = /\brequire(?:\.resolve)?\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of withoutComments.matchAll(requirePattern)) add(match[1]);

  return specifiers;
}

function extractInvocationSegments(source) {
  const withoutComments = removeComments(source);
  const segments = [];

  for (const line of withoutComments.split(/\r?\n/)) {
    const commandLine = /^\s*(?:(?:env\s+[A-Z_][A-Z0-9_]*=[^\s]+\s+)|(?:sudo\s+)|(?:npx\s+)|(?:pnpm\s+exec\s+)|(?:yarn\s+dlx\s+)|(?:bunx\s+))?(?:bash|bun|deno|node|npm|npx|pnpm|sh|source|supabase|tsx|ts-node|yarn|exec)\b|^\s*\.\s+/i;
    if (commandLine.test(line) || childProcessCalls.test(line)) segments.push(line);
  }

  const childProcessPattern = /\b(?:exec|execFile|execFileSync|execSync|execa|fork|run|runSync|spawn|spawnSync|Command)\s*\([\s\S]{0,800}?\)/gi;
  for (const match of withoutComments.matchAll(childProcessPattern)) segments.push(match[0]);
  return [...new Set(segments)];
}

function extractPathTokens(text, rootDir) {
  return shellTokens(text).filter((token) => isLocalPathToken(token, rootDir));
}

function hasDirectLegacyCliInvocation(text) {
  if (/\bsupabase\s+(?:functions\s+)?(?:serve|deploy|invoke|start|stop)\b/i.test(text)) return true;

  const commandStart = /(?:^|[;&|()]\s*|\n\s*)(?:(?:env\s+[A-Z_][A-Z0-9_]*=[^\s]+\s+)|(?:sudo\s+)|(?:npx\s+)|(?:pnpm\s+exec\s+)|(?:yarn\s+dlx\s+)|(?:bunx\s+)|(?:npm\s+exec\s+))?(?:--[^\s]+\s+)*supabase(?:\s|$)/im;
  if (commandStart.test(text)) return true;

  return /\b(?:exec|execFile|execFileSync|execSync|execa|fork|run|runSync|spawn|spawnSync|Command)\s*\([\s\S]{0,800}['"]supabase['"]/i.test(text);
}

function isLegacyPackageImport(specifier) {
  return /^(?:@supabase(?:\/|$)|supabase(?:$|\/))/i.test(specifier);
}

function isLocalSpecifier(specifier) {
  return specifier.startsWith('.') || specifier.startsWith('/') || /^(?:scripts|src|cloudflare|supabase)\//i.test(specifier);
}

function isIgnoredContractFile(rootDir, filePath) {
  const relativePath = relativeContractPath(rootDir, filePath);
  return relativePath === 'scripts/verify-cloudflare-runtime-contract.mjs'
    || relativePath === 'scripts/verify-cloudflare-runtime-contract.test.mjs';
}

function inspectPackageRuntime(rootDir, packageJson, failures) {
  for (const section of dependencySections) {
    const dependencies = packageJson[section];
    if (!dependencies || (typeof dependencies !== 'object' && !Array.isArray(dependencies))) continue;
    const dependencyNames = Array.isArray(dependencies) ? dependencies : Object.keys(dependencies);
    for (const dependencyName of dependencyNames) {
      if (typeof dependencyName !== 'string') continue;
      if (isLegacyDependency(dependencyName)) {
        failures.push(`package.json: legacy dependency ${dependencyName} remains in ${section}`);
      }
    }
  }

  const scripts = packageJson.scripts;
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
    failures.push('package.json: missing active scripts object');
    return { scripts: {} };
  }

  for (const [scriptName, command] of Object.entries(scripts)) {
    if (typeof command !== 'string') {
      failures.push(`package.json: active script ${scriptName} has no string command`);
    }
  }
  return { scripts };
}

function verifyActiveEntrypoints(rootDir, packageJson, failures) {
  const { scripts } = inspectPackageRuntime(rootDir, packageJson, failures);
  const activeFiles = new Set();
  const visitedScripts = new Set();
  const visitingScripts = [];
  const visitedFiles = new Set();
  const visitingFiles = [];

  const addFailure = (message) => {
    if (!failures.includes(message)) failures.push(message);
  };

  const chainText = (chain) => chain.join(' -> ');

  const reportLocalReference = (specifier, fromLabel, chain, origin, fromFile) => {
    const normalizedSpecifier = specifier.replace(/\\/g, '/');
    if (isLegacyFunctionsPath(normalizedSpecifier)) {
      addFailure(`${fromLabel}: active legacy reference into supabase/functions/: ${specifier} (${chainText(chain)})`);
    }
    if (isKnownLegacyEntrypoint(rootDir, specifier)) {
      addFailure(`${fromLabel}: active legacy entrypoint ${specifier} (${chainText(chain)})`);
    }

    const resolved = resolveLocalPath(rootDir, fromFile || rootDir, specifier, origin);
    if (resolved.ignored) return;
    if (resolved.unresolved) {
      addFailure(`${fromLabel}: unresolved active local entrypoint ${specifier} (${chainText(chain)})`);
      return;
    }
    for (const filePath of resolved.files || []) {
      activeFiles.add(filePath);
      visitFile(filePath, [...chain, displayPath(rootDir, filePath)]);
    }
  };

  const visitFile = (filePath, chain) => {
    const absolutePath = resolve(filePath);
    if (visitedFiles.has(absolutePath)) return;
    if (visitingFiles.includes(absolutePath)) {
      addFailure(`active local entrypoint cycle: ${chainText([...chain, displayPath(rootDir, absolutePath)])}`);
      return;
    }
    if (!isWithinRoot(rootDir, absolutePath)) return;
    if (!isFile(absolutePath)) {
      addFailure(`unresolved active local entrypoint: ${displayPath(rootDir, absolutePath)} (${chainText(chain)})`);
      return;
    }

    visitedFiles.add(absolutePath);
    visitingFiles.push(absolutePath);

    if (!isIgnoredContractFile(rootDir, absolutePath)) {
      const relativePath = relativeContractPath(rootDir, absolutePath);
      if (isLegacyFunctionsPath(relativePath)) {
        addFailure(`${displayPath(rootDir, absolutePath)}: active legacy source under supabase/functions/ (${chainText(chain)})`);
      }
      if (isKnownLegacyEntrypoint(rootDir, absolutePath)) {
        addFailure(`${displayPath(rootDir, absolutePath)}: active legacy entrypoint (${chainText(chain)})`);
      }

      let source;
      try {
        source = readFileSync(absolutePath, 'utf8');
      } catch (error) {
        addFailure(`${displayPath(rootDir, absolutePath)}: unable to read active entrypoint (${error.message})`);
        visitingFiles.pop();
        return;
      }

      const sourceLabel = displayPath(rootDir, absolutePath);
      const withoutComments = removeComments(source);
      if (/\bsupabase\/functions\//i.test(withoutComments)) {
        addFailure(`${sourceLabel}: active legacy reference into supabase/functions/ (${chainText(chain)})`);
      }
      const importSpecifiers = extractImportSpecifiers(source);
      for (const specifier of importSpecifiers) {
        if (isLegacyPackageImport(specifier)) {
          addFailure(`${sourceLabel}: active legacy import ${specifier} (${chainText(chain)})`);
          continue;
        }
        if (isLegacyFunctionsPath(specifier)) {
          addFailure(`${sourceLabel}: active legacy reference into supabase/functions/: ${specifier} (${chainText(chain)})`);
          continue;
        }
        if (isLocalSpecifier(specifier)) reportLocalReference(specifier, sourceLabel, chain, 'import', absolutePath);
      }

      const invocationSegments = extractInvocationSegments(source);
      const invocationSource = invocationSegments.join('\n');
      if (hasDirectLegacyCliInvocation(invocationSource)
        || /\bsupabase\s+(?:functions\s+)?(?:serve|deploy|invoke|start|stop)\b/i.test(withoutComments)) {
        addFailure(`${sourceLabel}: active legacy Supabase invocation or serve/deploy command (${chainText(chain)})`);
      }
      if (/\bsupabase\/functions\//i.test(invocationSource)) {
        addFailure(`${sourceLabel}: active legacy reference into supabase/functions/ (${chainText(chain)})`);
      }
      for (const legacyEntrypoint of knownLegacyEntrypoints) {
        if (invocationSource.includes(legacyEntrypoint) || withoutComments.includes(legacyEntrypoint)) {
          addFailure(`${sourceLabel}: active legacy entrypoint ${legacyEntrypoint} (${chainText(chain)})`);
        }
      }

      for (const segment of invocationSegments) {
        for (const pathToken of extractPathTokens(segment, rootDir)) {
          reportLocalReference(pathToken, sourceLabel, chain, 'command', absolutePath);
        }
      }

      for (const referencedScript of extractPackageScriptRefs(invocationSource)) {
        visitScript(referencedScript, [...chain, `${sourceLabel}:npm run ${referencedScript}`]);
      }
    }

    visitingFiles.pop();
  };

  const inspectScriptCommand = (scriptName, command, chain) => {
    const label = `package.json script ${scriptName}`;
    if (/^supabase(?::|-|$)/i.test(scriptName)) {
      addFailure(`${label}: active legacy package command name`);
    }
    const withoutComments = removeComments(command);
    if (isLegacyFunctionsPath(withoutComments)) {
      addFailure(`${label}: active legacy reference into supabase/functions/`);
    }
    if (/(?:import|require)\s*(?:\(\s*)?["'](?:@supabase(?:\/|$)|supabase(?:$|\/))/i.test(withoutComments)) {
      addFailure(`${label}: active legacy import`);
    }
    if (hasDirectLegacyCliInvocation(withoutComments)) {
      addFailure(`${label}: active legacy Supabase invocation or serve/deploy command`);
    }

    for (const pathToken of extractPathTokens(withoutComments, rootDir)) {
      reportLocalReference(pathToken, label, chain, 'command', rootDir);
    }
    for (const referencedScript of extractPackageScriptRefs(withoutComments)) {
      visitScript(referencedScript, [...chain, `npm run ${referencedScript}`]);
    }
  };

  const visitScript = (scriptName, chain) => {
    if (!(scriptName in scripts)) {
      addFailure(`package.json: unresolved active npm script ${scriptName} (${chainText(chain)})`);
      return;
    }
    if (visitingScripts.includes(scriptName)) {
      addFailure(`package.json: active npm script cycle ${chainText([...chain, scriptName])}`);
      return;
    }
    if (visitedScripts.has(scriptName)) return;

    const command = scripts[scriptName];
    if (typeof command !== 'string') return;
    visitedScripts.add(scriptName);
    visitingScripts.push(scriptName);
    inspectScriptCommand(scriptName, command, [...chain, `npm:${scriptName}`]);
    visitingScripts.pop();
  };

  for (const scriptName of Object.keys(scripts)) visitScript(scriptName, []);

  return {
    activePackageScripts: Object.keys(scripts),
    activeEntrypoints: [...activeFiles].map((filePath) => displayPath(rootDir, filePath)).sort(),
  };
}

export function verifyCloudflareRuntimeContract(options = {}) {
  const requestedRoot = typeof options === 'string' ? options : options?.rootDir ?? options?.root;
  const rootDir = resolve(requestedRoot || process.cwd());
  const failures = [];

  for (const path of requiredFiles) {
    if (!isFile(join(rootDir, path))) failures.push(`missing required Cloudflare file: ${path}`);
  }

  for (const root of runtimePaths) {
    for (const path of sourceFiles(join(rootDir, root))) {
      let source;
      try {
        source = readFileSync(path, 'utf8');
      } catch (error) {
        failures.push(`${displayPath(rootDir, path)}: unable to read runtime source (${error.message})`);
        continue;
      }
      for (const pattern of forbiddenRuntimePatterns) {
        pattern.lastIndex = 0;
        if (pattern.test(source)) failures.push(`${displayPath(rootDir, path)}: forbidden legacy runtime marker ${pattern}`);
      }
    }
  }

  const packagePath = join(rootDir, 'package.json');
  let packageJson = null;
  if (!isFile(packagePath)) {
    failures.push('missing active package manifest: package.json');
  } else {
    try {
      packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    } catch (error) {
      failures.push(`package.json: invalid JSON (${error.message})`);
    }
  }

  const active = packageJson && typeof packageJson === 'object'
    ? verifyActiveEntrypoints(rootDir, packageJson, failures)
    : { activePackageScripts: [], activeEntrypoints: [] };

  return {
    schema: 'heavy-chain.cloudflare-runtime-contract.v1',
    ok: failures.length === 0,
    failures,
    checked: requiredFiles,
    runtimePaths,
    activePackageScripts: active.activePackageScripts,
    activeEntrypoints: active.activeEntrypoints,
    legacySupabaseRuntime: failures.length === 0 ? 'absent' : 'rejected',
    externalActions: 'none',
  };
}

export default verifyCloudflareRuntimeContract;

function parseRootArgument(argv) {
  const rootIndex = argv.findIndex((argument) => argument === '--root' || argument === '--root-dir');
  if (rootIndex !== -1) return argv[rootIndex + 1];
  const inline = argv.find((argument) => argument.startsWith('--root=') || argument.startsWith('--root-dir='));
  return inline ? inline.slice(inline.indexOf('=') + 1) : undefined;
}

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const result = verifyCloudflareRuntimeContract({ rootDir: parseRootArgument(process.argv.slice(2)) });
  const output = JSON.stringify(result, null, 2);
  if (result.ok) console.log(output);
  else {
    console.error(output);
    process.exitCode = 1;
  }
}
