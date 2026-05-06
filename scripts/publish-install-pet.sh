#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

publish_pkg() {
  local dir="$1"
  local extra_args="$2"
  local name version

  name="$(node -p "require('${ROOT_DIR}/${dir}/package.json').name")"
  version="$(node -p "require('${ROOT_DIR}/${dir}/package.json').version")"

  echo ""
  echo "Publishing ${name}@${version} from ${dir}..."
  (cd "${ROOT_DIR}/${dir}" && npm publish ${extra_args})
}

publish_pkg "packages/installer" "--access public"
publish_pkg "packages/open-pets" ""

echo ""
echo "Published. Verify with:"
echo "  npm view @open-pets/installer version"
echo "  npm view install-pet version"
echo "  bunx install-pet@latest --help"
