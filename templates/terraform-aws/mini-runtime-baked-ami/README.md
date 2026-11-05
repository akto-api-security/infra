# Mini-runtime baked AMI

An Amazon Linux 2023 AMI with Docker, docker-compose, the Akto compose/env files and all images pre-installed, so instances download nothing at boot.

| File | Purpose |
|---|---|
| `bake.sh` | Installs everything on the image (run by Packer) |
| `mini-runtime.pkr.hcl` | Packer build definition |
| `build-ami.sh` | Builds the AMI |
| `share-ami.sh` | Shares the AMI with a customer AWS account |
| `delete-ami.sh` | Deletes the AMI and its snapshot |
| `mini-runtime.tf` | Terraform deployment that uses the AMI |

## Prerequisites
- AWS credentials for the account that owns the AMI
- Packer: `brew tap hashicorp/tap && brew install hashicorp/tap/packer`

## 1. Build the AMI
```bash
./build-ami.sh                                   # builds in ap-south-1
REGION=us-east-1 ./build-ami.sh                  # builds in another region
AMI_REGIONS=us-east-1,eu-west-1 ./build-ami.sh   # also copies it to these regions
```
The AMI IDs are printed at the end, e.g. `ap-south-1: ami-0123456789abcdef0`.

## 2. Share it with a customer
```bash
./share-ami.sh <account-id> <region> <ami-id>
```
Run once per region.

Optional: the customer can copy the AMI into their own account, so their deployments don't depend on ours:
```bash
aws ec2 copy-image --region <region> --source-region <region> \
  --source-image-id <ami-id> --name akto-mini-runtime --encrypted
```

## 3. Deploy
Set `ami_id` (and the other values) in `mini-runtime.tfvars`, then:
```bash
terraform init
terraform apply -var-file=mini-runtime.tfvars
```

## 4. Delete an AMI
```bash
./delete-ami.sh <region> <ami-id>
```
Deregisters the AMI and deletes its snapshot. Run once per region. Cannot be undone, and customers it was shared with (and who did not copy it) can no longer launch it.
