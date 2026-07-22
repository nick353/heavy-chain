#!/usr/bin/env bash
set -euo pipefail

all_functions=(
  generate-image
  edit-image
  remove-background
  upscale
  colorize
  generate-variations
  design-gacha
  product-shots
  model-matrix
  multilingual-banner
  optimize-prompt
  marketing-workspace-artifact
  bulk-download
  share-link
  runway-mcp-connect-start
  runway-mcp-connect-callback
  runway-mcp-connection-status
  runway-mcp-bridge
  submit-feedback
)

jwt_disabled_functions=(
  runway-mcp-connect-callback
)

if [ "$#" -gt 0 ]; then
  functions=("$@")
else
  functions=("${all_functions[@]}")
fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI is required" >&2
  exit 1
fi

for fn in "${functions[@]}"; do
  if [[ ! " ${all_functions[*]} " =~ " ${fn} " ]]; then
    echo "Unknown edge function: ${fn}" >&2
    exit 1
  fi
  echo "Deploying edge function: ${fn}"
  if [[ " ${jwt_disabled_functions[*]} " =~ " ${fn} " ]]; then
    supabase functions deploy "${fn}" --no-verify-jwt
  else
    supabase functions deploy "${fn}"
  fi
done

echo "Edge function deploy commands completed. Secret values were not printed."
