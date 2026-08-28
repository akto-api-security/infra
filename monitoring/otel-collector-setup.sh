#!/usr/bin/env bash
# Downloads and installs the latest otelcol-contrib .deb release for this
# machine's architecture, and wires it up as a systemd service that reads its
# config from a remote URL plus a local override file, restarting hourly to
# pick up changes to either. Always grabs whatever's newest - no version pinning.
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/akto-api-security/infra/feature/vm-monitoring/monitoring"
OVERRIDE_FILE="/etc/otelcol-contrib/override.yaml"

if [ ! -f "$OVERRIDE_FILE" ]; then
  echo "ERROR: override file not found at ${OVERRIDE_FILE} (required - base config has no endpoint/auth on its own)" >&2
  exit 1
fi

ARCH=$(dpkg --print-architecture)
echo "Detected architecture: ${ARCH}"

VERSION=$(curl -sI https://github.com/open-telemetry/opentelemetry-collector-releases/releases/latest \
  | grep -i '^location:' | sed -E 's#.*/tag/v([0-9.]+).*#\1#' | tr -d '\r')
echo "Latest otelcol-contrib version: ${VERSION}"

PKG="otelcol-contrib_${VERSION}_linux_${ARCH}.deb"
echo "Downloading and installing ${PKG}"
curl -sSfL "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/${PKG}" -o "/tmp/${PKG}"
sudo dpkg -i "/tmp/${PKG}"
echo "Installed: $(otelcol-contrib --version)"

echo "Installing systemd units"
for unit in otelcol-contrib.service otelcol-contrib-restart.service otelcol-contrib-restart.timer; do
  sudo curl -sSfL "${REPO_RAW}/${unit}" -o "/etc/systemd/system/${unit}"
done

echo "Enabling and starting otelcol-contrib + hourly restart timer"
sudo systemctl daemon-reload
sudo systemctl enable otelcol-contrib.service
# restart, not just enable --now: the package's own postinst may have already
# started a default instance with the local demo config
sudo systemctl restart otelcol-contrib.service
sudo systemctl enable --now otelcol-contrib-restart.timer

echo "Done: $(sudo systemctl is-active otelcol-contrib.service)"
