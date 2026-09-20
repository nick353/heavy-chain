#!/usr/bin/env node

const HISTORICAL_BLOCKER = 'historical_release_readback_retired';

const result = {
  schema: 'heavy-chain.release-readback.v1',
  accepted: false,
  legacyOnly: true,
  blocker: HISTORICAL_BLOCKER,
  failures: [HISTORICAL_BLOCKER],
};

console.error(JSON.stringify(result, null, 2));
process.exit(1);
