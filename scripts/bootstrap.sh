#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VER="$ROOT/config/versions.json"

detect_platform() {
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) PLATFORM="darwin_arm64"; TAR="" ;;
    Darwin-x86_64) PLATFORM="darwin_amd64"; TAR="" ;;
    Linux-aarch64|Linux-arm64) PLATFORM="linux_arm64"; TAR="" ;;
    Linux-x86_64) PLATFORM="linux_amd64"; TAR="" ;;
    *) echo "unsupported: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
  esac
}

get_url() {
  local tool="$1"
  python3 -c "import json,sys; d=json.load(open('$VER')); v=list(d['$tool'].keys())[0]; print(d['$tool'][v].get(sys.argv[1],''))" "$2"
}

download() {
  local tool="$1" dest="$2" key="$3"
  local url extra=""
  url=$(get_url "$tool" "$key")
  if [ -z "$url" ]; then
    echo "  [SKIP] $tool: no URL for $PLATFORM/$key" >&2
    return 0
  fi
  # wraith and poltergeist are .tar.gz, others are raw binaries
  if [[ "$tool" =~ ^(wraith|poltergeist)$ ]]; then
    local tmp=$(mktemp -d)
    curl -sL "$url" -o "$tmp/archive.tar.gz"
    tar xzf "$tmp/archive.tar.gz" -C "$tmp"
    find "$tmp" -name "$tool" -type f -exec cp {} "$dest" \;
    rm -rf "$tmp"
  else
    curl -sL "$url" -o "$dest"
  fi
  chmod +x "$dest"
  echo "  -> $dest"
}

main() {
  detect_platform
  echo "VulnOps bootstrap — platform: $PLATFORM"
  echo ""

  mkdir -p "$ROOT/bins/opencode/$PLATFORM"
  mkdir -p "$ROOT/bins/ghost/$PLATFORM"
  mkdir -p "$ROOT/bins/tools"

  # opencode binary
  if [ -x "$ROOT/bins/opencode/$PLATFORM/opencode" ]; then
    echo "  [OK] opencode already present"
  else
    download opencode "$ROOT/bins/opencode/$PLATFORM/opencode" "$PLATFORM"
  fi

  # osv-scanner (required for Ghost SCA, >50MB — excluded from git)
  if [ -x "$ROOT/bins/ghost/$PLATFORM/osv-scanner" ]; then
    echo "  [OK] osv-scanner already present"
  else
    download osv_scanner "$ROOT/bins/ghost/$PLATFORM/osv-scanner" "$PLATFORM"
  fi

  # wraith
  if [ -x "$ROOT/bins/ghost/$PLATFORM/wraith" ]; then
    echo "  [OK] wraith already present"
  else
    download wraith "$ROOT/bins/ghost/$PLATFORM/wraith" "$PLATFORM"
  fi

  # poltergeist
  if [ -x "$ROOT/bins/ghost/$PLATFORM/poltergeist" ]; then
    echo "  [OK] poltergeist already present"
  else
    download poltergeist "$ROOT/bins/ghost/$PLATFORM/poltergeist" "$PLATFORM"
  fi

  # opengrep (platform key differs: linux_x86 not linux_amd64)
  local ogkey="$PLATFORM"
  case "$PLATFORM" in
    linux_amd64) ogkey="linux_x86" ;;
    darwin_amd64) ogkey="darwin_x86" ;;
  esac
  if [ -x "$ROOT/bins/tools/opengrep" ]; then
    echo "  [OK] opengrep already present"
  else
    download opengrep "$ROOT/bins/tools/opengrep" "$ogkey"
  fi

  echo ""
  echo "bootstrap complete."
  echo "Next: npm install && cd .opencode && npm install && cd .."
  echo "Then: bash scripts/offline-bootstrap.sh (for Ghost SCA offline DB)"
}

main "$@"
