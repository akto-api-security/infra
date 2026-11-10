# Provider configuration
provider "aws" {
  region = var.region
}

# Input Variables
variable "region" {
  description = "AWS region where resources will be deployed"
  type        = string
}

variable "key_pair" {
  description = "Key pair for the EC2 instances (optional). SSH is not opened in the security group"
  type        = string
  default     = ""
}

variable "subnet_id" {
  description = "Subnet ID where the EC2 instances will be launched"
  type        = string
}

# Input Variable for Token
variable "database_abstractor_service_token" {
  description = "Token for the Database Abstractor service. Ignored if database_abstractor_service_token_secret_arn is set"
  type        = string
  default     = ""
}

variable "database_abstractor_service_token_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the Database Abstractor token (plain-text value)"
  type        = string
  default     = ""
}

variable "environment" {
  description = "Environment name used to prefix resource names (max 9 characters). Leave empty to keep the default names"
  type        = string
  default     = ""

  validation {
    condition     = length(var.environment) <= 9
    error_message = "environment must be at most 9 characters."
  }
}

locals {
  mappings = {
    RegionMap = {
      af-south-1 = {
        AMI = "ami-0bf140e4e0e2f0412"
      }
      eu-north-1 = {
        AMI = "ami-0516089d963059a51"
      }
      ap-south-1 = {
        AMI = "ami-0f19324397f53458f"
      }
      eu-west-3 = {
        AMI = "ami-07dcdf1066ae9dad3"
      }
      eu-west-2 = {
        AMI = "ami-03d359cc404d860ea"
      }
      eu-south-1 = {
        AMI = "ami-03361121628ba993f"
      }
      eu-west-1 = {
        AMI = "ami-00fcaf85b81e85b1d"
      }
      ap-northeast-3 = {
        AMI = "ami-0a10569e5050f3968"
      }
      ap-northeast-2 = {
        AMI = "ami-05becc39a92b78fa5"
      }
      ap-northeast-1 = {
        AMI = "ami-0c051224e18c11f2e"
      }
      sa-east-1 = {
        AMI = "ami-08c89ad8a13b9b4f9"
      }
      ca-central-1 = {
        AMI = "ami-0b3f293126f3e2677"
      }
      ap-east-1 = {
        AMI = "ami-07a3e4c5c2ce4ca0f"
      }
      ap-southeast-1 = {
        AMI = "ami-01127915c7b29e7ca"
      }
      ap-southeast-2 = {
        AMI = "ami-062900c135ab91582"
      }
      eu-central-1 = {
        AMI = "ami-01376afa3e7def694"
      }
      ap-southeast-3 = {
        AMI = "ami-0828288eacde44176"
      }
      us-east-1 = {
        AMI = "ami-0c230065b91270bc6"
      }
      us-east-2 = {
        AMI = "ami-02dae70ab25064279"
      }
      us-west-1 = {
        AMI = "ami-07645bd2e582378f1"
      }
      us-west-2 = {
        AMI = "ami-09f02015912e773f7"
      }
    }
  }
  # Lookup the AMI ID based on the region (Amazon Linux 2023)
  ami_id = local.mappings.RegionMap[var.region].AMI

  name_prefix = var.environment != "" ? "${var.environment}-" : ""
}

# IAM Role for EC2 Instances
resource "aws_iam_role" "ec2_execution_role" {
  name               = "${local.name_prefix}TestServiceExecutionRole"
  assume_role_policy = jsonencode({
    Version : "2012-10-17",
    Statement : [
      {
        Effect : "Allow",
        Principal : {
          Service : "ec2.amazonaws.com"
        },
        Action : "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "ec2_execution_secret_policy" {
  count  = var.database_abstractor_service_token_secret_arn != "" ? 1 : 0
  name   = "ReadDatabaseAbstractorTokenSecret"
  role   = aws_iam_role.ec2_execution_role.id
  policy = jsonencode({
    Version : "2012-10-17",
    Statement : [
      {
        Effect : "Allow",
        Action : "secretsmanager:GetSecretValue",
        Resource : var.database_abstractor_service_token_secret_arn
      }
    ]
  })
}

resource "aws_iam_instance_profile" "instance_profile" {
  name = "${local.name_prefix}TestServiceInstanceProfile"
  role = aws_iam_role.ec2_execution_role.name
}

# Security Group (no ingress: the containers only make outbound calls)
resource "aws_security_group" "service_security_group" {
  name_prefix = "service-security-group"
  vpc_id      = data.aws_subnet.selected.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Data source for Subnet and VPC
data "aws_subnet" "selected" {
  id = var.subnet_id
}

data "aws_vpc" "selected" {
  id = data.aws_subnet.selected.vpc_id
}

# Launch Template
resource "aws_launch_template" "test_service_launch_template" {
  name_prefix   = "TestServiceLaunchTemplate"
  image_id      = local.ami_id
  instance_type = "m5a.large"
  key_name      = var.key_pair != "" ? var.key_pair : null

  iam_instance_profile {
    name = aws_iam_instance_profile.instance_profile.name
  }

  vpc_security_group_ids = [aws_security_group.service_security_group.id]

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  block_device_mappings {
    device_name = "/dev/xvda"

    ebs {
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = true
    }
  }

  user_data = base64encode(<<-EOF
    #!/bin/bash -xe
    sudo yum update -y
    sudo yum install -y docker
    sudo systemctl start docker
    sudo systemctl enable docker
    sudo curl -L "https://github.com/docker/compose/releases/download/v5.7.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    sudo ln -s /usr/local/bin/docker-compose /usr/bin/docker-compose
    curl -L https://raw.githubusercontent.com/akto-api-security/infra/quick-setup-1.0.0/docker-compose-mini-testing.yml -o docker-compose.yml
    sudo mv docker-compose.yml /root
    set +x
    %{ if var.database_abstractor_service_token_secret_arn != "" }
    DATABASE_ABSTRACTOR_SERVICE_TOKEN="$(aws secretsmanager get-secret-value --region '${var.region}' --secret-id '${var.database_abstractor_service_token_secret_arn}' --query SecretString --output text)"
    %{ else }
    DATABASE_ABSTRACTOR_SERVICE_TOKEN='${var.database_abstractor_service_token}'
    %{ endif }
    sed -i "s|<token>|$DATABASE_ABSTRACTOR_SERVICE_TOKEN|g" /root/docker-compose.yml
    set -x
    sudo docker-compose -f /root/docker-compose.yml up -d
  EOF
  )
}

# Auto Scaling Group
resource "aws_autoscaling_group" "test_service_autoscaling_group" {
  desired_capacity    = 1
  max_size            = 3
  min_size            = 1
  vpc_zone_identifier = [var.subnet_id]

  launch_template {
    id      = aws_launch_template.test_service_launch_template.id
    version = "$Latest"
  }

  tag {
    key                 = "Name"
    value               = "TestServiceInstance"
    propagate_at_launch = true
  }
}

# Outputs
output "autoscaling_group_name" {
  description = "Name of the Auto Scaling Group"
  value       = aws_autoscaling_group.test_service_autoscaling_group.name
}

output "security_group_id" {
  description = "Security Group ID for the service"
  value       = aws_security_group.service_security_group.id
}
