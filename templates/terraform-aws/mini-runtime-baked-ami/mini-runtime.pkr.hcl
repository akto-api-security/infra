# Builds the Akto mini-runtime AMI (Amazon Linux 2023 + Docker + pre-pulled images)
# Usage:
#   packer init .
#   packer build .
#   packer build -var 'subnet_id=subnet-xxxx' -var 'ami_regions=["us-east-1"]' .

packer {
  required_plugins {
    amazon = {
      version = ">= 1.3.0"
      source  = "github.com/hashicorp/amazon"
    }
  }
}

variable "region" {
  description = "Region to build the AMI in"
  type        = string
  default     = "ap-south-1"
}

variable "subnet_id" {
  description = "Subnet with internet access for the build instance. Empty = default VPC"
  type        = string
  default     = ""
}

variable "infra_ref" {
  description = "Tag of akto-api-security/infra to take the compose and env files from"
  type        = string
  default     = "quick-setup-1.0.0"
}

variable "ami_regions" {
  description = "Extra regions to copy the AMI to"
  type        = list(string)
  default     = []
}

# Latest Amazon Linux 2023 AMI (AWS public SSM parameter)
data "amazon-parameterstore" "al2023" {
  name   = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
  region = var.region
}

locals {
  timestamp = formatdate("YYYYMMDDhhmmss", timestamp())
}

source "amazon-ebs" "mini_runtime" {
  region                      = var.region
  source_ami                  = data.amazon-parameterstore.al2023.value
  instance_type               = "t3.large"
  subnet_id                   = var.subnet_id
  associate_public_ip_address = true
  ssh_username                = "ec2-user"

  ami_name     = "akto-mini-runtime-${var.infra_ref}-${local.timestamp}"
  ami_regions  = var.ami_regions
  imds_support = "v2.0"

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  launch_block_device_mappings {
    device_name           = "/dev/xvda"
    volume_size           = 20
    volume_type           = "gp3"
    delete_on_termination = true
  }

  tags = {
    Name     = "akto-mini-runtime"
    InfraRef = var.infra_ref
    BaseAMI  = data.amazon-parameterstore.al2023.value
  }
}

build {
  sources = ["source.amazon-ebs.mini_runtime"]

  provisioner "shell" {
    script           = "${path.root}/bake.sh"
    environment_vars = ["AKTO_INFRA_REF=${var.infra_ref}"]
    execute_command  = "chmod +x {{ .Path }}; sudo {{ .Vars }} {{ .Path }}"
  }
}
