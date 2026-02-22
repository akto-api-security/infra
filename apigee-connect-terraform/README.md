# Akto Apigee Step 2 Terraform Module (Global Environment Scope)

This module automates only **Step 2 (Apigee configuration)** of the Akto Apigee integration, using an environment-level shared flow model:
- Creates a Shared Flow bundle (`sharedflowbundle/...`)
- Injects `data_ingestion_service_url` into Akto JavaScript using `templatefile`
- Uploads the bundle with `google_apigee_sharedflow`
- Deploys the shared flow revision with `google_apigee_sharedflow_deployment`
- Attaches it to an Apigee environment flow hook with `google_apigee_flowhook`

This applies capture logic at the selected flow-hook point for APIs in that environment (rather than a single proxy base path).
It intentionally does **not** provision Akto ingestion services or any Step 1 resources.

## Inputs

- `project_id` (string, required)
- `apigee_environment` (string, required)
- `data_ingestion_service_url` (string, required)
- `proxy_name` (string, optional, default: `akto-traffic-collector`)
- `flow_hook_point` (string, optional, default: `PostProxyFlowHook`)
- `base_path` (string, optional, default: `/akto`, deprecated/ignored)

## Usage

```hcl
provider "google-beta" {
  project = var.project_id
}

module "akto_apigee_step2" {
  source = "path/to/this/module"

  project_id                 = var.project_id
  apigee_environment         = var.apigee_environment
  data_ingestion_service_url = var.data_ingestion_service_url
}
```

Then run:

```bash
terraform init
terraform apply
```

## Notes

- The shared flow bundle is generated and zipped during plan/apply via `archive_file`.
- Deployment is revision-safe by pinning to the uploaded shared flow revision.
- No Apigee UI steps or shell scripts are required.
- Example configurations are provided in `examples/basic` and `examples/prod`.
