#!/bin/bash
# Deletes a mini-runtime AMI: deregisters it and deletes its snapshot.
# Usage:
#   ./delete-ami.sh <region> <ami-id>
# Run once per region the AMI exists in. Cannot be undone.
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <region> <ami-id>" >&2
  exit 1
fi
REGION="$1"
AMI_ID="$2"

# Snapshot ID has to be read before deregistering
SNAP_ID=$(aws ec2 describe-images --region "$REGION" --image-ids "$AMI_ID" \
  --query 'Images[0].BlockDeviceMappings[0].Ebs.SnapshotId' --output text)

aws ec2 deregister-image --region "$REGION" --image-id "$AMI_ID"
aws ec2 delete-snapshot --region "$REGION" --snapshot-id "$SNAP_ID"

echo "Deleted $AMI_ID and $SNAP_ID ($REGION)"
