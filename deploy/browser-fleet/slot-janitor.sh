#!/bin/bash
# Restarts an account's Chrome when it holds too many pages: the extension sometimes loses track of
# its automation windows (they are never closed), and a browser with ~100+ of them starts rejecting
# navigation. A restart goes through chrome-clean-start.sh, which drops the saved window session;
# the login stays. Run hourly by oksocial-slot-janitor.timer.
set -uo pipefail
MAX_PAGES=${SLOT_JANITOR_MAX_PAGES:-40}
account-ctl list --json 2>/dev/null | python3 -c '
import json, sys
for a in json.load(sys.stdin):
    # an account someone is watching (noVNC, e.g. a login in progress) is left alone
    if a.get("chrome") == "active" and a.get("cdp") and not a.get("screen"):
        print(a["name"], a["cdp"])
' | while read -r name port; do
  [ -n "$port" ] || continue
  pages=$(curl -s --max-time 5 "localhost:$port/json" | python3 -c 'import sys,json; print(sum(1 for t in json.load(sys.stdin) if t.get("type")=="page"))' 2>/dev/null || echo 0)
  if [ "${pages:-0}" -gt "$MAX_PAGES" ]; then
    echo "$name: $pages pages, restarting"
    account-ctl restart "$name" >/dev/null 2>&1 || echo "$name: restart failed"
  fi
done
