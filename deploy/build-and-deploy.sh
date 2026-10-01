#!/usr/bin/env bash
# Builds the image of a commit on the oksocial-builder VM (8 cores, Docker cache kept on its disk),
# loads it into social-ops-1 over the internal network (no registry round trip), deploys it with
# deploy.sh (health-checked, rolls back), and stops the builder again. Run from a checkout:
#   deploy/build-and-deploy.sh [commit, default origin/main] [--no-deploy]
# The builder's key may only run `docker load` on the server, and only from the builder's address.
set -euo pipefail
ZONE=asia-east2-a
PROJECT=agentdesk-505102
BUILDER=oksocial-builder
SERVER=social-ops-1
SERVER_IP=10.170.0.4
IMAGE=ghcr.io/conn-ho/oksocial
DEPLOY=1
REF=origin/main
for arg in "$@"; do
  case "$arg" in
    --no-deploy) DEPLOY=0 ;;
    *) REF="$arg" ;;
  esac
done
git fetch -q origin
sha=$(git rev-parse "$REF")
gc() { gcloud compute "$@" --zone "$ZONE" --project "$PROJECT"; }

started=$(date +%s)
if [ "$(gc instances describe "$BUILDER" --format='value(status)')" != RUNNING ]; then
  gc instances start "$BUILDER" --quiet >/dev/null
fi
until gc ssh "$BUILDER" --command true >/dev/null 2>&1; do sleep 5; done
trap 'gc instances stop "$BUILDER" --quiet --async >/dev/null 2>&1 || true' EXIT

echo "building ${sha:0:8} on $BUILDER"
gc ssh "$BUILDER" --command "set -euo pipefail
cd ~/oksocial && git fetch -q origin && git checkout -q --detach $sha
docker build -q -f Dockerfile.dev --build-arg NEXT_PUBLIC_VERSION=$sha -t $IMAGE:$sha . >/dev/null
echo \"  built after \$(( \$(date +%s) - $started ))s, loading into $SERVER\"
docker save $IMAGE:$sha | ssh -o BatchMode=yes -i ~/.ssh/deploy_ed25519 mac@$SERVER_IP
docker rmi -f $IMAGE:$sha >/dev/null"
echo "  loaded after $(( $(date +%s) - started ))s"
if [ "$DEPLOY" = 1 ]; then
  gc ssh "$SERVER" --command "~/oksocial/deploy/deploy.sh $sha"
  echo "done after $(( $(date +%s) - started ))s"
fi
