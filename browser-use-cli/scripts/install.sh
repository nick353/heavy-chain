#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
python_bin="${BROWSER_USE_PYTHON:-$(command -v python3 || true)}"
if [[ -z "${python_bin}" ]]; then
  echo "browser_use_cli_install_python_missing" >&2
  exit 1
fi

state_root="${BROWSER_USE_STATE_ROOT:-${HOME}/.browser-use-cli}"
config_path="${BROWSER_USE_RUNTIME_CONFIG:-${state_root}/browser-use-runtime.toml}"
bin_dir="${HOME}/.local/bin"
local_dir="${HOME}/.local"
link_path="${bin_dir}/codex-browser-use"
target_path="${repo_root}/bin/codex-browser-use"
install_lock_path="${HOME}/.browser-use-cli.install.lock"

if [[ -e "${install_lock_path}" || -L "${install_lock_path}" ]]; then
  echo "browser_use_cli_install_concurrent_install:${install_lock_path}" >&2
  exit 1
fi
if ! mkdir "${install_lock_path}" 2>/dev/null; then
  echo "browser_use_cli_install_concurrent_install:${install_lock_path}" >&2
  exit 1
fi
if ! chmod 700 "${install_lock_path}"; then
  rmdir "${install_lock_path}" 2>/dev/null || true
  echo "browser_use_cli_install_lock_permission_failed:${install_lock_path}" >&2
  exit 1
fi
lock_acquired=1

cleanup_install_lock() {
  if [[ "${lock_acquired}" == "1" ]]; then
    rm -f "${install_lock_path}/owner"
    rmdir "${install_lock_path}" 2>/dev/null || true
    lock_acquired=0
  fi
}
trap cleanup_install_lock EXIT
printf 'pid=%s\n' "$$" > "${install_lock_path}/owner"

if ! "${python_bin}" -c 'import importlib.metadata; importlib.metadata.version("browser-use")' >/dev/null 2>&1; then
  if [[ "${BROWSER_USE_INSTALL_DEPS:-0}" == "1" ]]; then
    "${python_bin}" -m pip install --user "browser-use==0.13.7" "imageio[ffmpeg]" numpy Pillow
  else
    echo "browser_use_cli_install_browser_use_missing:set BROWSER_USE_INSTALL_DEPS=1 or install browser-use==0.13.7" >&2
    exit 1
  fi
fi

if [[ -L "${config_path}" ]]; then
  echo "browser_use_cli_install_config_symlink_refused:${config_path}" >&2
  exit 1
fi
if [[ -e "${config_path}" && ! -f "${config_path}" ]]; then
  echo "browser_use_cli_install_config_not_regular:${config_path}" >&2
  exit 1
fi
if [[ -L "${local_dir}" ]]; then
  echo "browser_use_cli_install_local_symlink_refused:${local_dir}" >&2
  exit 1
fi
if [[ -e "${local_dir}" && ! -d "${local_dir}" ]]; then
  echo "browser_use_cli_install_local_not_directory:${local_dir}" >&2
  exit 1
fi
if [[ -L "${bin_dir}" ]]; then
  echo "browser_use_cli_install_bin_symlink_refused:${bin_dir}" >&2
  exit 1
fi
if [[ -e "${bin_dir}" && ! -d "${bin_dir}" ]]; then
  echo "browser_use_cli_install_bin_not_directory:${bin_dir}" >&2
  exit 1
fi

state_root_real="$("${python_bin}" -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "${state_root}")"
state_paths=(
  "${state_root_real}"
  "${state_root_real}/home"
  "${state_root_real}/profiles"
  "${state_root_real}/profiles/scheduled"
  "${state_root_real}/profiles/single-use"
  "${state_root_real}/profiles/temporary"
  "${state_root_real}/receipts"
  "${state_root_real}/locks"
  "${state_root_real}/quarantine"
  "${state_root_real}/downloads"
  "${state_root_real}/logs"
  "${state_root_real}/recordings"
  "${state_root_real}/recording-runtime"
  "${state_root_real}/recording-runtime/deps"
)
created_state_paths=()
for state_path in "${state_paths[@]}"; do
  if [[ ! -e "${state_path}" && ! -L "${state_path}" ]]; then
    created_state_paths+=("${state_path}")
  fi
done
sitecustomize_path="${state_root_real}/recording-runtime/sitecustomize.py"
sitecustomize_existed=0
if [[ -e "${sitecustomize_path}" || -L "${sitecustomize_path}" ]]; then
  sitecustomize_existed=1
fi
bin_dir_existed=0
bin_dir_mode=""
if [[ -d "${bin_dir}" ]]; then
  bin_dir_existed=1
  bin_dir_mode="$("${python_bin}" -c 'import os,stat,sys; print(f"{stat.S_IMODE(os.stat(sys.argv[1]).st_mode):04o}")' "${bin_dir}")"
fi
local_dir_existed=0
if [[ -d "${local_dir}" ]]; then
  local_dir_existed=1
fi
config_parent="$(dirname "${config_path}")"
config_parent_existed=0
if [[ -e "${config_parent}" ]]; then
  config_parent_existed=1
fi

existing_helper=0
existing_helper_same_target=0
existing_helper_symlink=0
if [[ ! -f "${target_path}" || -L "${target_path}" ]]; then
  echo "browser_use_cli_install_source_not_regular:${target_path}" >&2
  exit 1
fi
if [[ -e "${link_path}" || -L "${link_path}" ]]; then
  existing_helper=1
  if [[ -L "${link_path}" ]]; then
    existing_helper_symlink=1
  fi
  resolved="$("${python_bin}" -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "${link_path}")"
  if [[ "${resolved}" == "${target_path}" ]]; then
    existing_helper_same_target=1
  elif [[ -f "${link_path}" && ! -L "${link_path}" ]] && cmp -s "${link_path}" "${target_path}"; then
    existing_helper_same_target=1
  elif [[ "${BROWSER_USE_FORCE_INSTALL:-0}" != "1" ]]; then
    echo "browser_use_cli_install_existing_helper_conflict:${link_path}" >&2
    exit 1
  fi
fi

mkdir -p "${bin_dir}"
chmod 700 "${bin_dir}"

backup_dir=""
config_backup=""
config_had_existing=0
backup_helper=""
temporary_helper="${link_path}.tmp.$$"
transaction_succeeded=0
link_swap_succeeded=0

cleanup_created_paths() {
  if [[ "${sitecustomize_existed}" == "0" && -f "${sitecustomize_path}" ]]; then
    if [[ "$(cat "${sitecustomize_path}")" == '# Browser Use recording runtime marker.' ]]; then
      rm -f "${sitecustomize_path}"
    fi
  fi
  for ((index=${#created_state_paths[@]} - 1; index >= 0; index--)); do
    state_path="${created_state_paths[index]}"
    if [[ -d "${state_path}" && -z "$(find "${state_path}" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
      rmdir "${state_path}"
    fi
  done
  if [[ "${config_parent_existed}" == "0" && -d "${config_parent}" && -z "$(find "${config_parent}" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    rmdir "${config_parent}"
  fi
  if [[ "${bin_dir_existed}" == "1" ]]; then
    chmod "${bin_dir_mode}" "${bin_dir}"
  elif [[ -d "${bin_dir}" && -z "$(find "${bin_dir}" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    rmdir "${bin_dir}"
  fi
  if [[ "${local_dir_existed}" == "0" && -d "${local_dir}" && -z "$(find "${local_dir}" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    rmdir "${local_dir}"
  fi
}

rollback_install() {
  if [[ "${transaction_succeeded}" != "1" ]]; then
    rm -f "${temporary_helper}"
    if [[ -n "${backup_helper}" && ( -e "${backup_helper}" || -L "${backup_helper}" ) ]]; then
      rm -f "${link_path}"
      mv "${backup_helper}" "${link_path}"
    elif [[ "${link_swap_succeeded}" == "1" ]]; then
      rm -f "${link_path}"
      if [[ "${existing_helper_same_target}" == "1" && "${existing_helper_symlink}" == "1" ]]; then
        ln -s "${target_path}" "${link_path}"
      fi
    fi
    if [[ "${config_had_existing}" == "1" ]]; then
      cp -p "${config_backup}" "${config_path}"
    else
      rm -f "${config_path}"
    fi
    cleanup_created_paths
    echo "browser_use_cli_install_rolled_back" >&2
  fi
  if [[ -n "${backup_dir}" ]]; then
    rm -rf "${backup_dir}"
  fi
  cleanup_install_lock
}
trap rollback_install EXIT

mkdir -p "${bin_dir}"
chmod 700 "${bin_dir}"

if [[ -e "${config_path}" ]]; then
  backup_dir="$(mktemp -d "${TMPDIR:-/tmp}/browser-use-cli-config-backup.XXXXXX")"
  config_backup="${backup_dir}/browser-use-runtime.toml"
  cp -p "${config_path}" "${config_backup}"
  config_had_existing=1
fi

"${python_bin}" "${repo_root}/scripts/configure.py" --state-root "${state_root}" --config "${config_path}"

if [[ "${existing_helper}" == "1" ]]; then
  backup_helper="${link_path}.backup.$(date +%Y%m%d%H%M%S).$$"
  mv "${link_path}" "${backup_helper}"
fi

cp -p "${target_path}" "${temporary_helper}"
chmod 700 "${temporary_helper}"
if [[ ! -f "${temporary_helper}" || -L "${temporary_helper}" ]]; then
  echo "browser_use_cli_install_staged_helper_not_regular:${temporary_helper}" >&2
  exit 1
fi
mv -f "${temporary_helper}" "${link_path}"
link_swap_succeeded=1
chmod 700 "${link_path}"

"${repo_root}/scripts/doctor.sh" --config "${config_path}" --state-root "${state_root}"
transaction_succeeded=1
echo "browser_use_cli_install_completed:${target_path}"
