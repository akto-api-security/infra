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
  description = "Key pair for SSH access to the EC2 instances"
  type        = string
}

variable "subnet_id" {
  description = "Subnet ID where the EC2 instances will be launched"
  type        = string
}

# Input Variable for Token
variable "database_abstractor_service_token" {
  description = "Token for the Database Abstractor service"
  type        = string
}

locals {
  mappings = {
    RegionMap = {
      af-south-1 = {
        AMI = "ami-093ca241e4c72c205"
      }
      eu-north-1 = {
        AMI = "ami-0f58e72599cb99a79"
      }
      ap-south-1 = {
        AMI = "ami-0400aca7799d8cf19"
      }
      eu-west-3 = {
        AMI = "ami-064c70d04ad799d5e"
      }
      eu-west-2 = {
        AMI = "ami-0dfe6158087b5c0ac"
      }
      eu-south-1 = {
        AMI = "ami-07b2af763a8b958f3"
      }
      eu-west-1 = {
        AMI = "ami-047aad752a426ed48"
      }
      ap-northeast-3 = {
        AMI = "ami-0cffa2172948e071e"
      }
      ap-northeast-2 = {
        AMI = "ami-087af0192368bc87c"
      }
      me-south-1 = {
        AMI = "ami-0a31e56929248acca"
      }
      ap-northeast-1 = {
        AMI = "ami-0828596b82405edd7"
      }
      sa-east-1 = {
        AMI = "ami-0df67b3c17f090c24"
      }
      ca-central-1 = {
        AMI = "ami-0eb3718c42cb70e52"
      }
      ap-east-1 = {
        AMI = "ami-0e992f1e63814db10"
      }
      ap-southeast-1 = {
        AMI = "ami-0ba98499caf94125a"
      }
      ap-southeast-2 = {
        AMI = "ami-0849cc8fe4ceaf988"
      }
      eu-central-1 = {
        AMI = "ami-0f7585ae7a0d9a25a"
      }
      ap-southeast-3 = {
        AMI = "ami-0cf40308729b83366"
      }
      us-east-1 = {
        AMI = "ami-0d52ddcdf3a885741"
      }
      us-east-2 = {
        AMI = "ami-04148302a14f7d12b"
      }
      us-west-1 = {
        AMI = "ami-0ee3e1e65adeef858"
      }
      us-west-2 = {
        AMI = "ami-0ec021424fb596d6c"
      }
    }
  }
  # Lookup the AMI ID based on the region
  ami_id = local.mappings.RegionMap[var.region].AMI
}

# IAM Role for EC2 Instances
resource "aws_iam_role" "ec2_execution_role" {
  name               = "TestServiceExecutionRole"
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

resource "aws_iam_instance_profile" "instance_profile" {
  name = "TestServiceInstanceProfile"
  role = aws_iam_role.ec2_execution_role.name
}

# Security Group
resource "aws_security_group" "service_security_group" {
  name_prefix = "service-security-group"
  vpc_id      = data.aws_subnet.selected.vpc_id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

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

# Launch Configuration
resource "aws_launch_configuration" "test_service_launch_configuration" {
  name_prefix          = "TestServiceLaunchConfiguration"
  image_id             = local.ami_id
  instance_type        = "t3.medium"
  key_name             = var.key_pair
  iam_instance_profile = aws_iam_instance_profile.instance_profile.id
  security_groups      = [aws_security_group.service_security_group.id]

  user_data = <<-EOF
    #!/bin/bash -xe
    sudo yum update -y
    sudo yum install -y docker
    sudo systemctl start docker
    sudo systemctl enable docker
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    sudo ln -s /usr/local/bin/docker-compose /usr/bin/docker-compose
    curl -L https://raw.githubusercontent.com/akto-api-security/infra/refs/heads/feature/quick-setup/docker-compose-mini-testing.yml -o docker-compose.yml
    sudo mv docker-compose.yml /root
    sed -i 's|<token>|${var.database_abstractor_service_token}|g' /root/docker-compose.yml
    sudo docker-compose -f /root/docker-compose.yml up -d
  EOF
}

# Auto Scaling Group
resource "aws_autoscaling_group" "test_service_autoscaling_group" {
  desired_capacity     = 1
  max_size             = 3
  min_size             = 1
  vpc_zone_identifier  = [var.subnet_id]
  launch_configuration = aws_launch_configuration.test_service_launch_configuration.name

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

