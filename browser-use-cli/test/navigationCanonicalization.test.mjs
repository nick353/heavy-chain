import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const helperPath = fileURLToPath(new URL("../bin/codex-browser-use", import.meta.url));

test("navigation admission accepts only LinkedIn jobs currentJobId canonicalization", () => {
  const script = String.raw`
import importlib.machinery
import sys
import types
import urllib.parse

loader = importlib.machinery.SourceFileLoader("codex_browser_use_test", sys.argv[1])
module = types.ModuleType(loader.name)
loader.exec_module(module)
matches = module._navigation_exact_url_matches

def check(expected, actual, wanted):
    got = matches(urllib.parse.urlparse(expected), urllib.parse.urlparse(actual))
    assert got is wanted, (expected, actual, got, wanted)

check(
    "https://www.linkedin.com/jobs/search/?keywords=marketing&location=Japan&sortBy=DD",
    "https://www.linkedin.com/jobs/search/?currentJobId=4405084150&sortBy=DD&location=Japan&keywords=marketing",
    True,
)
check(
    "https://www.linkedin.com/jobs/search/?keywords=marketing&location=Japan&sortBy=DD",
    "https://www.linkedin.com/jobs/search-results/?currentJobId=4405084150&sortBy=DD&location=Japan&keywords=marketing",
    True,
)
check(
    "https://www.linkedin.com/jobs/search/?keywords=marketing&location=Japan&sortBy=DD",
    "https://www.linkedin.com/jobs/search-results/?keywords=marketing&location=Japan&sortBy=DD",
    True,
)
check(
    "https://www.linkedin.com/jobs/search/?keywords=marketing&location=Japan&sortBy=DD",
    "https://www.linkedin.com/jobs/search-results/?currentJobId=4408675464&keywords=marketing&f_AL=true",
    False,
)
check(
    "https://www.linkedin.com/jobs/search/?keywords=marketing%20jobs%20in%20Japan&f_AL=true",
    "https://www.linkedin.com/jobs/search-results/?currentJobId=4393097922&keywords=marketing%20jobs%20in%20Japan&f_AL=true",
    True,
)
check(
    "https://www.linkedin.com/jobs/search/?keywords=marketing&location=Japan&sortBy=DD",
    "https://www.linkedin.com/jobs/search/?keywords=engineering&location=Japan&sortBy=DD&currentJobId=4405084150",
    False,
)
check(
    "https://www.linkedin.com/jobs/search/?keywords=marketing&location=Japan&sortBy=DD",
    "https://www.linkedin.com/jobs/search/?keywords=marketing&location=Japan&sortBy=DD&currentJobId=not-a-number",
    False,
)
check(
    "https://www.linkedin.com/jobs/search/?keywords=marketing&location=Japan&sortBy=DD",
    "https://www.linkedin.com/feed/?keywords=marketing&location=Japan&sortBy=DD",
    False,
)
check(
    "https://x.com/home",
    "https://x.com/",
    True,
)
assert module._navigation_ready_state_is_allowed(
    "https://www.linkedin.com/jobs/search/?keywords=marketing",
    "interactive",
)
assert not module._navigation_ready_state_is_allowed(
    "https://www.linkedin.com/feed/",
    "interactive",
)
`;
  const result = spawnSync("python3", ["-c", script, helperPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
