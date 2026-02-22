# Prod Deployment

1. Copy example vars:

```bash
cp terraform.tfvars.example terraform.tfvars
```

2. Edit `terraform.tfvars` with your real values:

```hcl
project_id                 = "my-project-id"
apigee_environment         = "prod"
data_ingestion_service_url = "https://my-ingestion-host:9091/api/ingestData"
```

3. Deploy:

```bash
terraform init
terraform apply
```

4. Verify in outputs:
- `sharedflow_name`
- `sharedflow_revision`
- `deployment_environment`
- `flow_hook_point`
