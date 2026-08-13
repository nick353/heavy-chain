#!/usr/bin/env bash
set -euo pipefail

# Synchronize the installed canonical helper only at a safe lifecycle boundary.
# Replacing the entrypoint is allowed only when every active room explicitly
# binds the same helper generation; legacy or older-generation rooms refuse.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
helper_path="${HOME}/.local/bin/codex-browser-use"
source_helper="${repo_root}/bin/codex-browser-use"

if [[ ! -x "${helper_path}" ]]; then
  echo "browser_use_cli_live_sync_helper_missing:${helper_path}" >&2
  exit 1
fi

source_sha256="$(shasum -a 256 "${source_helper}" | awk '{print $1}')"
installed_sha256="$(shasum -a 256 "${helper_path}" | awk '{print $1}')"
rooms_json="$("${source_helper}" rooms --json --sync-admission-source-sha256 "${source_sha256}" --sync-admission-installed-sha256 "${installed_sha256}")" || {
  echo "browser_use_cli_live_sync_rooms_read_failed" >&2
  exit 1
}

if ! printf '%s' "${rooms_json}" | jq -e '.sync_admission.ready == true' >/dev/null; then
  admission_blocker="$(printf '%s' "${rooms_json}" | jq -r '.sync_admission.exact_blocker // empty')"
  blocking_count="$(printf '%s' "${rooms_json}" | jq -r '.sync_admission.blocking_rooms | length')"
  if [[ "${admission_blocker}" != "browser_use_cli_live_rooms_active" || "${blocking_count}" != "1" ]]; then
    printf '%s\n' "${rooms_json}" | jq -c '.sync_admission' >&2
    exit 1
  fi

  # One owner-bound live room may cross the install boundary through an
  # append-only handoff token. The source helper performs the read-only
  # admission/readback; the newly installed helper commits the same token and
  # atomically rebinds only that room's generation. Ambiguous or non-live
  # rooms remain blocked by the helper.
  handoff_json="$("${source_helper}" helper-generation-handoff --phase prepare --source-helper-sha256 "${source_sha256}" --installed-helper-sha256 "${installed_sha256}")"
  handoff_path="$(printf '%s' "${handoff_json}" | jq -er '.handoff | strings')"
  BROWSER_USE_FORCE_INSTALL=1 "${repo_root}/scripts/install.sh"
  "${helper_path}" helper-generation-handoff --phase commit --source-helper-sha256 "${source_sha256}" --installed-helper-sha256 "${installed_sha256}" --handoff "${handoff_path}"
else
  BROWSER_USE_FORCE_INSTALL=1 "${repo_root}/scripts/install.sh"
fi

source_sha256_after="$(shasum -a 256 "${source_helper}" | awk '{print $1}')"
installed_sha256_after="$(shasum -a 256 "${helper_path}" | awk '{print $1}')"
if [[ "${source_sha256_after}" != "${installed_sha256_after}" ]]; then
  echo "browser_use_cli_live_sync_post_install_parity_failed" >&2
  exit 1
fi
post_sync_rooms_json="$("${helper_path}" rooms --json --sync-admission-source-sha256 "${source_sha256_after}" --sync-admission-installed-sha256 "${installed_sha256_after}")"
if ! printf '%s' "${post_sync_rooms_json}" | jq -e '.sync_admission.ready == true' >/dev/null; then
  printf '%s\n' "${post_sync_rooms_json}" | jq -c '.sync_admission' >&2
  exit 1
fi

"${repo_root}/scripts/doctor.sh"
echo "browser_use_cli_live_sync_completed"
