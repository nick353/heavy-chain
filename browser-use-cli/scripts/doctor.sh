#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
python_bin="${BROWSER_USE_PYTHON:-$(command -v python3 || true)}"
if [[ -z "${python_bin}" ]]; then
  echo "browser_use_cli_doctor_python_missing" >&2
  exit 1
fi
exec "${python_bin}" "${repo_root}/scripts/doctor.py" "$@"
