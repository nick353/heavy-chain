#!/usr/bin/env node

const HISTORICAL_BLOCKER = 'historical_chrome_plugin_proof_retired';

const output = {
  schema: 'heavy-chain.chrome-plugin-proof.v1',
  checkedAt: new Date().toISOString(),
  evidence: null,
  surface: 'Chrome Plugin',
  historicalOnly: true,
  accepted: false,
  blocker: HISTORICAL_BLOCKER,
  failures: [HISTORICAL_BLOCKER],
  irreversibleActions: {
    openAiApi: 'not_touched',
    generation: 'not_clicked',
    retry: 'not_clicked',
    billing: 'not_touched',
    runway: 'not_invoked',
  },
};

console.error(JSON.stringify(output, null, 2));
process.exit(1);
