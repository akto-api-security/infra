terraform {
  required_version = ">= 1.5.0"

  required_providers {
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.4.0"
    }
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = ">= 5.0.0"
    }
  }
}

provider "google" {
  project = var.gcp_project_id
}

provider "google-beta" {
  project = var.gcp_project_id
}

locals {
  # data_ingestion_service_url is supplied as host:port and rendered into MessageLogging Syslog host/port.
  ingestion_parts = split(":", var.data_ingestion_service_url)
  syslog_host     = local.ingestion_parts[0]
  syslog_port     = tonumber(local.ingestion_parts[1])
  tcp_policy_name = "ML-SendAktoTcpSyslog"

  bundle_files = {
    "sharedflowbundle/sharedflowbundle.xml" = templatefile("${path.module}/apigee/sharedflowbundle.xml.tftpl", {
      shared_flow_name = var.shared_flow_name
      tcp_policy_name  = local.tcp_policy_name
    })
    "sharedflowbundle/sharedflows/default.xml" = templatefile("${path.module}/apigee/sharedflows/default.xml.tftpl", {
      tcp_policy_name = local.tcp_policy_name
    })
    "sharedflowbundle/policies/JS-BuildAktoLogPayload.xml" = file("${path.module}/apigee/policies/JS-BuildAktoLogPayload.xml")
    "sharedflowbundle/resources/jsc/build-akto-log-payload.js" = file("${path.module}/apigee/resources/jsc/build-akto-log-payload.js")
    "sharedflowbundle/policies/ML-SendAktoTcpSyslog.xml" = templatefile("${path.module}/apigee/policies/ML-SendAktoTcpSyslog.xml.tftpl", {
      syslog_host = local.syslog_host
      syslog_port = local.syslog_port
    })
  }

  # Bundle hash makes packaging deterministic and idempotent across apply runs.
  bundle_sha256 = sha256(join("", [
    for filename in sort(keys(local.bundle_files)) : "${filename}:${local.bundle_files[filename]}"
  ]))

  bundle_output_path = "${path.root}/.terraform/${var.shared_flow_name}-${substr(local.bundle_sha256, 0, 12)}-sharedflow.zip"
}

data "archive_file" "akto_sharedflow_bundle" {
  type        = "zip"
  output_path = local.bundle_output_path

  dynamic "source" {
    for_each = local.bundle_files
    content {
      filename = source.key
      content  = source.value
    }
  }
}

resource "google_apigee_sharedflow" "akto_tcp_logger" {
  provider = google-beta

  org_id        = var.gcp_project_id
  name          = var.shared_flow_name
  config_bundle = data.archive_file.akto_sharedflow_bundle.output_path

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_apigee_sharedflow_deployment" "akto_tcp_logger" {
  provider = google-beta

  org_id        = var.gcp_project_id
  environment   = var.apigee_environment
  sharedflow_id = google_apigee_sharedflow.akto_tcp_logger.name
  revision      = element(reverse(split("/", google_apigee_sharedflow.akto_tcp_logger.latest_revision_id)), 0)

  lifecycle {
    # Deploy the new revision before deleting the old one to avoid deployment gaps.
    create_before_destroy = true
  }
}

resource "google_apigee_flowhook" "akto_post_proxy" {
  provider = google-beta

  org_id          = var.gcp_project_id
  environment     = var.apigee_environment
  flow_hook_point = var.flow_hook_point
  sharedflow      = google_apigee_sharedflow.akto_tcp_logger.name

  # PostProxyFlowHook is the shared-flow equivalent of post-client logging placement.
  # It runs after main proxy processing so telemetry work stays out of the live request/response path.
  depends_on = [google_apigee_sharedflow_deployment.akto_tcp_logger]
}
