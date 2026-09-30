#!/usr/bin/env bash
# Restarts the orchestrator when no worker polls Temporal's "main" task queue on two checks in a
# row (a stuck worker leaves every scheduled post, sync and automation waiting without an error).
# Run by oksocial-orchestrator-watchdog.timer every 2 minutes.
set -euo pipefail
cd "${OKSOCIAL_DEPLOY_DIR:-$HOME/oksocial/deploy}"
STATE=/tmp/oksocial-orchestrator-watchdog.misses
compose() { docker compose -f docker-compose.prod.yml "$@"; }

pollers=$(compose exec -T temporal temporal task-queue describe --address temporal:7233 --task-queue main 2>/dev/null \
  | sed -n '/Pollers:/,$p' | grep -c workflow || true)
if [ "${pollers:-0}" -gt 0 ]; then
  rm -f "$STATE"
  exit 0
fi
# the container may just be starting (prisma db push, pm2): give it one more round
misses=$(( $(cat "$STATE" 2>/dev/null || echo 0) + 1 ))
echo "$misses" > "$STATE"
if [ "$misses" -ge 2 ]; then
  echo "no poller on the main task queue for $misses checks, restarting the orchestrator"
  compose exec -T oksocial pm2 restart orchestrator >/dev/null
  rm -f "$STATE"
fi
