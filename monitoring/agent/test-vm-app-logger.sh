#!/usr/bin/env bash
# Minimal script for validating the Azure VM Application pipeline (packaging,
# upload, gallery, install/update/remove command wiring) in isolation from the
# real otel-collector install logic in install-otel-collector.sh. Not meant to
# be assigned to any VM outside of this test.
set -euo pipefail

LOG_FILE="/var/log/vm-app-test.log"
ACTION="${1:-install}"

{
  echo "==== $(date -u +%Y-%m-%dT%H:%M:%SZ) ===="
  echo "action: ${ACTION}"
  echo "hostname: $(hostname)"
  echo "user: $(whoami)"
} >> "${LOG_FILE}"

echo "Logged '${ACTION}' to ${LOG_FILE}"
