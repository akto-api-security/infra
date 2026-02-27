output "gcp_project_id" {
  description = "GCP project used as Apigee org_id."
  value       = var.gcp_project_id
}

output "apigee_environment" {
  description = "Apigee environment where the shared flow is deployed."
  value       = var.apigee_environment
}

output "shared_flow_name" {
  description = "Name of the deployed shared flow."
  value       = google_apigee_sharedflow.akto_tcp_logger.name
}

output "shared_flow_latest_revision_id" {
  description = "Latest revision resource ID returned by Apigee."
  value       = google_apigee_sharedflow.akto_tcp_logger.latest_revision_id
}

output "shared_flow_deployed_revision" {
  description = "Revision number currently deployed to the Apigee environment."
  value       = element(reverse(split("/", google_apigee_sharedflow.akto_tcp_logger.latest_revision_id)), 0)
}

output "flow_hook_point" {
  description = "Flow hook where the shared flow is attached."
  value       = google_apigee_flowhook.akto_post_proxy.flow_hook_point
}

output "syslog_endpoint" {
  description = "Resolved TCP syslog destination used by MessageLogging."
  value       = "${local.syslog_host}:${local.syslog_port}"
}

output "sharedflow_bundle_sha256" {
  description = "Content hash of the generated shared flow bundle (idempotence visibility)."
  value       = data.archive_file.akto_sharedflow_bundle.output_sha
}
