# VulnOps v1.0.0 — Multi-Platform Deployment Guide

## Tarballs

| Tarball | Size | Use Case |
|---------|------|----------|
| `vulnops-linux-amd64.tar.gz` | ~181 MB | Linux x86_64 — needs npm install + Python bootstrap (requires network) |
| `vulnops-offline-linux-amd64.tar.gz` | ~926 MB | Linux x86_64 — fully offline, zero network needed |

---

## Platform: Linux x86_64 (Ubuntu 24.04+)

### Prerequisites

- **Node.js 22+** — `node --experimental-strip-types` requires v22+
- **uv** (Python package manager) — for Python runtime bootstrap
- **git** — for cloning target repos

### Option A: Slim Tarball (requires network for initial setup)

```bash
# 1. Extract
tar xzf vulnops-linux-amd64.tar.gz
cd vulnops
export SECURITY_AGENT_HOME="$PWD"

# 2. Download platform binaries (OpenCode, Ghost tools, OpenGrep)
#    These are excluded from git (too large for GitHub) and pinned at specific versions
#    See config/versions.json for exact versions and URLs
bash scripts/bootstrap.sh

# 3. Install npm dependencies
npm install
cd .opencode && npm install && cd ..

# 4. Bootstrap Python runtimes for codetree + semble
uv install 2>/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh
uv venv .local/python/cpython-py312 --python 3.12 --seed
ln -sf python3 .local/python/cpython-py312/bin/python3.12

.local/python/cpython-py312/bin/pip install mcp-server-codetree
mkdir -p .local/venvs/codetree/lib/python3.12/site-packages
cp -r .local/python/cpython-py312/lib/python3.12/site-packages/codetree .local/venvs/codetree/lib/python3.12/site-packages/

.local/python/cpython-py312/bin/pip install semble
mkdir -p .local/venvs/semble/lib/python3.12/site-packages
cp -r .local/python/cpython-py312/lib/python3.12/site-packages/semble .local/venvs/semble/lib/python3.12/site-packages/

# 5. Pre-download OSV vulnerability DB for offline SCA
bash scripts/offline-bootstrap.sh

# 6. Verify toolchain
echo "export SECURITY_AGENT_HOME=\"\$HOME/vulnops\"" >> ~/.bashrc
source ~/.bashrc
cd ~/vulnops
node --experimental-strip-types ./src/cli.ts toolchain verify

# 7. Clone target and scan
mkdir -p targets
git clone <repo-url> targets/<reponame>
bins/shims/opencode
```

Inside OpenCode:
```text
/security-agent-run targets/<reponame> recon,discovery,triage
```

### Option B: Offline Tarball (zero network after extraction)

```bash
# 1. Extract
tar xzf vulnops-offline-linux-amd64.tar.gz
cd vulnops
export SECURITY_AGENT_HOME="$PWD"
echo "export SECURITY_AGENT_HOME=\"\$HOME/vulnops\"" >> ~/.bashrc

# 2. Verify (all tools should report ok)
node --experimental-strip-types ./src/cli.ts toolchain verify

# 3. Pre-download OSV vulnerability DB one time
bash scripts/offline-bootstrap.sh

# 4. Clone target and scan (need git accessible)
mkdir -p targets
git clone <repo-url> targets/<reponame>
bins/shims/opencode
```

Inside OpenCode:
```text
/security-agent-run targets/<reponame> recon,discovery,triage
```

> **Note**: The offline tarball includes pre-built `node_modules/`, Python venvs for codetree + semble, and the opengrep binary. The only remaining online dependency is the initial `git clone` of the target repo and the one-time `scripts/offline-bootstrap.sh` to download the OSV vulnerability database.

---

## Platform: macOS (Development)

### Prerequisites

- **Node.js 22+**
- **npm**
- **Python 3.12** (via uv or homebrew)
- **git**

### Setup from source

```bash
# 1. Clone the control repo
git clone <this-repo-url> vulnops
cd vulnops
export SECURITY_AGENT_HOME="$PWD"

# 2. Download platform binaries
bash scripts/bootstrap.sh

# 3. Install dependencies
npm install
cd .opencode && npm install && cd ..

# 4. Bootstrap Python runtimes
uv venv .local/python/cpython-py312 --python 3.12 --seed
ln -sf python3 .local/python/cpython-py312/bin/python3.12

.local/python/cpython-py312/bin/pip install mcp-server-codetree
mkdir -p .local/venvs/codetree/lib/python3.12/site-packages
cp -r .local/python/cpython-py312/lib/python3.12/site-packages/codetree .local/venvs/codetree/lib/python3.12/site-packages/

.local/python/cpython-py312/bin/pip install semble
mkdir -p .local/venvs/semble/lib/python3.12/site-packages
cp -r .local/python/cpython-py312/lib/python3.12/site-packages/semble .local/venvs/semble/lib/python3.12/site-packages/

# 4. Install opengrep
npm install -g @opengrep/cli 2>/dev/null || curl -sL "$(curl -sL https://api.github.com/repos/opengrep/opengrep/releases/tags/v1.22.0 | grep -o '"browser_download_url": *"[^"]*opengrep_manylinux_x86"' | head -1 | cut -d'"' -f4)" -o bins/tools/opengrep 2>/dev/null
# Or install from Homebrew: brew install opengrep

# 5. Verify
node --experimental-strip-types ./src/cli.ts toolchain verify

# 6. Clone target and run
mkdir -p targets
git clone <repo-url> targets/<reponame>
bins/shims/opencode
```

> **Note**: macOS development does not have an offline tarball. Use `npm install` and `pip install` with network access. The vendored binaries in `bins/opencode/darwin-arm64/` and `bins/ghost/darwin-arm64/` are included in the source repo.

---

## Scan Output

All scan artifacts are written to `scans/<reponame>/` (never inside the target repo).

Key reports:
```
scans/<reponame>/security/executive-summary.md    # CISO summary
scans/<reponame>/security/triage-report.md        # Full triage queue
scans/<reponame>/security/detailed-report.md       # Per-finding detail
scans/<reponame>/security/ghost-findings.md        # Ghost evidence
scans/<reponame>/review/rescore-report.md          # Post-triage rescore
scans/<reponame>/review/checklist.md               # Human review checklist
```

Operational logs are under `scans/<reponame>/workflow/`. Evidence and raw tool output are under `scans/<reponame>/evidence/`.

---

## Supported Tools

| Tool | Linux x86_64 | macOS ARM | Offline |
|------|-------------|-----------|---------|
| OpenCode (agent TUI) | vendored in `bins/` | vendored | yes |
| Cognium (SAST) | npm package | npm package | yes |
| OpenGrep (SAST) | vendored binary | vendored | yes |
| GitNexus (graph) | npm package | npm package | yes |
| codetree (structure) | Python venv | Python venv | yes |
| semble (retrieval) | Python venv | Python venv | yes |
| wraith (SCA) | vendored binary | vendored | yes (with pre-downloaded DB) |
| osv-scanner (SCA) | bundled with wraith | bundled | yes (with pre-downloaded DB) |
| poltergeist (secrets) | vendored binary | vendored | yes |
| AHK (harness) | npm package | npm package | yes |
| filesystem-server (MCP) | npm package | npm package | yes |
