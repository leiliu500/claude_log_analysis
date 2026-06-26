#!/usr/bin/env bash
# Build the Lambda bundles and apply the Terraform stack.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Installing dependencies"
npm install

echo "==> Building Lambda bundles"
npm run build

echo "==> terraform init"
terraform -chdir=infra init -input=false

echo "==> terraform apply"
terraform -chdir=infra apply -input=false "$@"

echo
echo "Done. Trigger an on-demand run with:"
echo "  aws lambda invoke --function-name \$(terraform -chdir=infra output -raw flow_trigger_function_name) \\"
echo "    --payload '{\"windowMinutes\":60}' --cli-binary-format raw-in-base64-out /dev/stdout"
