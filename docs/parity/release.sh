#!/bin/zsh
# Rebuilds the production input tree (360 files, reverse overlay patch) plus the accepted parity overlay,
# type-checks and builds it, then deploys it to the Heavy Chain Zeabur service.
set -euo pipefail
REPO=${0:A:h:h:h}
OUT=${RELEASE_DIR:-/private/tmp/claude-501/heavy-release}
cd "$REPO"
rm -rf "$OUT" && mkdir -p "$OUT/tree"
python3 -c "import json;[print(f['path']) for f in json.load(open('docs/handoff/production-input-manifest-20261006.json'))['files']]" > "$OUT/list"
# Base = the 2026-10-06 handoff checkpoint commit (not the working tree), then the reverse overlay
# turns it into the exact production input set; fail if any manifest hash differs.
mkdir -p "$OUT/base" && git archive 55b94048 | tar -x -C "$OUT/base"
rsync -a --files-from="$OUT/list" "$OUT/base/" "$OUT/tree/"
(cd "$OUT/tree" && patch -p1 -s -F0 < "$REPO/docs/handoff/production-source-overlay-20261006.patch")
python3 - "$OUT/tree" <<'PY'
import hashlib, json, sys
tree = sys.argv[1]
m = json.load(open('docs/handoff/production-input-manifest-20261006.json'))
bad = [f['path'] for f in m['files'] if hashlib.sha256(open(f"{tree}/{f['path']}", 'rb').read()).hexdigest() != f['sha256']]
if bad: sys.exit(f"production base mismatch: {bad}")
PY
grep -vE '^(#|$)' docs/parity/release-overlay.txt | while read -r f; do mkdir -p "$OUT/tree/${f:h}"; cp "$f" "$OUT/tree/$f"; done
# Files that already differ from production (WIP) ship only as reviewed hunks.
for p in docs/parity/release-patches/*.patch(N); do (cd "$OUT/tree" && patch -p1 -s -F0 -N < "$REPO/$p"); done
cp Dockerfile .dockerignore "$OUT/tree/"
(cd "$OUT/tree" && ln -s "$REPO/node_modules" node_modules && npx tsc -b && npx vite build >/dev/null && rm -rf node_modules dist)
# Zeabur's upload prepare step times out on large file counts (~550 ok, ~900 fails), so the self-hosted
# reference assets travel as one tar that the Docker build unpacks before `npm run build`.
(cd "$OUT/tree/public" && COPYFILE_DISABLE=1 tar --no-xattrs -cf lightchain-assets-bundle.tar lightchain-assets/mirror lightchain-assets/fitting-models lightchain-assets/model-body lightchain-assets/route-icons lightchain-assets/video-templates && rm -rf lightchain-assets/mirror lightchain-assets/fitting-models lightchain-assets/model-body lightchain-assets/route-icons lightchain-assets/video-templates)
echo "files to upload: $(find "$OUT/tree" -type f | wc -l)"
[[ "${1:-}" == "--deploy" ]] && (cd "$OUT/tree" && zeabur deploy --service-id 6a318803302ffbcd03a92935 --json -i=false)
echo "release tree ready: $OUT/tree"
