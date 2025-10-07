# ECR image scan

## Infra

region: ap-south-1

### Scheduled job using Code Build
  * Purpose:
    * ecr public does not support ecr image scanning, only ecr private does. Hence, ecr public images need to be mirrored on ecr private.
  * Trigger - code build
  * Run ecr-pub.sh script
    * Check if there are newer images on ecr public.
    * If so, push them to ecr private repo.
    * If the repo doesn't exist create a new one.
    * The ecr-scan-mirror-lifecycle-policy.json sets a policy to keep only the 3 recently pushed images

  Code Build:
  * project: ecr-scan-mirror-code-build
  * source: https://github.com/akto-api-security/infra
  * source version: infra/aws_ecr_scanning
  * trigger - ecr-scan-mirror-code-build-trigger (runs every few hours)


### ECR private image scan settings:
  * Enhanced scanning
  * Scan on push - ( filter for repo scanning: ecr-scan-mirror)
  * Scan results are viewable in AWS Inspector dashboard

### Event in event bridge - AWS Inspector scan result generated
  * When a scan is completed, AWS Inspector creates an event
  * Trigger - lambda
  * Lambda (lamda.js) will send a slack alert if critical vulnerabilities are found.

  Lambda:
  * function name: ecr-scan-mirror-lambda
  * script - lambda.js
  * create function zip: 

  ``` bash
  cd lambda_code
  zip -r lambda.zip .
  ```

  * Upload zip file to lambda function
  * Environment variables:
    * AWS_SHORTCUT_LINK_PREFIX - prefix for aws dashboard
    * SLACK_WEBHOOK_URL

  * Event bridge event:
    * bus: default
    * rule name: ecr-scan-mirror-result
    * event pattern:

    ```json
      {
        "source": ["aws.inspector2"],
        "detail-type": ["Inspector2 Scan"]
      }
    ```
