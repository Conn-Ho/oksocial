#!/usr/bin/env bash
# Install the pinned gost v3 release (linux-amd64) to /usr/local/bin/gost, verifying its SHA-256.
# gost is the per-account proxy forwarder used by `account-ctl proxy` (Chrome's --proxy-server cannot
# carry credentials, so each account gets a local gost that forwards to the authenticated upstream).
#   ./install-gost.sh            install or upgrade to the pinned version (no-op when already installed)
# To bump: change GOST_VERSION and GOST_SHA256 (from the release's checksums.txt), then re-run.
set -euo pipefail
GOST_VERSION=3.3.0
GOST_SHA256=676fb7f78d267b6ae73df719c0c7f2b565dde7147da935cfafbc1e1da558b6d5 # gost_3.3.0_linux_amd64.tar.gz
DEST=/usr/local/bin/gost

[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] || { echo "install-gost.sh: only linux-amd64 is pinned (this is $(uname -s)/$(uname -m))" >&2; exit 1; }
if [ -x "$DEST" ] && [ "$("$DEST" -V 2>/dev/null | awk '{print $2}')" = "$GOST_VERSION" ]; then
  echo "gost $GOST_VERSION already installed at $DEST"; exit 0
fi

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
asset="gost_${GOST_VERSION}_linux_amd64.tar.gz"
curl -fsSL --retry 3 --proto '=https' -o "$tmp/$asset" "https://github.com/go-gost/gost/releases/download/v$GOST_VERSION/$asset"
echo "$GOST_SHA256  $tmp/$asset" | sha256sum --check --status - || { echo "install-gost.sh: checksum mismatch for $asset, refusing to install" >&2; exit 1; }
tar -xzf "$tmp/$asset" -C "$tmp" gost
sudo install -m 0755 "$tmp/gost" "$DEST"
"$DEST" -V
