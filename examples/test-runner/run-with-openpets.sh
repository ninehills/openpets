#!/usr/bin/env bash
set -euo pipefail

openpets event testing --source shell --message "Running tests"

if bun test; then
  openpets event success --source shell --message "All tests passed"
else
  openpets event error --source shell --message "Tests failed"
  exit 1
fi
