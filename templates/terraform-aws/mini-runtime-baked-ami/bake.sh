#!/bin/bash
# Bakes an Akto mini-runtime image on Amazon Linux 2023.
# Run as root on a fresh Amazon Linux 2023 instance with internet access:
#   sudo AKTO_INFRA_REF=quick-setup-1.0.0 bash bake.sh
# Packer runs this same script (see mini-runtime.pkr.hcl).
set -euxo pipefail

AKTO_INFRA_REF="${AKTO_INFRA_REF:-quick-setup-1.0.0}"
INSTALL_DIR=/root/akto/infra
export COMPOSE_FILE=docker-compose-mini-runtime.yml

# Docker + unzip
dnf update -y
dnf install -y docker unzip
systemctl enable --now docker

# Same docker-compose version cf-deploy-akto installs
curl -fsSL "https://github.com/docker/compose/releases/download/1.17.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
ln -sf /usr/local/bin/docker-compose /usr/bin/docker-compose

# Akto infra files (compose + env files), pinned to the tag
rm -rf /root/akto
mkdir -p /root/akto
cd /root/akto
curl -fsSL "https://github.com/akto-api-security/infra/archive/refs/tags/${AKTO_INFRA_REF}.zip" -o infra.zip
unzip -q infra.zip
mv infra-* infra
rm infra.zip
echo "LICENSE_KEY=test" >> "$INSTALL_DIR/docker.env"   # same as cf-deploy-akto

# Pre-pull all images except watchtower (it needs internet to work and is not started)
cd "$INSTALL_DIR"
SERVICES=$(docker-compose config --services | grep -v '^watchtower$')
docker-compose pull $SERVICES
docker images

dnf clean all
