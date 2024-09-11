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

variable "database_abstractor_url" {
  description = "URL for the Database Abstractor service"
  type        = string
}

variable "database_abstractor_token" {
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

# Data source for Subnet
data "aws_subnet" "selected" {
  id = var.subnet_id
}

# Data source for VPC
data "aws_vpc" "selected" {
  id = data.aws_subnet.selected.vpc_id
}


# IAM Role for Lambda functions
resource "aws_iam_role" "lambda_execution_role" {
  name               = "GetAktoSetupDetailsLambdaBasicExecutionRole"
  assume_role_policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [{
      "Effect" : "Allow",
      "Principal" : {
        "Service" : "lambda.amazonaws.com"
      },
      "Action" : "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "get_akto_lambda_policy" {
  name   = "GetAktoSetupDetailsExecuteLambda"
  role   = aws_iam_role.lambda_execution_role.id
  policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [{
      "Effect" : "Allow",
      "Action" : [
        "ec2:DescribeNetworkInterfaces",
        "ec2:DescribeTrafficMirrorSessions",
        "ec2:DescribeInstances",
        "ec2:DescribeVpcs",
        "elasticloadbalancing:DescribeLoadBalancers",
        "elasticloadbalancing:DescribeTargetGroups",
        "elasticloadbalancing:DescribeTargetHealth"
      ],
      "Resource" : "*"
    }]
  })
}

# Lambda Function
resource "aws_lambda_function" "get_akto_setup_details" {
  function_name = "GetAktoSetupDetails"
  runtime       = "nodejs16.x"
  role          = aws_iam_role.lambda_execution_role.arn
  handler       = "index.handler"
  timeout       = 60
  environment {
    variables = {
      TARGET_LB = aws_lb.akto_nlb.dns_name
    }
  }
  s3_bucket = "akto-setup-${var.region}"
  s3_key    = "templates/get-akto-setup-details.zip"
}

# IAM Role for EC2 Instances
resource "aws_iam_instance_profile" "iam_instance_profile" {
  name = "AktoInstanceProfile"
  role = aws_iam_role.lambda_execution_role.name
}

# Security Group
resource "aws_security_group" "akto_security_group" {
  name_prefix = "akto-security-group"
  vpc_id      = data.aws_vpc.selected.id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 4789
    to_port     = 4789
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 8000
    to_port     = 8000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 9092
    to_port     = 9092
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

# Launch Configuration
resource "aws_launch_configuration" "akto_launch_configuration" {
  name_prefix            = "AktoASGLaunchConfiguration"
  image_id               = local.ami_id
  instance_type          = "m5a.xlarge"
  key_name               = var.key_pair
  iam_instance_profile   = aws_iam_instance_profile.iam_instance_profile.id
  security_groups        = [aws_security_group.akto_security_group.id]
  associate_public_ip_address = false

  user_data = <<-EOF
    #!/bin/bash -xe
    export DATABASE_ABSTRACTOR_SERVICE_URL='${var.database_abstractor_url}'
    export DATABASE_ABSTRACTOR_SERVICE_TOKEN='${var.database_abstractor_token}'
    export DATABASE_ABSTRACTOR_SERVICE_URL='${var.database_abstractor_url}'
    export DATABASE_ABSTRACTOR_SERVICE_TOKEN='${var.database_abstractor_token}'
    export AKTO_KAFKA_IP='${aws_lb.akto_nlb.dns_name}'
    touch /tmp/hello.txt
    touch ~/hello.txt
    sudo yum update -y
    sudo yum install -y python python-setuptools
    sudo yum install -y docker
    sudo dockerd&
    sudo systemctl enable /usr/lib/systemd/system/docker.service
    sudo mkdir -p /opt/aws/bin
    export COMPOSE_FILE=docker-compose-mini-runtime.yml
    sudo wget https://s3.amazonaws.com/cloudformation-examples/aws-cfn-bootstrap-latest.tar.gz
    sudo python -m easy_install --script-dir /opt/aws/bin aws-cfn-bootstrap-latest.tar.gz
    curl -fsSL 'https://raw.githubusercontent.com/akto-api-security/infra/feature/mini-runtime-cft/cf-deploy-akto' > cf-deploy-akto
    sudo chmod 700 cf-deploy-akto
    ./cf-deploy-akto < <(echo 'test')
    sudo echo >> ~/akto/infra/docker-runtime.env
    sudo echo AKTO_MONGO_CONN=$AKTO_MONGO_CONN >> ~/akto/infra/docker-runtime.env
    sudo echo DATABASE_ABSTRACTOR_SERVICE_URL=$DATABASE_ABSTRACTOR_SERVICE_URL >> ~/akto/infra/docker-mini-runtime.env
    sudo echo DATABASE_ABSTRACTOR_SERVICE_TOKEN=$DATABASE_ABSTRACTOR_SERVICE_TOKEN >> ~/akto/infra/docker-mini-runtime.env
    sudo echo AKTO_KAFKA_IP=$AKTO_KAFKA_IP >> ~/akto/infra/.env
    curl -fsSL 'https://raw.githubusercontent.com/akto-api-security/infra/feature/mini-runtime-cft/cf-deploy-akto-start' > cf-deploy-akto-start
    sudo chmod 700 cf-deploy-akto-start
    ./cf-deploy-akto-start < <(echo 'test')
  EOF
}

# Auto Scaling Group
resource "aws_autoscaling_group" "akto_autoscaling_group" {
  desired_capacity     = 1
  max_size             = 10
  min_size             = 1
  vpc_zone_identifier  = [var.subnet_id]
  target_group_arns    = [
    aws_lb_target_group.akto_traffic_mirroring_target_group.arn,
    aws_lb_target_group.akto_kafka_target_group.arn,
  ]
  launch_configuration = aws_launch_configuration.akto_launch_configuration.name
}

# Network Load Balancer
resource "aws_lb" "akto_nlb" {
  name               = "AktoNLB"
  internal           = true
  load_balancer_type = "network"
  ip_address_type    = "ipv4"
  subnets            = [var.subnet_id]

  enable_cross_zone_load_balancing = true
}

# Target Groups
resource "aws_lb_target_group" "akto_traffic_mirroring_target_group" {
  name     = "AktoTrafficMirroringTG"
  port     = 4789
  protocol = "UDP"
  vpc_id   = data.aws_vpc.selected.id

  health_check {
    enabled             = true
    interval            = 10
    path                = "/metrics"
    port                = "8000"
    protocol            = "HTTP"
    timeout             = 6
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }
}

resource "aws_lb_target_group" "akto_kafka_target_group" {
  name     = "AktoKafkaTG"
  port     = 9092
  protocol = "TCP"
  vpc_id   = data.aws_vpc.selected.id

  health_check {
    enabled             = true
    interval            = 10
    path                = "/metrics"
    port                = "8000"
    protocol            = "HTTP"
    timeout             = 6
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }
}

# Load Balancer Listeners
resource "aws_lb_listener" "akto_kafka_listener" {
  load_balancer_arn = aws_lb.akto_nlb.arn
  port              = 9092
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.akto_kafka_target_group.arn
  }
}

# Outputs
output "akto_nlb_dns" {
  description = "The DNS name of the Akto NLB"
  value       = aws_lb.akto_nlb.dns_name
}
