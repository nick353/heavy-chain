#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
python_bin="${BROWSER_USE_PYTHON:-$(command -v python3 || true)}"
if [[ -z "${python_bin}" ]]; then
  echo "browser_use_cli_installer_smoke_python_missing" >&2
  exit 1
fi

tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/browser-use-cli-installer-smoke.XXXXXX")"
trap 'rm -rf "${tmp_root}"' EXIT

conflict_home="${tmp_root}/conflict-home"
conflict_state="${conflict_home}/state"
mkdir -p "${conflict_home}/.local/bin"
printf '%s\n' '# pre-existing helper' > "${conflict_home}/.local/bin/codex-browser-use"
chmod 700 "${conflict_home}/.local/bin/codex-browser-use"
if HOME="${conflict_home}" BROWSER_USE_STATE_ROOT="${conflict_state}" BROWSER_USE_RUNTIME_CONFIG="${conflict_state}/browser-use-runtime.toml" BROWSER_USE_PYTHON="${python_bin}" "${repo_root}/scripts/install.sh"; then
  echo "browser_use_cli_installer_smoke_conflict_not_rejected" >&2
  exit 1
fi
test ! -e "${conflict_state}/browser-use-runtime.toml"
test "$(cat "${conflict_home}/.local/bin/codex-browser-use")" = '# pre-existing helper'

locked_home="${tmp_root}/locked-home"
locked_state="${locked_home}/state"
mkdir -p "${locked_home}"
mkdir "${locked_home}/.browser-use-cli.install.lock"
if HOME="${locked_home}" BROWSER_USE_STATE_ROOT="${locked_state}" BROWSER_USE_RUNTIME_CONFIG="${locked_state}/browser-use-runtime.toml" BROWSER_USE_PYTHON="${python_bin}" "${repo_root}/scripts/install.sh"; then
  echo "browser_use_cli_installer_smoke_lock_not_rejected" >&2
  exit 1
fi
test ! -e "${locked_state}"
test ! -e "${locked_home}/.local"
rmdir "${locked_home}/.browser-use-cli.install.lock"

clean_home="${tmp_root}/clean-home"
clean_state="${clean_home}/state"
mkdir -p "${clean_home}"
for _attempt in 1 2; do
  HOME="${clean_home}" BROWSER_USE_STATE_ROOT="${clean_state}" BROWSER_USE_RUNTIME_CONFIG="${clean_state}/browser-use-runtime.toml" BROWSER_USE_PYTHON="${python_bin}" "${repo_root}/scripts/install.sh" >/dev/null
done
test -f "${clean_home}/.local/bin/codex-browser-use"
test ! -L "${clean_home}/.local/bin/codex-browser-use"
cmp -s "${repo_root}/bin/codex-browser-use" "${clean_home}/.local/bin/codex-browser-use"

rollback_home="${tmp_root}/rollback-home"
rollback_state="${rollback_home}/state"
rollback_bin="${tmp_root}/rollback-bin"
mkdir -p "${rollback_home}/.local/bin" "${rollback_bin}"
chmod 755 "${rollback_home}/.local/bin"
ln -s "$(command -v browser-use)" "${rollback_bin}/browser-use"
ln -s "$(command -v ffmpeg)" "${rollback_bin}/ffmpeg"
ln -s "$(command -v ffprobe)" "${rollback_bin}/ffprobe"
broken_helper_target="${rollback_home}/missing-codex-browser-use"
ln -s "${broken_helper_target}" "${rollback_home}/.local/bin/codex-browser-use"
mkdir -p "${rollback_state}"
printf '%s\n' '# previous config' > "${rollback_state}/browser-use-runtime.toml"
chmod 600 "${rollback_state}/browser-use-runtime.toml"
rollback_status=0
PATH="${rollback_bin}:/bin:/usr/bin" HOME="${rollback_home}" BROWSER_USE_FORCE_INSTALL=1 BROWSER_USE_STATE_ROOT="${rollback_state}" BROWSER_USE_RUNTIME_CONFIG="${rollback_state}/browser-use-runtime.toml" BROWSER_USE_PYTHON="${python_bin}" "${repo_root}/scripts/install.sh" >/dev/null 2>&1 || rollback_status=$?
test "${rollback_status}" -ne 0
test -L "${rollback_home}/.local/bin/codex-browser-use"
test "$(readlink "${rollback_home}/.local/bin/codex-browser-use")" = "${broken_helper_target}"
test "$(cat "${rollback_state}/browser-use-runtime.toml")" = '# previous config'
test "$("${python_bin}" -c 'import os,stat,sys; print(f"{stat.S_IMODE(os.stat(sys.argv[1]).st_mode):04o}")' "${rollback_home}/.local/bin")" = 0755
test -z "$(find "${rollback_state}" -mindepth 1 -maxdepth 1 -type d -print -quit)"
test -z "$(find "${rollback_home}/.local/bin" -name '*.backup.*' -print -quit)"
test ! -e "${rollback_home}/.browser-use-cli.install.lock"

parent_home="${tmp_root}/parent-rollback-home"
parent_state="${parent_home}/state"
mkdir -p "${parent_home}" "${parent_state}"
printf '%s\n' '# previous config' > "${parent_state}/browser-use-runtime.toml"
chmod 600 "${parent_state}/browser-use-runtime.toml"
parent_rollback_status=0
PATH="${rollback_bin}:/bin:/usr/bin" HOME="${parent_home}" BROWSER_USE_STATE_ROOT="${parent_state}" BROWSER_USE_RUNTIME_CONFIG="${parent_state}/browser-use-runtime.toml" BROWSER_USE_PYTHON="${python_bin}" "${repo_root}/scripts/install.sh" >/dev/null 2>&1 || parent_rollback_status=$?
test "${parent_rollback_status}" -ne 0
test "$(cat "${parent_state}/browser-use-runtime.toml")" = '# previous config'
test ! -e "${parent_home}/.local"
test ! -e "${parent_home}/.browser-use-cli.install.lock"
echo "browser_use_cli_installer_smoke_completed"
