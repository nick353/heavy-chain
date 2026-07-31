import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.BROWSER_USE_HOME = path.join(root, ".portable-test-state");
process.env.BROWSER_USE_RUNTIME_CONFIG = path.join(process.env.BROWSER_USE_HOME, "browser-use-runtime.toml");
const adapter = await import(path.join(root, "lib", "stage-adapter.mjs"));

test("package resolves helper and state paths from the checkout/environment", () => {
  assert.equal(adapter.BROWSER_USE_CLI_HELPER, path.join(root, "bin", "codex-browser-use"));
  assert.equal(adapter.BROWSER_USE_HOME.includes(".codex"), false);
  assert.equal(adapter.BROWSER_USE_HOME, path.join(root, ".portable-test-state"));
});

test("package does not embed the origin user's absolute paths", () => {
  const source = [
    path.join(root, "bin", "codex-browser-use"),
    path.join(root, "lib", "stage-adapter.mjs"),
    path.join(root, "scripts", "configure.py"),
    path.join(root, "scripts", "doctor.py"),
  ].map((file) => fs.readFileSync(file, "utf8")).join("\n");
  const originPath = ["/", "Users", "/", "nichi", "katana", "ka"].join("");
  const skillPath = [".codex", "skills"].join("/");
  assert.equal(source.includes(originPath), false);
  assert.equal(source.includes(skillPath), false);
});
