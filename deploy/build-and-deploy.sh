#!/usr/bin/env bash
# Builds the image of a commit on the oksocial-builder VM (8 cores, Docker cache kept on its disk),
# loads it into social-ops-1 over the internal network (no registry round trip), deploys it with
# deploy.sh (health-checked, rolls back), and stops the builder again. Run from a checkout:
#   deploy/build-and-deploy.sh [commit, default origin/main] [--no-deploy]
# The build runs detached on the builder (a quiet 10-minute build outlives an idle SSH session);
# this script only starts it and polls its status file. The builder's key may only run
# `docker load` on the server, and only from the builder's address.
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
on_builder() { gc ssh "$BUILDER" --ssh-flag=-oServerAliveInterval=20 --command "$1" 2>/dev/null; }

started=$(date +%s)
since() { echo "$(( $(date +%s) - started ))s"; }
if [ "$(gc instances describe "$BUILDER" --format='value(status)')" != RUNNING ]; then
  gc instances start "$BUILDER" --quiet >/dev/null
fi
until on_builder true; do sleep 5; done
trap 'gc instances stop "$BUILDER" --quiet --async >/dev/null 2>&1 || true' EXIT

# the image is loaded next to the old ones: drop those first and make sure it fits (~8 GB unpacked twice)
free=$(gc ssh "$SERVER" --command "~/oksocial/deploy/deploy.sh --prune" 2>/dev/null | tail -1)
if [ -z "$free" ] || [ "$free" -lt 20 ]; then
  echo "only ${free:-?} GB free on $SERVER after pruning old images; not loading another one" >&2
  exit 1
fi
echo "building ${sha:0:8} on $BUILDER ($free GB free on $SERVER)"
# status file: running | loaded | failed:<step>; the log keeps the build output
on_builder "cat > /tmp/build-$sha.sh <<'SCRIPT'
set -uo pipefail
status() { echo \"\$1\" > /tmp/build-$sha.status; }
status running
cd ~/oksocial && git fetch -q origin && git checkout -q --detach $sha || { status failed:checkout; exit 1; }
docker build -f Dockerfile.dev --build-arg NEXT_PUBLIC_VERSION=$sha -t $IMAGE:$sha . || { status failed:build; exit 1; }
docker save $IMAGE:$sha | ssh -o BatchMode=yes -o ServerAliveInterval=20 -i ~/.ssh/deploy_ed25519 mac@$SERVER_IP || { status failed:load; exit 1; }
docker rmi -f $IMAGE:$sha >/dev/null
status loaded
SCRIPT
nohup bash /tmp/build-$sha.sh > /tmp/build-$sha.log 2>&1 &"

while :; do
  sleep 15
  state=$(on_builder "cat /tmp/build-$sha.status 2>/dev/null" || echo unreachable)
  case "$state" in
    loaded) echo "  loaded into $SERVER after $(since)"; break ;;
    failed:*)
      echo "  $state after $(since); last lines of the log:" >&2
      on_builder "tail -25 /tmp/build-$sha.log" >&2 || true
      exit 1 ;;
  esac
done
if [ "$DEPLOY" = 1 ]; then
  gc ssh "$SERVER" --command "~/oksocial/deploy/deploy.sh $sha"
  echo "done after $(since)"
fi
