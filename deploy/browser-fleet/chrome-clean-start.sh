#!/bin/sh
d="$1"; mkdir -p "$d"; rm -f "$d/SingletonLock" "$d/SingletonSocket" "$d/SingletonCookie"
p="$d/Default/Preferences"
if [ -f "$p" ]; then python3 -c "import json,sys; f=sys.argv[1]; j=json.load(open(f)); j.setdefault(\"profile\",{}); j[\"profile\"][\"exit_type\"]=\"Normal\"; j[\"profile\"][\"exited_cleanly\"]=True; json.dump(j,open(f,\"w\"))" "$p" 2>/dev/null; fi
exit 0
