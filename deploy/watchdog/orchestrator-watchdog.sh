#!/usr/bin/env bash
# Restarts the orchestrator when no worker polls Temporal's "main" task queue on two checks in a
# row (a stuck worker leaves every scheduled post, sync and automation waiting without an error),
# and the backend when nothing answers on its port on three checks in a row (a backend stuck at
# startup leaves the whole site on 502). Run by oksocial-orchestrator-watchdog.timer every 2 minutes.
set -euo pipefail
cd "${OKSOCIAL_DEPLOY_DIR:-$HOME/oksocial/deploy}"
STATE=/tmp/oksocial-orchestrator-watchdog.misses
BACKEND_STATE=/tmp/oksocial-backend-watchdog.misses
compose() { docker compose -f docker-compose.prod.yml "$@"; }

# any HTTP answer counts: the backend is listening
if compose exec -T oksocial node -e "fetch('http://127.0.0.1:3000/',{signal:AbortSignal.timeout(5000)}).then(()=>process.exit(0),()=>process.exit(1))" >/dev/null 2>&1; then
  rm -f "$BACKEND_STATE"
else
  # a fresh container runs prisma db push before pm2 starts the backend: allow two rounds for that
  backend_misses=$(( $(cat "$BACKEND_STATE" 2>/dev/null || echo 0) + 1 ))
  echo "$backend_misses" > "$BACKEND_STATE"
  if [ "$backend_misses" -ge 3 ]; then
    echo "the backend has not answered for $backend_misses checks, restarting it"
    compose exec -T oksocial pm2 restart backend >/dev/null || true
    rm -f "$BACKEND_STATE"
  fi
fi

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
