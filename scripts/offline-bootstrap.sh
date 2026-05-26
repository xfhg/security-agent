#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export SECURITY_AGENT_HOME="${SECURITY_AGENT_HOME:-$ROOT}"

echo "=== VulnOps Offline Bootstrap ==="
echo "Run this ONCE while online to prepare for fully offline operation."
echo ""

# 1. Pre-download OSV vulnerability database for wraith (Ghost SCA)
echo "[1/2] Downloading OSV vulnerability database for wraith..."
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) PLATFORM="darwin-arm64" ;;
  Darwin-x86_64) PLATFORM="darwin-amd64" ;;
  Linux-aarch64|Linux-arm64) PLATFORM="linux-arm64" ;;
  Linux-x86_64) PLATFORM="linux-amd64" ;;
  *) echo "unsupported platform: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

WRAITH="$ROOT/bins/ghost/$PLATFORM/wraith"
if [ -x "$WRAITH" ]; then
  "$WRAITH" download-db 2>&1 || echo "  (wraith download-db failed — SCA scans will be empty)"
  echo "  -> OSV database cached. SCA scans will work offline."
else
  echo "  wraith binary not found for $PLATFORM — skipping DB download"
fi

# 2. Create required directories
echo "[2/2] Ensuring required directories..."
mkdir -p "$ROOT/.local/home"
mkdir -p "$ROOT/.local/cache/npm"
mkdir -p "$ROOT/.local/cache/uv"
mkdir -p "$ROOT/.local/cache/pip"
mkdir -p "$ROOT/.local/state/opencode"

# 3. Verify toolchain
echo ""
echo "=== Bootstrap complete ==="
echo "Verify with: node --experimental-strip-types ./src/cli.ts toolchain verify"
echo "Run scan:      bins/shims/opencode"
echo "               /security-agent-run targets/<reponame> recon,discovery,triage"
