#!/usr/bin/env bash
# Exercise editor feedback against the same bundled-extension adapters as lifecycle checks.
set -euo pipefail
bash "$(dirname "$0")/extension-lifecycle.sh" \
  hover inlay autosave dirty multiple quickfix stale \
  already-dirty interleaved save-false save-throws apply-false \
  related-retry manual-between multiple-dirty same-line hover-command catalog-save
