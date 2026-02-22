# API Gateway Connector CloudFormation

This folder contains a standalone CloudFormation template to deploy the Akto AWS API Gateway connector on EC2.

It does **not** create mini-runtime resources (Kafka/NLB). You must pass mini-runtime Kafka endpoint via `AktoKafkaBrokerMal`.

## Files

- `api-gateway-connector.yml`: CloudFormation template
- `parameters.example.json`: Minimal example parameters (required only)
- `deploy.sh`: Create/update helper script

## Minimum required parameters

You only need these in `parameters.json`:

- `VpcId`
- `SubnetId`
- `AktoKafkaBrokerMal`
- `AwsAccessKeyId`
- `AwsSecretAccessKey`
- `LogGroupName`
- `DatabaseAbstractorToken`

## Optional parameters (defaults exist)

- `KeyPair` (default empty, use SSM only)
- `InstanceType` (default `t3.medium`)
- `AmiId` (default latest Amazon Linux 2023 x86_64 via SSM)
- `SshCidr` (default empty, no SSH ingress)
- `AktoKafkaSecurityGroupId` (default empty, no auto 9092 rule)
- `AwsRegion` (default empty, uses stack region)
- `AwsSessionToken` (default empty, set only when using temporary credentials)
- Connector tuning params (all defaulted)

## Fixed values in template

- Connector image: `aktosecurity/mirror-api-logging:api-gateway-logging-openapi`
- Watchtower poll interval: `1800` seconds

## Deploy

1. Copy and edit parameters:

```bash
cp /Users/tangobee/infra/api-gateway-connect-cloudformation/parameters.example.json \
  /Users/tangobee/infra/api-gateway-connect-cloudformation/parameters.json
```

2. Deploy stack:

```bash
/Users/tangobee/infra/api-gateway-connect-cloudformation/deploy.sh akto-api-gateway-connector ap-south-1
```

## Notes

- If you set `AktoKafkaSecurityGroupId`, the template automatically opens tcp/9092 from connector SG to mini-runtime SG.
- SSM access is enabled via IAM role (`AmazonSSMManagedInstanceCore`).
