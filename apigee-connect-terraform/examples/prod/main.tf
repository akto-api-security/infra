terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google-beta = {
      source  = "hashicorp/google-beta"
      version = ">= 7.0.0"
    }
  }
}

provider "google-beta" {
  project = var.project_id
}

module "akto_apigee_global" {
  source = "../.."

  project_id                 = var.project_id
  apigee_environment         = var.apigee_environment
  data_ingestion_service_url = var.data_ingestion_service_url

  # Optional hardening/customization:
  # proxy_name      = "akto-traffic-collector"
  # flow_hook_point = "PostProxyFlowHook"
}
