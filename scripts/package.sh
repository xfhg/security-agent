#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PARENT="$(dirname "$ROOT")"
DIRNAME="$(basename "$ROOT")"

detect_platform() {
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)  PLATFORM="darwin-arm64";  SKIP="darwin-amd64 linux-arm64 linux-amd64" ;;
    Darwin-x86_64) PLATFORM="darwin-amd64";  SKIP="darwin-arm64 linux-arm64 linux-amd64" ;;
    Linux-aarch64|Linux-arm64) PLATFORM="linux-arm64"; SKIP="darwin-arm64 darwin-amd64 linux-amd64" ;;
    Linux-x86_64)  PLATFORM="linux-amd64";  SKIP="darwin-arm64 darwin-amd64 linux-arm64" ;;
    *) echo "unsupported: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
  esac
}

platform_excludes() {
  for p in $SKIP; do
    echo "--exclude=$DIRNAME/bins/opencode/$p"
    echo "--exclude=$DIRNAME/bins/ghost/$p"
  done
}

build() {
  local name="$1" offline="$2"
  echo "Building $name ..."

  local extra=""
  if [ "$offline" = "0" ]; then
    extra="--exclude=$DIRNAME/node_modules --exclude=$DIRNAME/.opencode/node_modules --exclude=$DIRNAME/.local"
  else
    extra="--exclude=$DIRNAME/node_modules/.cache --exclude=$DIRNAME/.opencode/node_modules"
    extra="$extra --exclude=$DIRNAME/.local/cache --exclude=$DIRNAME/.local/home --exclude=$DIRNAME/.local/share --exclude=$DIRNAME/.local/state --exclude=$DIRNAME/.local/toolchain"
  fi

  rm -f "$name"
  cd "$PARENT"
  # shellcheck disable=SC2086
  tar czf "$name" \
    --exclude='._*' \
    --exclude='.DS_Store' \
    --exclude="$DIRNAME/.git" \
    --exclude="$DIRNAME/scans" \
    --exclude="$DIRNAME/targets" \
    --exclude="$DIRNAME/.codetree" \
    --exclude="$DIRNAME/.harness/harness.db*" \
    --exclude='*.db-wal' \
    --exclude='*.db-shm' \
    --exclude='*.tar.gz' \
    $(platform_excludes) \
    $extra \
    "$DIRNAME"
  cd "$ROOT"
  echo "  $(du -sh "$PARENT/$name" | cut -f1)"
}

main() {
  detect_platform
  build "vulnops-${PLATFORM}.tar.gz" 0
  build "vulnops-offline-${PLATFORM}.tar.gz" 1
  echo ""
  ls -lh "$PARENT"/vulnops*"$PLATFORM"*.tar.gz
}

main "$@"
