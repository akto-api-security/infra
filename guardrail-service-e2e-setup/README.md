# Akto Guardrail Service — End-to-End Setup

This folder contains everything needed to self-host the Akto guardrail backend — the services that power the Kong plugin's security checks and traffic ingestion.

Two deployment options are provided:

| Option | Folder | Best for |
|--------|--------|----------|
| Docker Compose | `docker-compose/` | Any Linux VM, quick setup |
| Terraform (Azure) | `terraform/` | Automated Azure infrastructure provisioning |

---

## Option A: Docker Compose

### Prerequisites

- Linux server with **4 vCPUs and 8 GB RAM** minimum
- Docker and Docker Compose installed

### Steps

**1. Create your `.env` file**

```bash
cd docker-compose
cp .env.example .env
```

Edit `.env` and set `AKTO_KAFKA_IP` to the private IP of your server.

**2. Create env files from templates**

Copy each template and fill in your Akto API token:

```bash
cp docker-guardrails-service.env.template          docker-guardrails-service.env
cp docker-guardrails-service-kafka.env.template    docker-guardrails-service-kafka.env
cp docker-mini-runtime.env.template                docker-mini-runtime.env
cp data-ingestion-docker.env.template              data-ingestion-docker.env
cp docker-account-job-executor.env.template        docker-account-job-executor.env
```

Replace every `<YOUR_AKTO_API_TOKEN>` with your token from the Akto dashboard (Settings → API Tokens).

**3. Start the services**

```bash
docker compose up -d
```

**4. Verify**

```bash
docker compose ps
```

All services should show `Up`. The Kong plugin endpoint is available at `http://<YOUR_SERVER_IP>:8080`.

Use this URL as `config.service_url` in the Kong plugin.

---

## Option B: Terraform (Azure)

Provisions a full Azure environment: VM, Kafka, all Akto services, and an Application Gateway for routing.

### Prerequisites

- [Terraform >= 1.0](https://developer.hashicorp.com/terraform/install)
- [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) authenticated (`az login`)
- SSH key pair at `~/.ssh/id_rsa.pub`

### Steps

```bash
cd terraform

# 1. Copy and fill in your credentials
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars — set akto_token and azure_connection_string

# 2. Initialize
terraform init

# 3. Preview
terraform plan

# 4. Deploy
terraform apply
```

After deployment (~5–10 minutes), Terraform outputs the Application Gateway public IP. Use `http://<GATEWAY_IP>` as `config.service_url` in the Kong plugin.

> **Security:** `terraform.tfvars` contains your credentials — never commit it. It is listed in `.gitignore`.

---

## Services Overview

| Service | Port | Role |
|---------|------|------|
| `zoo1` | 2181 | ZooKeeper — Kafka coordination |
| `kafka1` | 9092 | Kafka message broker |
| `akto-api-security-runtime` | — | Processes API traffic from Kafka |
| `guardrails-service` | 9090 | Async guardrails via Kafka |
| `guardrails-service-http` | 9091 | Internal sync guardrails (called by data-ingestion-service) |
| `data-ingestion-service` | 8080 | Receives traffic, runs guardrails, ingests data — **Kong plugin endpoint** |
| `account-job-executor` | — | Background job processing |
