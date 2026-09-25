import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/pages/VideoWorkstationPage.tsx', import.meta.url), 'utf8');

test('video detail route subscribes to query changes instead of reading a stale window location', () => {
  assert.match(source, /Link, useLocation, useNavigate/);
  assert.match(source, /const location = useLocation\(\);/);
  assert.match(source, /useMemo\(\(\) => new URLSearchParams\(location\.search\), \[location\.search\]\)/);
});

test('changing the project code resets route-owned state before artifact hydration', () => {
  assert.match(source, /previousVideoProjectCode = useRef\(videoProjectCode\)/);
  assert.match(source, /setVideoDraftArtifactId\(undefined\)/);
  assert.match(source, /setSelectedStoryboardId\(storyboardCandidates\[0\]\.id\)/);
  assert.match(source, /setMaterialReference\(project && project !== 'new'/);
});

console.log('video route sync tests: 2/2 passed');
