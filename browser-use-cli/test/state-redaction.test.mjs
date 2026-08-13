import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("browser harness state never serializes form-control values", async () => {
  const source = await readFile(path.join(root, "bin", "codex-browser-use"), "utf8");
  const start = source.indexOf("_BROWSER_HARNESS_STATE_JS =");
  const end = source.indexOf("_BROWSER_HARNESS_TAB_GUARD =", start);
  assert.ok(start >= 0 && end > start, "state harness source was not found");
  const harness = source.slice(start, end);

  assert.doesNotMatch(harness, /element\.value/);
  assert.match(harness, /INPUT.*TEXTAREA.*SELECT/);
  assert.match(harness, /\[入力値は非表示\]/);
  assert.match(harness, /element\.isContentEditable/);

  const helperPageScripts = source.slice(source.indexOf("def resolve_state_target():"), source.indexOf("def _parse_cli_json", start));
  assert.doesNotMatch(helperPageScripts, /element\.value/);
});
