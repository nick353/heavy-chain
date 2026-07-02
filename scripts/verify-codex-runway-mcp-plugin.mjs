#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const outPath = args.out || 'output/playwright/g671-codex-app-runway-mcp-plugin/summary.json';
const pluginRoot = args.pluginRoot || '/Users/nichikatanaka/plugins/runway-mcp';
const expectedCacheRoot = args.cacheRoot || '/Users/nichikatanaka/.codex/plugins/cache/personal/runway-mcp/0.1.0+codex.20260701171331';
const expectedEndpoint = 'https://mcp.runwayml.com/mcp';
const expectedPort = '15555';

const checks = [];
const blockers = [];

const pluginJsonPath = path.join(pluginRoot, '.codex-plugin/plugin.json');
const mcpJsonPath = path.join(pluginRoot, '.mcp.json');
const skillPath = path.join(pluginRoot, 'skills/runway-mcp/SKILL.md');
const cacheMcpJsonPath = path.join(expectedCacheRoot, '.mcp.json');

const pluginJson = readJson(pluginJsonPath);
const mcpJson = readJson(mcpJsonPath);
const cacheMcpJson = readJson(cacheMcpJsonPath);
const skillText = readText(skillPath);
const pluginList = spawnSync('codex', ['plugin', 'list'], { encoding: 'utf8' });

addCheck('plugin_manifest_exists', Boolean(pluginJson), {
  path: pluginJsonPath,
  name: pluginJson?.name || null,
  version: pluginJson?.version || null,
});

addCheck('plugin_metadata_targets_runway_mcp',
  pluginJson?.name === 'runway-mcp'
    && pluginJson?.mcpServers === './.mcp.json'
    && pluginJson?.interface?.displayName === 'Runway MCP',
  {
    name: pluginJson?.name || null,
    displayName: pluginJson?.interface?.displayName || null,
    mcpServers: pluginJson?.mcpServers || null,
  },
);

const runwayServer = mcpJson?.mcpServers?.runway;
addCheck('mcp_server_points_to_official_runway',
  Boolean(runwayServer)
    && runwayServer.command === '/Applications/Codex.app/Contents/Resources/cua_node/bin/npx'
    && Array.isArray(runwayServer.args)
    && runwayServer.args.includes('mcp-remote@0.1.37')
    && runwayServer.args.includes(expectedEndpoint)
    && runwayServer.args.includes(expectedPort),
  redactMcpServer(runwayServer),
);

addCheck('mcp_auth_state_is_local',
  runwayServer?.env?.MCP_REMOTE_CONFIG_DIR === '/Users/nichikatanaka/.mcp-auth',
  {
    MCP_REMOTE_CONFIG_DIR: runwayServer?.env?.MCP_REMOTE_CONFIG_DIR || null,
  },
);

addCheck('skill_records_heavy_chain_runway_rules',
  skillText.includes('at most 2 active generations')
    && skillText.includes('output/runway-mcp-results/inbox/')
    && skillText.includes('Do not claim Runway is usable until the tools are visible')
    && skillText.includes('do not use the old `localhost:15554` bridge'),
  {
    path: skillPath,
  },
);

addCheck('installed_cache_matches_source',
  Boolean(cacheMcpJson) && JSON.stringify(cacheMcpJson) === JSON.stringify(mcpJson),
  {
    cacheMcpJsonPath,
    cacheExists: Boolean(cacheMcpJson),
  },
);

addCheck('codex_plugin_list_installed_enabled',
  pluginList.status === 0 && pluginList.stdout.includes('runway-mcp@personal') && pluginList.stdout.includes('installed, enabled'),
  {
    exitCode: pluginList.status,
    stderr: sanitizeCommandOutput(pluginList.stderr),
    matched: pluginList.stdout.includes('runway-mcp@personal') && pluginList.stdout.includes('installed, enabled'),
  },
);

const port15555 = portListener(15555);
addCheck('callback_port_15555_available_or_runway_mcp_remote',
  !port15555.listening || port15555.command.includes('mcp-remote https://mcp.runwayml.com/mcp 15555'),
  {
    port: 15555,
    listening: port15555.listening,
    command: port15555.command,
  },
);

addCheck('current_thread_tool_exposure_not_claimed',
  true,
  {
    status: 'not_verified_in_this_thread',
    reason: 'Codex plugin/MCP tools are normally loaded at session start; this verifier proves installation, not current-thread tool exposure.',
  },
);

if (!checks.every((check) => check.passed)) {
  blockers.push({
    code: 'codex_runway_mcp_plugin_install_incomplete',
    message: 'Codex app Runway MCP plugin installation or configuration is incomplete.',
    next_action: 'Fix the failed checks, reinstall runway-mcp@personal, then rerun npm run verify:codex-runway-mcp-plugin.',
  });
}

const summary = {
  schema: 'heavy-chain.codex-runway-mcp-plugin-readiness.v1',
  capturedAt: new Date().toISOString(),
  mode: 'local-plugin-readiness-no-generation-no-payment',
  outPath,
  pluginRoot,
  expectedCacheRoot,
  checks,
  blockers,
  ok: blockers.length === 0,
  toolExposure: {
    currentThreadRunwayToolsVisible: 'not_verified',
    requiredNextProof: 'new_or_reloaded_codex_app_session_tools_list_or_availability_probe',
  },
  nextActions: blockers.length === 0
    ? [
      'Open or reload a Codex app session so runway-mcp@personal is loaded at session start.',
      'Run a harmless Runway MCP tools/list or availability probe from that session.',
      'If Runway OAuth, org selection, billing, CAPTCHA, OTP, or security verification appears, stop for user action and record the exact blocker.',
    ]
    : [
      'Fix failed plugin readiness checks before attempting Runway generation.',
    ],
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ok: summary.ok, outPath, failed: checks.filter((check) => !check.passed).map((check) => check.id) }, null, 2));
process.exit(summary.ok ? 0 : 1);

function addCheck(id, passed, details = {}) {
  checks.push({ id, passed: Boolean(passed), details });
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function readJson(file) {
  try {
    return JSON.parse(readText(file));
  } catch {
    return null;
  }
}

function portListener(port) {
  const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout.includes(`:${port}`)) {
    return { listening: false, command: '' };
  }
  const lines = result.stdout.trim().split('\n');
  const columns = lines[1]?.trim().split(/\s+/) || [];
  const pid = columns[1];
  if (!pid) {
    return { listening: true, command: lines[1] || '' };
  }
  const ps = spawnSync('ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' });
  return {
    listening: true,
    command: sanitizeCommandOutput(ps.stdout.trim() || lines[1] || ''),
  };
}

function sanitizeCommandOutput(text = '') {
  return text.split('\n').slice(0, 10).join('\n');
}

function redactMcpServer(server) {
  if (!server) {
    return null;
  }
  return {
    command: server.command,
    args: server.args,
    envKeys: Object.keys(server.env || {}),
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--out' && next) {
      parsed.out = next;
      index += 1;
    } else if (arg === '--plugin-root' && next) {
      parsed.pluginRoot = next;
      index += 1;
    } else if (arg === '--cache-root' && next) {
      parsed.cacheRoot = next;
      index += 1;
    }
  }
  return parsed;
}
