#!/usr/bin/env bash
# Removes the otelcol-contrib package and the systemd wiring installed by
# otel-collector-setup.sh, including its config files.
set -euo pipefail

echo "Stopping and disabling systemd units"
sudo systemctl disable --now otelcol-contrib-restart.timer 2>/dev/null || true
sudo systemctl disable --now otelcol-contrib.service 2>/dev/null || true

echo "Removing systemd unit files"
sudo rm -f /etc/systemd/system/otelcol-contrib.service
sudo rm -f /etc/systemd/system/otelcol-contrib-restart.service
sudo rm -f /etc/systemd/system/otelcol-contrib-restart.timer
sudo systemctl daemon-reload

echo "Removing otelcol-contrib package"
sudo apt purge -y otelcol-contrib

echo "Removing override file"
sudo rm -f /etc/otelcol-contrib/override.yaml

echo "Done: $(dpkg -l | grep otelcol-contrib || echo 'otelcol-contrib no longer installed')"
