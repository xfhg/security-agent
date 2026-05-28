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
    echo "--exclude=$DIRNAME/bins/ghost/${p//-/_}"
  done
  # Also exclude underscore variant of the current platform (duplicate bins dir)
  echo "--exclude=$DIRNAME/bins/opencode/${PLATFORM//-/_}"
  echo "--exclude=$DIRNAME/bins/ghost/${PLATFORM//-/_}"
}

prune_node_native_binaries() {
  local nm="$ROOT/node_modules"

  echo "Pruning non-$PLATFORM native binaries from node_modules..."

  # onnxruntime cross-platform natives
  find "$nm" -path "*/napi-v6/darwin"     -exec rm -rf {} + 2>/dev/null || true
  find "$nm" -path "*/napi-v6/win32"      -exec rm -rf {} + 2>/dev/null || true
  find "$nm" -path "*/napi-v6/linux/arm64" -exec rm -rf {} + 2>/dev/null || true

  # CUDA provider (not needed on CPU-only offline servers)
  find "$nm" -path "*/napi-v6/linux/x64/*cuda*" -delete 2>/dev/null || true

  # onnxruntime-web is browser-only — remove entire package
  find "$nm" -path "*/onnxruntime-web" -prune -exec rm -rf {} + 2>/dev/null || true

  # tree-sitter cross-platform prebuilds
  find "$nm" -path "*/prebuilds/darwin-*"       -exec rm -rf {} + 2>/dev/null || true
  find "$nm" -path "*/prebuilds/win32-*"        -exec rm -rf {} + 2>/dev/null || true
  find "$nm" -path "*/prebuilds/linux-arm64"    -exec rm -rf {} + 2>/dev/null || true
  find "$nm" -name "*.wasm" -delete 2>/dev/null || true

  # tree-sitter parser.c source files (only needed at build time; prebuilds suffice at runtime)
  find "$nm" -path "*/tree-sitter-*/src/parser.c" -delete 2>/dev/null || true
  find "$nm" -path "*/vendor/tree-sitter-*/src/parser.c" -delete 2>/dev/null || true

  # sharp musl variant (keep glibc for linux-amd64)
  find "$nm" -path "*sharp-libvips-linuxmusl*" -exec rm -rf {} + 2>/dev/null || true

  # Windows-specific onnxruntime DLLs
  find "$nm" \( -name "DirectML.dll" -o -name "dxcompiler.dll" -o -name "onnxruntime.dll" -o -name "onnxruntime_providers_shared.dll" \) -delete 2>/dev/null || true

  # macOS-specific onnxruntime dylibs (top-level too, not just napi-v6/darwin)
  find "$nm" -name "*.dylib" -delete 2>/dev/null || true

  echo "  done pruning."
}

build() {
  local name="$1" offline="$2"
  echo "Building $name ..."

  local extra=""
  if [ "$offline" = "0" ]; then
    extra="--exclude=$DIRNAME/node_modules --exclude=$DIRNAME/.opencode/node_modules --exclude=$DIRNAME/.local"
  else
    prune_node_native_binaries
    extra="--exclude=$DIRNAME/node_modules/.cache --exclude=$DIRNAME/.opencode/node_modules"
    extra="$extra --exclude=$DIRNAME/.local/cache --exclude=$DIRNAME/.local/home --exclude=$DIRNAME/.local/share --exclude=$DIRNAME/.local/state --exclude=$DIRNAME/.local/toolchain"
    extra="$extra --exclude=$DIRNAME/.local/osv-cache"
  fi

  rm -f "$name"
  cd "$PARENT"
  # shellcheck disable=SC2086
  tar czf "$name" \
    --exclude='._*' \
    --exclude='.DS_Store' \
    --exclude="$DIRNAME/.git" \
    --exclude='**/.git' \
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

build_offline() {
  build "$1" 1
}

main() {
  detect_platform

  # Download OSV vulnerability database for offline SCA capability
  echo "Downloading OSV vulnerability database..."
  WRAITH="$ROOT/bins/ghost/$PLATFORM/wraith"
  if [ -x "$WRAITH" ]; then
    "$WRAITH" download-db 2>&1 || echo "  (wraith download-db failed — SCA offline scans will be empty without it)"
    echo "  -> OSV database cached."
  else
    echo "  wraith binary not found — skipping DB download"
  fi

  # Slim tarball (no node_modules, no .local, no OSV DB)
  build "vulnops-${PLATFORM}.tar.gz" 0

  # Offline tarball: include OSV cache by copying into workspace
  echo "Preparing OSV cache for offline tarball..."
  OSV_CACHE_DIR="$ROOT/.local/osv-cache"
  rm -rf "$OSV_CACHE_DIR"
  mkdir -p "$OSV_CACHE_DIR"
  for SRC in "$HOME/Library/Caches/osv-scanner" "$HOME/.cache/osv-scanner"; do
    if [ -d "$SRC" ] && [ "$(ls -A "$SRC" 2>/dev/null)" ]; then
      cp -r "$SRC"/* "$OSV_CACHE_DIR/" 2>/dev/null || true
      echo "  -> Copied OSV cache from $SRC"
      break
    fi
  done
  if [ -z "$(ls -A "$OSV_CACHE_DIR" 2>/dev/null)" ]; then
    echo "  (OSV cache is empty — offline SCA will need network)"
    touch "$OSV_CACHE_DIR/.keep"
  fi

  build_offline "vulnops-offline-${PLATFORM}.tar.gz"

  echo ""
  ls -lh "$PARENT"/vulnops*"$PLATFORM"*.tar.gz
}

main "$@"
