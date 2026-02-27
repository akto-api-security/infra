variable "gcp_project_id" {
  description = "GCP project ID hosting Apigee X (also used as Apigee org_id)."
  type        = string

  validation {
    condition     = trimspace(var.gcp_project_id) != ""
    error_message = "gcp_project_id must not be empty."
  }
}

variable "apigee_environment" {
  description = "Apigee environment name where the shared flow is deployed."
  type        = string

  validation {
    condition     = trimspace(var.apigee_environment) != ""
    error_message = "apigee_environment must not be empty."
  }
}

variable "data_ingestion_service_url" {
  description = "TCP syslog destination in host:port format."
  type        = string

  validation {
    condition = (
      length(split(":", var.data_ingestion_service_url)) == 2 &&
      trimspace(split(":", var.data_ingestion_service_url)[0]) != "" &&
      can(tonumber(split(":", var.data_ingestion_service_url)[1])) &&
      tonumber(split(":", var.data_ingestion_service_url)[1]) >= 1 &&
      tonumber(split(":", var.data_ingestion_service_url)[1]) <= 65535
    )
    error_message = "data_ingestion_service_url must be in host:port format with a valid port (1-65535)."
  }
}

variable "shared_flow_name" {
  description = "Name of the Apigee shared flow that sends asynchronous TCP logs."
  type        = string
  default     = "akto-tcp-async-logger"
}

variable "flow_hook_point" {
  description = "Flow hook point used for environment-wide attachment; PostProxyFlowHook is recommended for post-response logging."
  type        = string
  default     = "PostProxyFlowHook"

  validation {
    condition = contains([
      "PreProxyFlowHook",
      "PreTargetFlowHook",
      "PostTargetFlowHook",
      "PostProxyFlowHook"
    ], var.flow_hook_point)
    error_message = "flow_hook_point must be one of PreProxyFlowHook, PreTargetFlowHook, PostTargetFlowHook, PostProxyFlowHook."
  }
}
