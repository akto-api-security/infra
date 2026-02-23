provider "google" {}

variable "subnet_id" {
  description = "Existing GCP subnetwork self_link (equivalent to AWS SubnetId)."
  type        = string
}

variable "database_abstractor_url" {
  description = "Akto Database Abstractor URL."
  type        = string
}

variable "database_abstractor_token" {
  description = "Akto Database Abstractor token."
  type        = string
  sensitive   = true
}

locals {
  # Expected format:
  # https://www.googleapis.com/compute/v1/projects/<project>/regions/<region>/subnetworks/<name>
  subnet_parts = split("/", var.subnet_id)

  project_id      = element(local.subnet_parts, length(local.subnet_parts) - 5)
  region          = element(local.subnet_parts, length(local.subnet_parts) - 3)
  subnetwork_name = element(local.subnet_parts, length(local.subnet_parts) - 1)

  runtime_prefix = "akto-mini-runtime"
  runtime_tag    = "akto-mini-runtime"

  startup_script = <<-EOT
    #!/usr/bin/env bash
    set -euxo pipefail

    if [ -z "$${HOME:-}" ]; then
      export HOME="/root"
    fi

    export DATABASE_ABSTRACTOR_SERVICE_URL='${var.database_abstractor_url}'
    export DATABASE_ABSTRACTOR_SERVICE_TOKEN='${var.database_abstractor_token}'
    export AKTO_KAFKA_IP='${google_compute_address.runtime_internal_ip.address}'

    apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io curl git python3 python3-setuptools unzip
    if ! DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-plugin; then
      DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose
    fi

    if ! command -v docker-compose >/dev/null 2>&1; then
      cat >/usr/local/bin/docker-compose <<'EOF'
#!/usr/bin/env bash
docker compose "$@"
EOF
      chmod +x /usr/local/bin/docker-compose
    fi
    systemctl enable docker
    systemctl start docker

    cat >/tmp/tf-deploy-akto <<'AKTO_TF_DEPLOY'
${file("${path.module}/tf-deploy-akto")}
AKTO_TF_DEPLOY
    chmod 700 /tmp/tf-deploy-akto
    bash /tmp/tf-deploy-akto <<< "test"

    if [ -f "$HOME/akto/infra/docker-runtime.env" ]; then
      echo " " >> "$HOME/akto/infra/docker-runtime.env"
      if [ -n "$${AKTO_MONGO_CONN:-}" ]; then
        echo "AKTO_MONGO_CONN=$AKTO_MONGO_CONN" >> "$HOME/akto/infra/docker-runtime.env"
      fi
    fi

    if [ -f "$HOME/akto/infra/docker-mini-runtime.env" ]; then
      echo " " >> "$HOME/akto/infra/docker-mini-runtime.env"
      echo "DATABASE_ABSTRACTOR_SERVICE_URL=$DATABASE_ABSTRACTOR_SERVICE_URL" >> "$HOME/akto/infra/docker-mini-runtime.env"
      echo "DATABASE_ABSTRACTOR_SERVICE_TOKEN=$DATABASE_ABSTRACTOR_SERVICE_TOKEN" >> "$HOME/akto/infra/docker-mini-runtime.env"
    fi

    if [ -f "$HOME/akto/infra/.env" ]; then
      echo "AKTO_KAFKA_IP=$AKTO_KAFKA_IP" >> "$HOME/akto/infra/.env"
    fi

    if [ -f "$HOME/akto/infra/docker-threat-detection.env" ]; then
      sed -i "s/AKTO_THREAT_PROTECTION_BACKEND_TOKEN=.*/AKTO_THREAT_PROTECTION_BACKEND_TOKEN=$DATABASE_ABSTRACTOR_SERVICE_TOKEN/" "$HOME/akto/infra/docker-threat-detection.env"
      sed -i "s/DATABASE_ABSTRACTOR_SERVICE_TOKEN=.*/DATABASE_ABSTRACTOR_SERVICE_TOKEN=$DATABASE_ABSTRACTOR_SERVICE_TOKEN/" "$HOME/akto/infra/docker-threat-detection.env"
    fi

    cd "$HOME/akto/infra"
    docker-compose -f docker-compose-mini-runtime.yml up -d
  EOT
}

data "google_compute_subnetwork" "selected" {
  name    = local.subnetwork_name
  region  = local.region
  project = local.project_id
}

data "google_compute_image" "runtime" {
  project = "debian-cloud"
  family  = "debian-12"
}

resource "google_compute_firewall" "runtime_ingress" {
  project = local.project_id
  name    = "${local.runtime_prefix}-ingress"
  network = data.google_compute_subnetwork.selected.network

  allow {
    protocol = "udp"
    ports    = ["4789"]
  }

  allow {
    protocol = "tcp"
    ports    = ["9092", "9091", "8000"]
  }

  source_ranges = [data.google_compute_subnetwork.selected.ip_cidr_range]
  target_tags   = [local.runtime_tag]
}

resource "google_compute_firewall" "runtime_hc" {
  project = local.project_id
  name    = "${local.runtime_prefix}-healthcheck"
  network = data.google_compute_subnetwork.selected.network

  allow {
    protocol = "tcp"
    ports    = ["8000"]
  }

  source_ranges = ["35.191.0.0/16", "130.211.0.0/22"]
  target_tags   = [local.runtime_tag]
}

resource "google_compute_firewall" "runtime_iap_ssh" {
  project = local.project_id
  name    = "${local.runtime_prefix}-iap-ssh"
  network = data.google_compute_subnetwork.selected.network

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["35.235.240.0/20"]
  target_tags   = [local.runtime_tag]
}

resource "google_compute_health_check" "runtime" {
  project            = local.project_id
  name               = "${local.runtime_prefix}-hc"
  check_interval_sec = 15
  timeout_sec        = 10

  healthy_threshold   = 2
  unhealthy_threshold = 4

  tcp_health_check {
    port = 8000
  }
}

resource "google_compute_instance_template" "runtime" {
  project      = local.project_id
  name_prefix  = "${local.runtime_prefix}-tpl-"
  machine_type = "n2d-standard-4"
  tags         = [local.runtime_tag]

  disk {
    source_image = data.google_compute_image.runtime.self_link
    auto_delete  = true
    boot         = true
    disk_size_gb = 50
    disk_type    = "pd-balanced"
  }

  network_interface {
    subnetwork = data.google_compute_subnetwork.selected.id
  }
  metadata_startup_script = local.startup_script

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_compute_region_instance_group_manager" "runtime" {
  project = local.project_id
  name    = "${local.runtime_prefix}-mig"
  region  = local.region

  version {
    instance_template = google_compute_instance_template.runtime.self_link
    name              = "primary"
  }

  base_instance_name = local.runtime_prefix
  target_size        = 1

  named_port {
    name = "kafka"
    port = 9092
  }

  named_port {
    name = "ingestion"
    port = 9091
  }

  named_port {
    name = "metrics"
    port = 8000
  }

  auto_healing_policies {
    health_check      = google_compute_health_check.runtime.id
    initial_delay_sec = 900
  }
}

resource "google_compute_region_autoscaler" "runtime" {
  project = local.project_id
  name    = "${local.runtime_prefix}-autoscaler"
  region  = local.region
  target  = google_compute_region_instance_group_manager.runtime.id

  autoscaling_policy {
    min_replicas    = 1
    max_replicas    = 10
    cooldown_period = 30

    cpu_utilization {
      target = 0.6
    }
  }
}

resource "google_compute_region_backend_service" "kafka" {
  project               = local.project_id
  name                  = "${local.runtime_prefix}-kafka-bs"
  region                = local.region
  protocol              = "TCP"
  load_balancing_scheme = "INTERNAL"
  health_checks         = [google_compute_health_check.runtime.id]

  backend {
    group          = google_compute_region_instance_group_manager.runtime.instance_group
    balancing_mode = "CONNECTION"
  }
}

resource "google_compute_region_backend_service" "mirroring" {
  project               = local.project_id
  name                  = "${local.runtime_prefix}-mirror-bs"
  region                = local.region
  protocol              = "UDP"
  load_balancing_scheme = "INTERNAL"
  health_checks         = [google_compute_health_check.runtime.id]

  backend {
    group          = google_compute_region_instance_group_manager.runtime.instance_group
    balancing_mode = "CONNECTION"
  }
}

resource "google_compute_address" "runtime_internal_ip" {
  project      = local.project_id
  name         = "${local.runtime_prefix}-ilb-ip"
  region       = local.region
  address_type = "INTERNAL"
  purpose      = "SHARED_LOADBALANCER_VIP"
  subnetwork   = data.google_compute_subnetwork.selected.id
}

resource "google_compute_forwarding_rule" "kafka" {
  project               = local.project_id
  name                  = "${local.runtime_prefix}-kafka-fr"
  region                = local.region
  load_balancing_scheme = "INTERNAL"
  network               = data.google_compute_subnetwork.selected.network
  subnetwork            = data.google_compute_subnetwork.selected.id
  ip_protocol           = "TCP"
  ports                 = ["9092", "9091"]
  ip_address            = google_compute_address.runtime_internal_ip.address
  backend_service       = google_compute_region_backend_service.kafka.id
}

resource "google_compute_forwarding_rule" "mirroring" {
  project               = local.project_id
  name                  = "${local.runtime_prefix}-mirroring-fr"
  region                = local.region
  load_balancing_scheme = "INTERNAL"
  network               = data.google_compute_subnetwork.selected.network
  subnetwork            = data.google_compute_subnetwork.selected.id
  ip_protocol           = "UDP"
  ports                 = ["4789"]
  ip_address            = google_compute_address.runtime_internal_ip.address
  backend_service       = google_compute_region_backend_service.mirroring.id
}

output "akto_internal_lb_ip" {
  description = "Internal load balancer IP (equivalent to AktoNLB DNS target role in AWS stack)."
  value       = google_compute_address.runtime_internal_ip.address
}

output "akto_kafka_endpoint" {
  description = "Kafka endpoint."
  value       = "${google_compute_address.runtime_internal_ip.address}:9092"
}

output "akto_ingestion_endpoint" {
  description = "Data ingestion endpoint for Apigee shared flow."
  value       = "${google_compute_address.runtime_internal_ip.address}:9091"
}

output "akto_traffic_mirroring_endpoint" {
  description = "Traffic mirroring endpoint."
  value       = "${google_compute_address.runtime_internal_ip.address}:4789"
}
