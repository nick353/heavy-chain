#!/usr/bin/env bash
set -euo pipefail

mode="${SUPABASE_VERIFY_MODE:-static}"
if [[ "$mode" != "static" ]]; then
  echo "Supabase remote verification is not available in this shell; run the connector-backed migration/readback after reauthentication." >&2
  exit 2
fi

active_paths=(
  src
  supabase/functions
  supabase/config.toml
  scripts/deploy-edge-functions.sh
  scripts/check-env.mjs
  package.json
)

if rg -n -i "runway|runway_mcp|local-runway" "${active_paths[@]}"; then
  echo "Static verification failed: Runway reference remains in active product/runtime paths." >&2
  exit 1
fi

for function_name in generate-image edit-image remove-background upscale colorize generate-variations design-gacha product-shots model-matrix multilingual-banner optimize-prompt bulk-download share-link marketing-workspace-artifact; do
  test -f "supabase/functions/${function_name}/index.ts"
done

grep -q "generateOpenAiImage" supabase/functions/_shared/openaiImage.ts
grep -q "editOpenAiImage" supabase/functions/_shared/openaiImage.ts
grep -q "generateProviderImage" supabase/functions/_shared/imageProvider.ts
grep -q "selectedProvider" supabase/functions/generate-image/index.ts
grep -q "return 'openai'" supabase/functions/generate-image/index.ts

echo "Supabase static verification passed. Retired provider runtime paths are absent; no API call, generation, migration apply, or deploy was performed."
