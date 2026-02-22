output "sharedflow_name" {
  description = "Apigee shared flow name."
  value       = google_apigee_sharedflow.akto.name
}

output "sharedflow_revision" {
  description = "Deployed shared flow revision."
  value       = google_apigee_sharedflow.akto.revision
}

output "deployment_environment" {
  description = "Environment where the shared flow is deployed."
  value       = google_apigee_sharedflow_deployment.akto.environment
}

output "flow_hook_point" {
  description = "Flow hook point where the shared flow is attached."
  value       = google_apigee_flowhook.akto_post_proxy.flow_hook_point
}

output "sharedflow_bundle_sha256" {
  description = "SHA256 of the generated shared flow bundle."
  value       = data.archive_file.akto_sharedflow_bundle.output_sha
}
