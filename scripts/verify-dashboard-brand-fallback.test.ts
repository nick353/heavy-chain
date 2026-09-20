import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/pages/DashboardPage.tsx', import.meta.url), 'utf8');

assert.match(source, /const verifiedCurrentBrand = useAuthStore\.getState\(\)\.currentBrand/);
assert.match(source, /if \(verifiedCurrentBrand\) \{[\s\S]*setShowBrandModal\(false\);[\s\S]*return verifiedCurrentBrand;/);
assert.match(source, /useAuthStore\.getState\(\)\.user\?\.id === user\?\.id/);

console.log('dashboard brand fallback tests: 3/3 passed');
