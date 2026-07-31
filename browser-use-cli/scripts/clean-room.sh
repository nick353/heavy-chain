#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
python_bin="${BROWSER_USE_PYTHON:-$(command -v python3 || true)}"
if [[ -z "${python_bin}" ]]; then
  echo "browser_use_cli_cleanroom_python_missing" >&2
  exit 1
fi
tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/browser-use-cli-cleanroom.XXXXXX")"
trap 'rm -rf "${tmp_root}"' EXIT
state_root="${tmp_root}/state"
config_path="${tmp_root}/browser-use-runtime.toml"
"${python_bin}" "${repo_root}/scripts/configure.py" --state-root "${state_root}" --config "${config_path}"
BROWSER_USE_STATE_ROOT="${state_root}" BROWSER_USE_RUNTIME_CONFIG="${config_path}" "${repo_root}/scripts/doctor.sh" --config "${config_path}" --state-root "${state_root}"
BROWSER_USE_STATE_ROOT="${state_root}" BROWSER_USE_RUNTIME_CONFIG="${config_path}" "${python_bin}" "${repo_root}/bin/codex-browser-use" validate >/dev/null
node --test "${repo_root}/test/portable-smoke.test.mjs"
echo "browser_use_cli_cleanroom_completed"
