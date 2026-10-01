#!/usr/bin/env bash
# Packages the okcli bridge extension for the VM from a checkout of Conn-Ho/opencli-oksocial:
# its built background.js, popup and icons in the VM's flat layout (~/opencli-ext), with
# extension-manifest.json from this directory as the manifest. Roll it out with update-extension.sh.
#   ./package-extension.sh ~/Workspace/git/opencli-oksocial [out.tgz]
# Keep extension-manifest.json's permissions unchanged: Chrome disables an unpacked extension whose
# permissions grow, in some profiles, and those slots then run no command.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
src=${1:?path to the opencli-oksocial checkout}
out=${2:-/tmp/okcli-ext.tgz}
ext="$src/extension"
(cd "$ext" && npm ci --no-audit --no-fund >/dev/null && npm run build >/dev/null)
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/icons"
cp "$here/extension-manifest.json" "$stage/manifest.json"
cp "$ext/dist/background.js" "$ext/popup.html" "$ext/popup.js" "$stage/"
cp "$ext"/icons/*.png "$stage/icons/"
(cd "$stage" && COPYFILE_DISABLE=1 tar czf "$out" manifest.json background.js popup.html popup.js icons)
echo "$out ($(python3 -c "import json,sys; m=json.load(open(sys.argv[1])); print(m['name'], m['version'])" "$stage/manifest.json"))"
