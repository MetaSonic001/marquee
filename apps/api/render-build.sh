#!/usr/bin/env bash
# Render native Python build (no Docker). Ensures Node >= 22.19 for the Qloo harness.
set -euo pipefail

pip install -r requirements.txt

need="22.19.0"
have="$(node --version 2>/dev/null | sed 's/^v//' || echo 0)"
if [ "$(printf '%s\n%s\n' "$need" "$have" | sort -V | head -n1)" != "$need" ]; then
  echo "Node $have < $need — downloading Node 22 LTS into ./.node"
  mkdir -p .node
  curl -fsSL https://nodejs.org/dist/v22.20.0/node-v22.20.0-linux-x64.tar.xz | tar -xJ -C .node --strip-components=1
  export PATH="$PWD/.node/bin:$PATH"
fi
echo "node $(node --version)"
npm ci --omit=dev || npm install --omit=dev
echo "qloo $(./node_modules/.bin/qloo --version)"
