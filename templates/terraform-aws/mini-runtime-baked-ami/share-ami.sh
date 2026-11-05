#!/bin/bash
# Shares a mini-runtime AMI (and its snapshot) with a customer AWS account.
# Usage:
#   ./share-ami.sh <account-id> <region> <ami-id>
# Run once per region the AMI exists in.
set -euo pipefail

if [ $# -ne 3 ]; then
  echo "Usage: $0 <account-id> <region> <ami-id>" >&2
  exit 1
fi
ACCOUNT_ID="$1"
REGION="$2"
AMI_ID="$3"

# Lets the account launch instances from the AMI
aws ec2 modify-image-attribute --region "$REGION" --image-id "$AMI_ID" \
  --launch-permission "Add=[{UserId=$ACCOUNT_ID}]"

# Lets the account copy the AMI into its own account
SNAP_ID=$(aws ec2 describe-images --region "$REGION" --image-ids "$AMI_ID" \
  --query 'Images[0].BlockDeviceMappings[0].Ebs.SnapshotId' --output text)
aws ec2 modify-snapshot-attribute --region "$REGION" --snapshot-id "$SNAP_ID" \
  --attribute createVolumePermission --operation-type add --user-ids "$ACCOUNT_ID"

echo "Shared $AMI_ID ($REGION) and $SNAP_ID with $ACCOUNT_ID"
