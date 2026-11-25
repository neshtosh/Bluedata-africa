#!/usr/bin/env bash
# Deploys one image tag to an ECS environment (used by .github/workflows/deploy-staging.yml).
#   ecs-deploy.sh <cluster> <family-prefix> <api-image> <samakios-image> <bluedata-image>
# Needs: aws CLI v2, jq; env PRIVATE_SUBNETS (comma-separated) and APPS_SECURITY_GROUP.
# Optional env BOOTSTRAP_DATABASE=true runs the database bootstrap first (first deploy, or to
# rotate the app role passwords). Order matters: bootstrap → migrations → services, and each
# step must succeed before the next.
set -euo pipefail

cluster="$1" prefix="$2" api_image="$3" samakios_image="$4" bluedata_image="$5"
: "${PRIVATE_SUBNETS:?}" "${APPS_SECURITY_GROUP:?}"

# Registers a new revision of a task definition family with a different image; prints its ARN.
register_with_image() {
  local family="$1" image="$2"
  aws ecs describe-task-definition --task-definition "$family" --query taskDefinition --output json |
    jq --arg image "$image" '
      .containerDefinitions[0].image = $image
      | {family, taskRoleArn, executionRoleArn, networkMode, containerDefinitions,
         requiresCompatibilities, cpu, memory, runtimePlatform}
      | with_entries(select(.value != null))' >/tmp/taskdef.json
  aws ecs register-task-definition --cli-input-json file:///tmp/taskdef.json \
    --query taskDefinition.taskDefinitionArn --output text
}

# Runs a one-off task to completion; fails if its container exits non-zero.
run_job() {
  local task_definition="$1" task exit_code
  task=$(aws ecs run-task --cluster "$cluster" --launch-type FARGATE \
    --task-definition "$task_definition" \
    --network-configuration "awsvpcConfiguration={subnets=[${PRIVATE_SUBNETS}],securityGroups=[${APPS_SECURITY_GROUP}],assignPublicIp=DISABLED}" \
    --query 'tasks[0].taskArn' --output text)
  echo "Started $task_definition as $task"
  aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$task"
  exit_code=$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task" \
    --query 'tasks[0].containers[0].exitCode' --output text)
  if [[ "$exit_code" != "0" ]]; then
    echo "::error::$task_definition failed with exit code $exit_code (see CloudWatch /blue/*/jobs)"
    exit 1
  fi
}

if [[ "${BOOTSTRAP_DATABASE:-false}" == "true" ]]; then
  echo "== Database bootstrap (roles, extensions)"
  run_job "$(register_with_image "${prefix}-bootstrap-db" "$api_image")"
fi

echo "== Migrations"
run_job "$(register_with_image "${prefix}-migrate" "$api_image")"

echo "== Services"
declare -A images=(
  [api]="$api_image" [worker]="$api_image"
  [samakios-web]="$samakios_image" [bluedata-web]="$bluedata_image"
)
for service in "${!images[@]}"; do
  arn=$(register_with_image "${prefix}-${service}" "${images[$service]}")
  aws ecs update-service --cluster "$cluster" --service "$service" --task-definition "$arn" \
    --query 'service.serviceName' --output text
done

# Waits until every service runs the new revision and passes health checks. The ECS deployment
# circuit breaker rolls back automatically if they don't.
aws ecs wait services-stable --cluster "$cluster" --services "${!images[@]}"
echo "== Deployed"
