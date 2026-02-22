variable "project_id" {
  description = "Google Cloud project ID hosting Apigee (used as Apigee org_id in this module)."
  type        = string
}

variable "apigee_environment" {
  description = "Apigee environment name where the shared flow is deployed and attached."
  type        = string
}

variable "proxy_name" {
  description = "Name of the Apigee shared flow used for Akto traffic capture."
  type        = string
  default     = "akto-traffic-collector"
}

variable "base_path" {
  description = "Deprecated for global shared-flow mode. Retained for backward compatibility and ignored."
  type        = string
  default     = "/akto"

  validation {
    condition     = startswith(var.base_path, "/")
    error_message = "base_path must start with '/'."
  }
}

variable "flow_hook_point" {
  description = "Environment flow hook point to attach the Akto shared flow."
  type        = string
  default     = "PostProxyFlowHook"

  validation {
    condition = contains([
      "PreProxyFlowHook",
      "PostProxyFlowHook",
      "PreTargetFlowHook",
      "PostTargetFlowHook"
    ], var.flow_hook_point)
    error_message = "flow_hook_point must be one of PreProxyFlowHook, PostProxyFlowHook, PreTargetFlowHook, PostTargetFlowHook."
  }
}

variable "data_ingestion_service_url" {
  description = "Akto data ingestion service URL from Step 1 output."
  type        = string

  validation {
    condition = (
      startswith(var.data_ingestion_service_url, "https://") ||
      startswith(var.data_ingestion_service_url, "http://")
    )
    error_message = "data_ingestion_service_url must start with http:// or https://."
  }
}
