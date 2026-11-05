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
  description = "Token for the Database Abstractor service. Ignored if database_abstractor_token_secret_arn is set"
  type        = string
  default     = ""
}

variable "database_abstractor_token_secret_arn" {
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

variable "cidr_blocks" {
  description = "List of CIDR blocks allowed for ingress/egress"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}


# Latest Amazon Linux 2023 AMI for the region (AWS public SSM parameter)
data "aws_ssm_parameter" "al2023_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

locals {
  ami_id = data.aws_ssm_parameter.al2023_ami.insecure_value

  name_prefix = var.environment != "" ? "${var.environment}-" : ""
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
  name               = "${local.name_prefix}GetAktoSetupDetailsLambdaBasicExecutionRole"
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

# IAM Role for EC2 Instances
resource "aws_iam_role" "ec2_instance_role" {
  name               = "${local.name_prefix}AktoMiniRuntimeInstanceRole"
  assume_role_policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [{
      "Effect" : "Allow",
      "Principal" : {
        "Service" : "ec2.amazonaws.com"
      },
      "Action" : "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "ec2_instance_describe_policy" {
  name   = "GetAktoSetupDetailsExecuteLambda"
  role   = aws_iam_role.ec2_instance_role.id
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

resource "aws_iam_role_policy" "ec2_instance_secret_policy" {
  count  = var.database_abstractor_token_secret_arn != "" ? 1 : 0
  name   = "ReadDatabaseAbstractorTokenSecret"
  role   = aws_iam_role.ec2_instance_role.id
  policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [{
      "Effect" : "Allow",
      "Action" : "secretsmanager:GetSecretValue",
      "Resource" : var.database_abstractor_token_secret_arn
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ec2_instance_ssm_policy" {
  role       = aws_iam_role.ec2_instance_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "iam_instance_profile" {
  name = "${local.name_prefix}AktoInstanceProfile"
  role = aws_iam_role.ec2_instance_role.name
}

# Security Group
resource "aws_security_group" "akto_security_group" {
  name_prefix = "akto-security-group"
  vpc_id      = data.aws_vpc.selected.id

  ingress {
    from_port   = 4789
    to_port     = 4789
    protocol    = "udp"
    cidr_blocks = var.cidr_blocks
  }
  ingress {
    from_port   = 8000
    to_port     = 8000
    protocol    = "tcp"
    cidr_blocks = var.cidr_blocks
  }
  ingress {
    from_port   = 9092
    to_port     = 9092
    protocol    = "tcp"
    cidr_blocks = var.cidr_blocks
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Security Group
resource "aws_security_group" "lb_security_group" {
  name_prefix = "lb-security-group"
  vpc_id      = data.aws_vpc.selected.id

  ingress {
    from_port   = 9092
    to_port     = 9092
    protocol    = "tcp"
    cidr_blocks = var.cidr_blocks
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = var.cidr_blocks
  }
}

# Launch Configuration
resource "aws_launch_template" "akto_launch_template" {
  name_prefix   = "AktoLaunchTemplate"
  image_id      = local.ami_id
  instance_type = "m5a.xlarge"
  key_name      = var.key_pair

  iam_instance_profile {
    name = aws_iam_instance_profile.iam_instance_profile.name
  }

  network_interfaces {
    security_groups = [aws_security_group.akto_security_group.id]
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  block_device_mappings {
    device_name = "/dev/xvda"

    ebs {
      volume_size           = 20
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = true
    }
  }

  user_data = base64encode(<<-EOF
    #!/bin/bash -xe
    export DATABASE_ABSTRACTOR_SERVICE_URL='${var.database_abstractor_url}'
    set +x
    %{ if var.database_abstractor_token_secret_arn != "" }
    DATABASE_ABSTRACTOR_SERVICE_TOKEN="$(aws secretsmanager get-secret-value --region '${var.region}' --secret-id '${var.database_abstractor_token_secret_arn}' --query SecretString --output text)"
    %{ else }
    DATABASE_ABSTRACTOR_SERVICE_TOKEN='${var.database_abstractor_token}'
    %{ endif }
    export DATABASE_ABSTRACTOR_SERVICE_TOKEN
    set -x
    export AKTO_KAFKA_IP='${aws_lb.akto_nlb.dns_name}'
    touch /tmp/hello.txt
    touch ~/hello.txt
    sudo yum update -y
    sudo yum install -y docker unzip
    sudo dockerd&
    sudo systemctl enable /usr/lib/systemd/system/docker.service
    export COMPOSE_FILE=docker-compose-mini-runtime.yml
    curl -fsSL 'https://raw.githubusercontent.com/akto-api-security/infra/feature/mini-runtime-cft/cf-deploy-akto' > cf-deploy-akto
    sudo chmod 700 cf-deploy-akto
    ./cf-deploy-akto < <(echo 'test')
    sudo echo >> ~/akto/infra/docker-runtime.env
    sudo echo AKTO_MONGO_CONN=$AKTO_MONGO_CONN >> ~/akto/infra/docker-runtime.env
    sudo echo DATABASE_ABSTRACTOR_SERVICE_URL=$DATABASE_ABSTRACTOR_SERVICE_URL >> ~/akto/infra/docker-mini-runtime.env
    set +x
    sudo echo DATABASE_ABSTRACTOR_SERVICE_TOKEN=$DATABASE_ABSTRACTOR_SERVICE_TOKEN >> ~/akto/infra/docker-mini-runtime.env
    set -x
    sudo echo AKTO_KAFKA_IP=$AKTO_KAFKA_IP >> ~/akto/infra/.env
    curl -fsSL 'https://raw.githubusercontent.com/akto-api-security/infra/feature/mini-runtime-cft/cf-deploy-akto-start' > cf-deploy-akto-start
    sudo chmod 700 cf-deploy-akto-start
    ./cf-deploy-akto-start < <(echo 'test')
  EOF
  )
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
  launch_template {
    id      = aws_launch_template.akto_launch_template.id
    version = "$Latest"
  }
}

# Network Load Balancer
resource "aws_lb" "akto_nlb" {
  name               = "${local.name_prefix}AktoNLB"
  internal           = true
  load_balancer_type = "network"
  ip_address_type    = "ipv4"
  subnets            = [var.subnet_id]
  security_groups    = [aws_security_group.lb_security_group.id]

  enable_cross_zone_load_balancing = true
}

# Target Groups
resource "aws_lb_target_group" "akto_traffic_mirroring_target_group" {
  name     = "${local.name_prefix}AktoTrafficMirroringTG"
  port     = 4789
  protocol = "UDP"
  vpc_id   = data.aws_vpc.selected.id

  health_check {
    enabled             = true
    interval            = 10        # Interval between health checks in seconds
    port                = "9092"    # Change the health check port to 9092
    protocol            = "TCP"     # Change the protocol to TCP
    timeout             = 6         # Timeout for health check response in seconds
    healthy_threshold   = 2         # Number of successful checks before marking healthy
    unhealthy_threshold = 2         # Number of failed checks before marking unhealthy
  }
}

resource "aws_lb_target_group" "akto_kafka_target_group" {
  name     = "${local.name_prefix}AktoKafkaTG"
  port     = 9092
  protocol = "TCP"
  vpc_id   = data.aws_vpc.selected.id

  health_check {
    enabled             = true
    interval            = 10        # Interval between health checks in seconds
    port                = "9092"    # Change the health check port to 9092
    protocol            = "TCP"     # Change the protocol to TCP
    timeout             = 6         # Timeout for health check response in seconds
    healthy_threshold   = 2         # Number of successful checks before marking healthy
    unhealthy_threshold = 2         # Number of failed checks before marking unhealthy
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
