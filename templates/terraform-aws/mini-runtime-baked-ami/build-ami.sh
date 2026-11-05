#!/bin/bash
# Builds the mini-runtime AMI with Packer.
# Usage:
#   ./build-ami.sh                                   # build in ap-south-1
#   REGION=us-east-1 ./build-ami.sh                  # build in another region
#   AMI_REGIONS=us-east-1,eu-west-1 ./build-ami.sh   # also copy the AMI to these regions
set -euo pipefail

REGION="${REGION:-ap-south-1}"
AMI_REGIONS="${AMI_REGIONS:-}"

# Packer list syntax for the extra regions, e.g. ["us-east-1","eu-west-1"]
AMI_REGIONS_HCL="[]"
if [ -n "$AMI_REGIONS" ]; then
  AMI_REGIONS_HCL="[\"${AMI_REGIONS//,/\",\"}\"]"
fi

cd "$(dirname "$0")"
packer init .
packer build -var "region=$REGION" -var "ami_regions=$AMI_REGIONS_HCL" .
