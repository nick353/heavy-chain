#!/usr/bin/env bash
set -euo pipefail

package_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "${package_root}"

expected_files=(
  ".gitignore"
  "README.md"
  "SECURITY.md"
  "bin/codex-browser-use"
  "lib/stage-adapter.mjs"
  "package.json"
  "scripts/clean-room.sh"
  "scripts/configure.py"
  "scripts/doctor.py"
  "scripts/doctor.sh"
  "scripts/install.sh"
  "scripts/installer-smoke.sh"
  "scripts/publication-scan.sh"
  "test/portable-smoke.test.mjs"
  "test/record-recover.test.mjs"
)

is_expected_file() {
  local candidate="$1"
  local expected
  for expected in "${expected_files[@]}"; do
    if [[ "${candidate}" == "./${expected}" ]]; then
      return 0
    fi
  done
  return 1
}

unexpected_file=""
while IFS= read -r candidate; do
  case "${candidate}" in
    ./*/__pycache__/*.pyc)
      if [[ -L "${candidate}" ]]; then
        unexpected_file="${candidate}"
        break
      fi
      continue
      ;;
  esac
  if ! is_expected_file "${candidate}"; then
    unexpected_file="${candidate}"
    break
  fi
done < <(find . \( -type f -o -type l \) -print)
if [[ -n "${unexpected_file}" ]]; then
  echo "browser_use_cli_publication_unexpected_file:${unexpected_file}" >&2
  exit 1
fi

for expected in "${expected_files[@]}"; do
  if [[ ! -f "./${expected}" ]]; then
    echo "browser_use_cli_publication_expected_file_missing:${expected}" >&2
    exit 1
  fi
done

if rg -n -i --hidden --glob '!.git/**' --glob '!__pycache__/**' --glob '!scripts/publication-scan.sh' 'ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|BEGIN (OPENSSH|RSA|EC|PRIVATE) KEY|Bearer [A-Za-z0-9._-]{20,}|/Users/|nichikatanaka|\.codex/skills|automation-kernel-run' .; then
  echo "browser_use_cli_publication_secret_scan_failed" >&2
  exit 1
fi
if rg -n -i --hidden --glob '!.git/**' --glob '!__pycache__/**' --glob '!*.md' --glob '!scripts/publication-scan.sh' '"(storageState|cookies|localStorage|sessionStorage)"[[:space:]]*:[[:space:]]*|ws://|wss://|data:text/html|eyJ[A-Za-z0-9_-]{20,}\.' .; then
  echo "browser_use_cli_publication_state_scan_failed" >&2
  exit 1
fi
echo "browser_use_cli_publication_scan_passed"
