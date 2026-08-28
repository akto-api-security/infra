#!/usr/bin/env bash
# Removes the otelcol-contrib package installed by otel-collector-setup.sh,
# including its config files.
set -euo pipefail

echo "Removing otelcol-contrib"
sudo apt purge -y otelcol-contrib

echo "Done: $(dpkg -l | grep otelcol-contrib || echo 'otelcol-contrib no longer installed')"
