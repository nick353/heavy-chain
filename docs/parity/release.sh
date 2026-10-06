#!/bin/zsh
# Rebuilds the production input tree (360 files, reverse overlay patch) plus the accepted parity overlay,
# type-checks and builds it, then deploys it to the Heavy Chain Zeabur service.
set -euo pipefail
REPO=${0:A:h:h:h}
OUT=${RELEASE_DIR:-/private/tmp/claude-501/heavy-release}
cd "$REPO"
rm -rf "$OUT" && mkdir -p "$OUT/tree"
python3 -c "import json;[print(f['path']) for f in json.load(open('docs/handoff/production-input-manifest-20261006.json'))['files']]" > "$OUT/list"
rsync -a --files-from="$OUT/list" . "$OUT/tree/"
(cd "$OUT/tree" && patch -p1 -s < "$REPO/docs/handoff/production-source-overlay-20261006.patch")
grep -vE '^(#|$)' docs/parity/release-overlay.txt | while read -r f; do mkdir -p "$OUT/tree/${f:h}"; cp "$f" "$OUT/tree/$f"; done
cp Dockerfile .dockerignore "$OUT/tree/"
(cd "$OUT/tree" && ln -s "$REPO/node_modules" node_modules && npx tsc -b && npx vite build >/dev/null && rm -rf node_modules dist)
[[ "${1:-}" == "--deploy" ]] && (cd "$OUT/tree" && zeabur deploy --service-id 6a318803302ffbcd03a92935 --json -i=false)
echo "release tree ready: $OUT/tree"
