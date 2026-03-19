# Akto AWS Integration CloudFormation Template

This README explains what the CloudFormation template does, what access it grants, what it does **not** do, and the exact AWS steps required to deploy it safely.

---

## Overview

The CloudFormation template creates a cross-account IAM role in **your AWS account** that Akto can assume.

Once deployed, that role allows Akto to:

* read CloudWatch Logs
* list your API Gateway APIs
* retrieve API Gateway configuration and API specifications where available

This is intended for read-only visibility into API infrastructure and logs so Akto can discover APIs and analyze traffic and configuration.

---

## What the template creates

The template creates:

* **One IAM Role** that Akto can assume using `sts:AssumeRole`
* **One inline IAM policy** attached to that role

The policy grants:

### 1. CloudWatch Logs read access

Akto can:

* list log groups
* list log streams
* read log events
* filter log events
* run and read CloudWatch Logs Insights queries

This enables Akto to inspect API-related logs stored in CloudWatch.

### 2. API Gateway read access

Akto can:

* list API Gateways
* read API Gateway configuration
* retrieve API definitions/specs and related metadata exposed through API Gateway read APIs

This enables Akto to discover APIs and inspect their definitions.

---

## What this template does **not** do

This template does **not** grant Akto permission to:

* modify or delete CloudWatch Logs
* create, update, or delete API Gateways
* invoke your APIs
* change IAM users, roles, or policies outside this one role
* access unrelated AWS services

The role is designed to be read-only for the specific scope requested.

---

## Permissions included

### CloudWatch Logs permissions

The role includes these CloudWatch Logs actions:

* `logs:DescribeLogGroups`
* `logs:DescribeLogStreams`
* `logs:GetLogEvents`
* `logs:FilterLogEvents`
* `logs:StartQuery`
* `logs:StopQuery`
* `logs:GetQueryResults`
* `logs:DescribeQueries`
* `logs:DescribeExportTasks`

### API Gateway permissions

The role includes:

* `apigateway:GET`

This is the standard read action used for API Gateway control-plane resources.

---

## Inputs required before deployment

Before you deploy the stack, collect the following from Akto:

### 1. Akto AWS Account ID

This is the AWS account that will assume the role.

Example:

```text
123456789012
```

### 2. Akto External ID (recommended)

Akto may provide an external ID for cross-account access.

This improves security by protecting against confused deputy risks.

If Akto provides one, use it.

### 3. Optional custom role name

If you do not want to use the default role name, choose your own.

Default:

```text
AktoReadOnlyIntegrationRole
```

---

## Deployment options

You can deploy this template using either:

* the AWS Management Console
* the AWS CLI

---

## Deploy using the AWS Management Console

### Step 1: Save the template

Save the CloudFormation template into a file, for example:

```text
a kto-aws-integration.yaml
```

Use a clean file name such as:

```text
akto-aws-integration.yaml
```

### Step 2: Open CloudFormation

1. Sign in to the AWS account Akto should access.
2. In the AWS Console, open **CloudFormation**.
3. Make sure you are in the correct AWS account and Region.

### Step 3: Create the stack

1. Click **Create stack**.
2. Choose **With new resources (standard)**.
3. Under **Specify template**, choose **Upload a template file**.
4. Upload `akto-aws-integration.yaml`.
5. Click **Next**.

### Step 4: Enter stack details

Set the following:

* **Stack name**: `akto-aws-integration` (or your preferred name)
* **AktoAccountId**: the AWS account ID provided by Akto
* **AktoExternalId**: the external ID provided by Akto, if any
* **RoleName**: leave the default or provide a custom name

Click **Next**.

### Step 5: Configure stack options

You can leave the default options unless your organization requires tags or stack policies.

Click **Next**.

### Step 6: Acknowledge IAM capability

Because the template creates an IAM role, CloudFormation will require acknowledgment.

Check the box:

* **I acknowledge that AWS CloudFormation might create IAM resources**

Then click **Submit**.

### Step 7: Wait for completion

Wait until the stack reaches:

```text
CREATE_COMPLETE
```

### Step 8: Copy the role ARN

After deployment:

1. Open the stack
2. Go to the **Outputs** tab
3. Copy the value of **AktoRoleArn**

Send that role ARN to Akto.

---

## Deploy using the AWS CLI

Save the template locally as:

```bash
akto-aws-integration.yaml
```

Then run:

```bash
aws cloudformation deploy \
  --stack-name akto-aws-integration \
  --template-file akto-aws-integration.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    AktoAccountId=123456789012 \
    AktoExternalId=your-external-id \
    RoleName=AktoReadOnlyIntegrationRole
```

If Akto does not provide an external ID, you can pass an empty value only if your shell supports it cleanly, or edit the template parameters as needed before deployment.

After deployment, retrieve outputs with:

```bash
aws cloudformation describe-stacks \
  --stack-name akto-aws-integration \
  --query "Stacks[0].Outputs"
```

Look for the `AktoRoleArn` output and share it with Akto.

---

## Verifying what was created

After the stack is deployed, verify the role:

### In IAM Console

1. Open **IAM**.
2. Click **Roles**.
3. Search for the configured role name, such as `AktoReadOnlyIntegrationRole`.
4. Open the role.

Confirm:

* the **Trust relationship** allows Akto’s AWS account to assume the role
* the role includes the expected inline policy

### In CloudFormation Outputs

Confirm the stack shows:

* `AktoRoleArn`
* `AktoRoleName`

---

## Trust policy behavior

The role trust policy allows Akto’s AWS account to call:

```text
sts:AssumeRole
```

If an external ID is provided, the trust policy requires that external ID during the assume-role call.

That means only callers from Akto’s AWS account presenting the correct external ID can assume the role.

---

## How Akto will use this role

In a typical setup:

1. You deploy the CloudFormation stack in your AWS account.
2. You send the generated role ARN to Akto.
3. Akto configures their platform to assume that role.
4. Akto uses the granted read-only permissions to:

   * discover API Gateway APIs
   * retrieve API details/specifications
   * read CloudWatch logs relevant to API traffic

---

## Regional behavior

A few points to understand:

* **CloudWatch Logs** are regional.
* **API Gateway** resources can be regional, edge-optimized, or managed across multiple regions depending on the API type and setup.
* The IAM role itself is global within the account, but Akto may need to inspect resources across multiple AWS regions.

If your APIs and logs exist in multiple regions, Akto may query those regions using the same role, as long as the services and resources are available there.

---

## Security considerations

### Recommended: use an external ID

Always use the Akto-provided external ID when available.

### Principle of least privilege

This template grants read-only access only for the required services:

* CloudWatch Logs
* API Gateway

### Review in a non-production account first

If your organization has a change-management process, deploy and validate this role in a staging or sandbox AWS account first.

### Log and monitor role usage

You can use:

* AWS CloudTrail
* IAM Access Analyzer

to review how the role is used and verify the access pattern.

---

## Troubleshooting

### Stack creation fails with IAM capability error

Cause: IAM resources require explicit acknowledgment.

Fix: When deploying, include:

* Console: check the IAM acknowledgment checkbox
* CLI: add `--capabilities CAPABILITY_NAMED_IAM`

### Akto cannot assume the role

Check:

* the `AktoAccountId` is correct
* the external ID matches exactly
* the role ARN shared with Akto is correct
* there are no organization SCPs or permission boundaries blocking `sts:AssumeRole`

### Akto can assume the role but cannot see expected APIs or logs

Check:

* the APIs exist in the regions Akto is querying
* API Gateway logging is enabled where expected
* CloudWatch log groups exist and contain data
* your environment uses API Gateway and not a different gateway product or proxy layer

### Need to remove access

Delete the CloudFormation stack or update the trust policy/permissions.

---

## Updating the stack

If Akto changes their account ID or external ID:

1. Open CloudFormation
2. Select the stack
3. Choose **Update**
4. Reuse the current template or upload the updated template
5. Change the parameter values
6. Apply the update

Then provide the updated role ARN to Akto if the role name changed.

---

## Deleting the stack

To fully remove Akto’s access:

1. Open **CloudFormation**
2. Select the stack
3. Click **Delete**

This removes the IAM role created by the template.

---

## Example output to share with Akto

After deployment, send Akto:

```text
Role ARN: arn:aws:iam::111122223333:role/AktoReadOnlyIntegrationRole
External ID: <the external ID you configured, if applicable>
```

---

## Summary

This CloudFormation template provides a safe, focused, read-only AWS integration for Akto by creating a cross-account IAM role that lets Akto:

* read CloudWatch Logs
* list API Gateways
* retrieve API Gateway details/specifications

It does not grant write access or broader administrative privileges.

---

## Related files

* `template.yaml` or `akto-aws-integration.yaml`: the CloudFormation template
* `README.md`: this deployment and usage guide
