#!/usr/bin/env bash
# Deploys an oksocial image on the VM and keeps the site up: pulls it (default: latest), restarts the
# app container, then waits for the backend to answer and for a worker to poll Temporal's "main"
# queue. A backend that stays silent gets one pm2 restart; if it is still down, or no worker polls,
# the previous image is put back. Old images are pruned only after a healthy deploy.
#   ~/oksocial/deploy/deploy.sh [image tag or commit sha]
#   ~/oksocial/deploy/deploy.sh --prune    (only drop old images; prints the free disk in GB)
set -euo pipefail
cd "${OKSOCIAL_DEPLOY_DIR:-$HOME/oksocial/deploy}"
IMAGE=ghcr.io/conn-ho/oksocial
TAG=${1:-latest}
# every build is a ~7.4 GB image: keep the running one, latest and this many of the newest others
KEEP_IMAGES=2
compose() { docker compose -f docker-compose.prod.yml "$@"; }
free_gb() { df -BG --output=avail / | tail -1 | tr -dc 0-9; }
prune_images() {
  local running latest_id kept=0 id tag
  running=$(docker inspect -f '{{.Image}}' oksocial-oksocial-1 2>/dev/null || true)
  latest_id=$(docker image inspect -f '{{.Id}}' "$IMAGE:latest" 2>/dev/null || true)
  # newest first
  docker images --no-trunc --format '{{.ID}} {{.Tag}}' "$IMAGE" | while read -r id tag; do
    [ "$tag" = latest ] && continue
    if [ "$id" = "$running" ] || [ "$id" = "$latest_id" ]; then continue; fi
    if [ "$kept" -lt "$KEEP_IMAGES" ]; then kept=$((kept + 1)); continue; fi
    docker rmi "$IMAGE:$tag" >/dev/null 2>&1 || true
  done
  docker image prune -f >/dev/null 2>&1 || true
}
if [ "$TAG" = --prune ]; then
  prune_images
  echo "$(free_gb)"
  exit 0
fi
backend_up() {
  compose exec -T oksocial node -e "fetch('http://127.0.0.1:3000/',{signal:AbortSignal.timeout(5000)}).then(()=>process.exit(0),()=>process.exit(1))" >/dev/null 2>&1
}
pollers() {
  compose exec -T temporal temporal task-queue describe --address temporal:7233 --task-queue main 2>/dev/null \
    | sed -n '/Pollers:/,$p' | grep -c workflow || true
}
# waits up to $1 seconds for the check $2
wait_for() {
  local limit=$1 check=$2 waited=0
  while [ "$waited" -lt "$limit" ]; do
    sleep 10
    waited=$((waited + 10))
    if "$check"; then
      echo "  $check after ${waited}s"
      return 0
    fi
  done
  return 1
}
has_pollers() { [ "$(pollers)" -gt 0 ]; }

previous=$(docker inspect -f '{{.Image}}' oksocial-oksocial-1 2>/dev/null || true)
# an image built on oksocial-builder arrives with docker load: use it; anything else is pulled
if [ "$TAG" != latest ] && docker image inspect "$IMAGE:$TAG" >/dev/null 2>&1; then
  echo "using the loaded $IMAGE:$TAG (running: ${previous:0:19})"
else
  echo "pulling $IMAGE:$TAG (running: ${previous:0:19})"
  docker pull -q "$IMAGE:$TAG" >/dev/null
fi
[ "$TAG" = latest ] || docker tag "$IMAGE:$TAG" "$IMAGE:latest"
compose up -d oksocial 2>&1 | tail -1

healthy=1
# prisma db push runs before pm2 starts the backend
if ! wait_for 360 backend_up; then
  echo "  backend silent after 6 minutes, restarting it once"
  compose exec -T oksocial pm2 restart backend >/dev/null || true
  wait_for 180 backend_up || healthy=0
fi
if [ "$healthy" = 1 ] && ! wait_for 240 has_pollers; then
  echo "  no worker polls the main task queue"
  healthy=0
fi

if [ "$healthy" = 1 ]; then
  prune_images
  echo "deployed $TAG: backend answering, $(pollers) pollers on main"
  exit 0
fi
if [ -z "$previous" ]; then
  echo "deploy of $TAG is unhealthy and there is no previous image to go back to" >&2
  exit 1
fi
echo "deploy of $TAG is unhealthy, rolling back to ${previous:0:19}" >&2
docker tag "$previous" "$IMAGE:latest"
compose up -d oksocial 2>&1 | tail -1
wait_for 360 backend_up || echo "the previous image is not answering either: look at docker logs oksocial-oksocial-1" >&2
exit 1
