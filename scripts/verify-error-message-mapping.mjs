#!/usr/bin/env node

import { getErrorMessage } from '../src/lib/errorMessages.ts';

const cases = [
  {
    name: 'Runway MCP connection not approved',
    input: 'runway_mcp_connection_not_approved',
    expected: 'Runway MCP接続が未承認です',
  },
  {
    name: 'Runway eligible subscription required',
    input: 'Runway MCP generation requires an active eligible subscription',
    expected: 'Runway生成にはRunway対応の有料プランが必要です',
  },
  {
    name: 'Expired subscription',
    input: 'No active subscription for brand',
    expected: '有効なサブスクが見つかりません',
  },
  {
    name: 'Runway bridge missing',
    input: 'runway_mcp_bridge_not_configured',
    expected: 'RUNWAY_MCP_BRIDGE_URL',
  },
  {
    name: 'Runway auth required',
    input: 'runway_mcp_auth_required',
    expected: 'Runwayログインが切れています',
  },
  {
    name: 'Runway subscription inactive',
    input: 'runway_mcp_subscription_inactive',
    expected: 'Runway側のサブスク',
  },
  {
    name: 'Runway generic request failed',
    input: 'runway_mcp_request_failed:502',
    expected: 'Runway MCPとの通信に失敗しました',
  },
];

const failures = [];

for (const testCase of cases) {
  const actual = getErrorMessage(testCase.input);
  if (!actual.includes(testCase.expected)) {
    failures.push({
      name: testCase.name,
      input: testCase.input,
      expected: testCase.expected,
      actual,
    });
  }
}

if (failures.length > 0) {
  console.error('Error message mapping verification failed.');
  for (const failure of failures) {
    console.error(`- ${failure.name}: expected "${failure.expected}" in "${failure.actual}"`);
  }
  process.exit(1);
}

console.log(`Error message mapping verification passed (${cases.length}/${cases.length}).`);
