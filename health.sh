#!/usr/bin/env bash
set -euo pipefail

test -f package.json
test -f agent-harness-kit.config.ts
test -f .harness/feature_list.json
test -f src/cli.ts
node --experimental-strip-types src/cli.ts >/dev/null
