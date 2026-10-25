#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Local publishing is only supported on macOS." >&2
  exit 1
fi

npm run electron:build
rsync -a ./release/Leyline-darwin-arm64/Leyline.app /Applications/
mkdir -p "$HOME/.local/bin"
ln -sf "$(pwd)/bin/leyline" "$HOME/.local/bin/leyline"
rm -rf release/Leyline-darwin-arm64
