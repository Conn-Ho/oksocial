#!/usr/bin/env bash
# Installs a bridge-extension build (a tarball of opencli's extension/dist, e.g. only background.js)
# into ~/opencli-ext and makes every running slot Chrome use it. Usage: ./update-extension.sh <dist.tgz>
# A slot whose Chrome does not come back on the new build is reported at the end; the others go on.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
tgz=${1:?usage: update-extension.sh <dist.tgz>}
ext=~/opencli-ext
KEEP_BACKUPS=3
IDLE_WAIT_S=300
VERIFY_TRIES=12   # 5 s apart: a minute for Chrome and its service worker to come up

# The build goes over a copy of the live extension (the tarball may hold only the bundle; the
# manifest, icons and popup stay), and the copy replaces it whole: never a half-written extension.
staging="$ext.new"
rm -rf "$staging"
cp -a "$ext" "$staging"
if ! tar xzf "$tgz" -C "$staging" --no-same-owner || [ ! -f "$staging/manifest.json" ] || [ ! -f "$staging/background.js" ]; then
  echo "not a usable extension build: $tgz" >&2
  rm -rf "$staging"
  exit 1
fi
find "$staging" -name '._*' -delete   # macOS tar metadata
backup="$ext.bak-$(date +%s)"
mv "$ext" "$backup" && mv "$staging" "$ext"
ls -dt "$ext".bak-* | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -rf

# Restarting a Chrome kills what runs in it: wait (bounded) for running opencli commands to end.
for _ in $(seq 1 $((IDLE_WAIT_S / 5))); do
  pgrep -f '/usr/bin/opencli ' >/dev/null || break
  sleep 5
done
pgrep -f '/usr/bin/opencli ' >/dev/null && echo "opencli still running after ${IDLE_WAIT_S}s; restarting anyway" >&2

failed=()
restarted=()
for unit in $(systemctl list-units 'chrome@*' --state=running --no-legend --plain | awk '{print $1}'); do
  slot=${unit#chrome@}
  slot=${slot%.service}
  port=$(sed -n 's/^CDP=//p' ~/accounts/"$slot"/env 2>/dev/null)
  if [ -z "$port" ]; then
    echo "$slot: no CDP port in ~/accounts/$slot/env" >&2
    failed+=("$slot")
    continue
  fi
  # a restart alone keeps the cached service worker while the manifest version is unchanged
  node "$here/extension-ctl.mjs" reload "$port" || echo "$slot: reload failed, restarting anyway" >&2
  if ! sudo systemctl restart "$unit"; then
    failed+=("$slot")
    continue
  fi
  restarted+=("$slot:$port")
done

for entry in "${restarted[@]}"; do
  slot=${entry%%:*}
  port=${entry##*:}
  verdict=""
  for _ in $(seq 1 "$VERIFY_TRIES"); do
    sleep 5
    if verdict=$(node "$here/extension-ctl.mjs" verify "$port" "$ext/background.js" 2>&1); then
      break
    fi
  done
  echo "$slot $verdict"
  [[ "$verdict" == *"running the installed build"* ]] || failed+=("$slot")
done

if [ ${#failed[@]} -gt 0 ]; then
  echo "not on the new build: ${failed[*]} (previous extension: $backup)" >&2
  exit 1
fi
echo "every slot runs the new build"
