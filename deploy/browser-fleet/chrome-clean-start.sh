#!/bin/sh
# ExecStartPre of chrome@<account>: clears the profile's singleton locks, marks the last exit clean,
# and drops the saved window session. Automation windows the extension lost track of were otherwise
# restored on every start and piled up (174 pages on one account, navigation then rejected).
# Logins live in Cookies / Local Storage, not in Sessions, so they survive.
d="$1"; mkdir -p "$d"; rm -f "$d/SingletonLock" "$d/SingletonSocket" "$d/SingletonCookie"
rm -f "$d/Default/Sessions/"Session_* "$d/Default/Sessions/"Tabs_* 2>/dev/null
p="$d/Default/Preferences"
if [ -f "$p" ]; then python3 -c "import json,sys; f=sys.argv[1]; j=json.load(open(f)); j.setdefault(\"profile\",{}); j[\"profile\"][\"exit_type\"]=\"Normal\"; j[\"profile\"][\"exited_cleanly\"]=True; json.dump(j,open(f,\"w\"))" "$p" 2>/dev/null; fi
exit 0
