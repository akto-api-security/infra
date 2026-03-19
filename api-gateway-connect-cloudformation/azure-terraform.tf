terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azapi = {
      source  = "Azure/azapi"
      version = "~> 2.6"
    }
  }
}

provider "azapi" {}

variable "apim_services" {
  description = "Map of APIM instances keyed by a friendly name. Value must be the full APIM service resource ID."
  type        = map(string)
}

variable "policy_xml_path" {
  description = "Path to the APIM global policy XML file."
  type        = string
  default     = "global-policy.xml"
}

locals {
  policy_xml = file(var.policy_xml_path)
}

resource "azapi_resource" "apim_global_policy" {
  for_each = var.apim_services

  type      = "Microsoft.ApiManagement/service/policies@2024-05-01"
  name      = "policy"
  parent_id = each.value

  body = {
    properties = {
      format = "rawxml"
      value  = local.policy_xml
    }
  }

  response_export_values = ["id", "name", "type"]
}

output "apim_policy_ids" {
  value = {
    for k, v in azapi_resource.apim_global_policy : k => v.id
  }
}
