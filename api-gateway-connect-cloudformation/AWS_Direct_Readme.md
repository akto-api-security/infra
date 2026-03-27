# Akto CloudFormation Deployment Guide

This guide walks through deploying the `api-gateway-direct.yml` CloudFormation template to grant Akto cross-account access to your CloudWatch Logs and API Gateway.

## Prerequisites

1. **AWS Account** — You need access to deploy CloudFormation stacks
2. **Akto Account** — You should have the following from Akto:
   - AWS Account ID (usually `888570865705`)
   - Database Abstractor Token (token for authentication)
   - (Optional) External ID for additional security

3. **AWS CLI** (optional, for command-line deployment)

## Deployment Steps

### Option 1: AWS Management Console (GUI)

1. **Go to CloudFormation**
   - Log in to AWS Console
   - Navigate to **CloudFormation → Create stack**

2. **Upload Template**
   - Choose **Upload a template file**
   - Select `api-gateway-direct.yml`
   - Click **Next**

3. **Enter Stack Name**
   - Stack name: `akto-integration` (or any name you prefer)
   - Click **Next**

4. **Configure Parameters**
   - **AktoAccountId**: Enter the Akto AWS account ID (e.g., `888570865705`)
   - **DatabaseAbstractorToken**: Paste your Akto database abstractor token
   - **RoleName** (optional): Leave as default `AktoReadOnlyIntegrationRole` or customize
   - Click **Next**

5. **Review & Create**
   - Check the **Capabilities** section acknowledges `CAPABILITY_NAMED_IAM`
   - Click **Create stack**

6. **Wait for Completion**
   - Stack status should change from `CREATE_IN_PROGRESS` to `CREATE_COMPLETE`
   - Check CloudWatch Logs if it fails (see Troubleshooting below)

### Option 2: AWS CLI

```bash
aws cloudformation deploy \
  --template-file api-gateway-connect-cloudformation/api-gateway-direct.yml \
  --stack-name akto-integration \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
      AktoAccountId=888570865705 \
      DatabaseAbstractorToken=<your-token-here>
```

Replace `<your-token-here>` with your actual Akto database abstractor token.

## Verification

### 1. Check CloudFormation Stack Status
- Go to **CloudFormation → Stacks**
- Find your stack (e.g., `akto-integration`)
- Status should be `CREATE_COMPLETE`

### 2. Get the IAM Role ARN
- Go to **CloudFormation → Stacks → [Your Stack] → Outputs**
- Copy the `AktoRoleArn` value
- This is what you provide to Akto for their integration

### 3. Verify IAM Role Access
- Go to **IAM → Roles**
- Search for `AktoReadOnlyIntegrationRole` (or your custom role name)
- Check **Trust relationships** tab:
  - Should see Akto account (`888570865705`) allowed to assume the role
- Check **Permissions** tab:
  - Should see CloudWatch Logs and API Gateway read permissions

### 4. Check Lambda Registration
- Go to **CloudWatch → Log Groups**
- Find log group `/aws/lambda/*AktoRegistrationLambda*`
- Check latest log stream for `Account registration successful`

## Troubleshooting

### Stack Creation Failed with Other Error
- **Check Lambda Logs**:
  ```bash
  aws logs tail /aws/lambda/akto-integration-AktoRegistrationLambda-* --follow
  ```
- **Common Issues**:
  - Network/firewall blocking access to `ultron.akto.io`
  - Malformed token
  - Account ID format error (must be 12 digits)

### Role Already Exists Error
- **Cause**: A role with the same name already exists in your account
- **Fix**:
  - Delete the existing role, OR
  - Deploy with a different `RoleName` parameter

## Security Notes

- The `DatabaseAbstractorToken` is marked as `NoEcho: true` — never logs the token value
- Akto account has **read-only access** to:
  - CloudWatch Logs (DescribeLogGroups, GetLogEvents, etc.)
  - API Gateway (GET operations only)
- Optional `ExternalId` adds extra security layer if provided

## Next Steps

1. After successful deployment, share the `AktoRoleArn` output with Akto
2. Akto will assume this role to access your CloudWatch Logs and API Gateway
3. Monitor access in CloudTrail if needed

## Cleanup

To remove this integration:

```bash
aws cloudformation delete-stack --stack-name akto-integration
```

This will:
- Delete the IAM role
- Remove the Lambda function
- Clean up all related resources
