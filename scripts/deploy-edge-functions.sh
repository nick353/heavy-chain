#!/usr/bin/env bash
set -euo pipefail

functions=(
  generate-image
  remove-background
  upscale
  colorize
  generate-variations
  design-gacha
  product-shots
  model-matrix
  multilingual-banner
  optimize-prompt
  bulk-download
  share-link
)

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI is required" >&2
  exit 1
fi

for fn in "${functions[@]}"; do
  echo "Deploying edge function: ${fn}"
  supabase functions deploy "${fn}"
done

echo "Edge function deploy commands completed. Secret values were not printed."
