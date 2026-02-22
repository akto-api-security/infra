#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_FILE="${SCRIPT_DIR}/api-gateway-connector.yml"
PARAMS_FILE="${SCRIPT_DIR}/parameters.json"

STACK_NAME="${1:-akto-api-gateway-connector}"
REGION="${2:-ap-south-1}"

if [[ ! -f "${PARAMS_FILE}" ]]; then
  echo "Missing ${PARAMS_FILE}. Copy parameters.example.json to parameters.json and fill values first."
  exit 1
fi

echo "Validating template..."
aws cloudformation validate-template \
  --template-body "file://${TEMPLATE_FILE}" \
  --region "${REGION}" >/dev/null

set +e
aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${REGION}" >/dev/null 2>&1
STACK_EXISTS=$?
set -e

if [[ ${STACK_EXISTS} -ne 0 ]]; then
  echo "Creating stack ${STACK_NAME} in ${REGION}..."
  aws cloudformation create-stack \
    --stack-name "${STACK_NAME}" \
    --template-body "file://${TEMPLATE_FILE}" \
    --parameters "file://${PARAMS_FILE}" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region "${REGION}"

  aws cloudformation wait stack-create-complete \
    --stack-name "${STACK_NAME}" \
    --region "${REGION}"
else
  echo "Updating stack ${STACK_NAME} in ${REGION}..."
  set +e
  UPDATE_OUTPUT=$(aws cloudformation update-stack \
    --stack-name "${STACK_NAME}" \
    --template-body "file://${TEMPLATE_FILE}" \
    --parameters "file://${PARAMS_FILE}" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region "${REGION}" 2>&1)
  UPDATE_CODE=$?
  set -e

  if [[ ${UPDATE_CODE} -ne 0 ]]; then
    if echo "${UPDATE_OUTPUT}" | grep -q "No updates are to be performed"; then
      echo "No updates are to be performed."
      exit 0
    fi
    echo "${UPDATE_OUTPUT}"
    exit ${UPDATE_CODE}
  fi

  aws cloudformation wait stack-update-complete \
    --stack-name "${STACK_NAME}" \
    --region "${REGION}"
fi

echo "Done. Stack outputs:"
aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${REGION}" \
  --query "Stacks[0].Outputs"
