#!/bin/sh
# Vendors pure modules from the sibling obsidian-kit repo. Do not hand-edit the
# generated files under src/vendor/kit — re-run this script to update them.
set -e
KIT=../obsidian-kit/src/pure
mkdir -p src/vendor/kit
for f in i18n settings; do
  header="// vendored from obsidian-kit, src/pure/$f.ts — do not hand-edit; re-vendor via tools/sync-kit.sh"
  { printf '%s\n' "$header"; cat "$KIT/$f.ts"; } > "src/vendor/kit/$f.ts"
done
echo "vendored: i18n, settings"
