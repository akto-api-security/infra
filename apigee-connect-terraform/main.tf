locals {
  bundle_files = {
    "sharedflowbundle/sharedflowbundle.xml" = templatefile("${path.module}/templates/sharedflowbundle.xml.tftpl", {
      sharedflow_name = var.proxy_name
    })

    "sharedflowbundle/sharedflows/default.xml" = templatefile("${path.module}/templates/sharedflow.xml.tftpl", {
      policy_name = "AktoJavascript"
    })

    "sharedflowbundle/policies/AktoJavascript.xml" = templatefile("${path.module}/templates/akto_javascript_policy.xml.tftpl", {})

    "sharedflowbundle/resources/jsc/AktoPolicy.js" = templatefile("${path.module}/templates/AktoPolicy.js.tftpl", {
      data_ingestion_service_url = var.data_ingestion_service_url
    })
  }

  bundle_content_hash = sha256(join("", [
    for path in sort(keys(local.bundle_files)) : "${path}:${local.bundle_files[path]}"
  ]))

  bundle_output_path = "${path.root}/.terraform/${var.proxy_name}-${substr(local.bundle_content_hash, 0, 12)}-sharedflow.zip"
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

resource "google_apigee_sharedflow" "akto" {
  provider = google-beta

  org_id = var.project_id
  name       = var.proxy_name
  config_bundle = data.archive_file.akto_sharedflow_bundle.output_path
}

resource "google_apigee_sharedflow_deployment" "akto" {
  provider = google-beta

  org_id       = var.project_id
  environment = var.apigee_environment
  sharedflow_id = google_apigee_sharedflow.akto.name
  revision     = element(reverse(split("/", google_apigee_sharedflow.akto.latest_revision_id)), 0)

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_apigee_flowhook" "akto_post_proxy" {
  provider = google-beta

  org_id          = var.project_id
  environment     = var.apigee_environment
  flow_hook_point = var.flow_hook_point
  sharedflow      = google_apigee_sharedflow.akto.name

  depends_on = [google_apigee_sharedflow_deployment.akto]
}
