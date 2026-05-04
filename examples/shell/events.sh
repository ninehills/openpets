#!/usr/bin/env bash
set -euo pipefail

openpets event thinking --source shell --message "Thinking"
sleep 1
openpets event running --source shell --message "Working"
sleep 1
openpets event testing --source shell --message "Testing"
sleep 1
openpets event success --source shell --message "Done"
