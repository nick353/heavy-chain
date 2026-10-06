import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeDesignProjectGridItems, type DesignProjectEntry } from '../src/lib/designProjectArtifacts.ts';

const design = (id: string, createdAt: string): DesignProjectEntry => ({
  origin: 'remote',
  artifact: { id, createdAt } as DesignProjectEntry['artifact'],
});
const conversation = (projectId: string, updatedAt: string) => ({ projectId, updatedAt });
const ids = (items: ReturnType<typeof mergeDesignProjectGridItems<{ projectId: string; updatedAt: string }>>) =>
  items.map((item) => item.kind === 'conversation' ? `c:${item.entry.projectId}` : `d:${item.entry.artifact.id}`);

test('conversation and saved design projects merge into one recency-ordered list', () => {
  const merged = mergeDesignProjectGridItems(
    [conversation('new', '2026-10-05T00:00:00Z'), conversation('old', '2026-09-01T00:00:00Z')],
    [design('a', '2026-10-06T00:00:00Z'), design('b', '2026-09-30T00:00:00Z')],
  );
  assert.deepEqual(ids(merged), ['d:a', 'c:new', 'd:b', 'c:old']);
});

test('old conversations never crowd newer saved designs out of the five recent cards', () => {
  const conversations = Array.from({ length: 6 }, (_, index) => conversation(`c${index}`, `2026-01-0${index + 1}T00:00:00Z`)).reverse();
  const entries = [design('fresh', '2026-10-01T00:00:00Z')];
  assert.equal(ids(mergeDesignProjectGridItems(conversations, entries).slice(0, 5))[0], 'd:fresh');
});

test('the merge is stable for each source, keeping pinned design order and invalid dates last', () => {
  const merged = mergeDesignProjectGridItems(
    [conversation('bad', 'not-a-date')],
    [design('pinned-old', '2026-01-01T00:00:00Z'), design('newer', '2026-05-01T00:00:00Z')],
  );
  assert.deepEqual(ids(merged), ['d:pinned-old', 'd:newer', 'c:bad']);
});
