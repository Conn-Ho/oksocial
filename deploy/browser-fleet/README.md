# browser-fleet

Host-side half of oksocial's browser automation. Each social-media account ("slot") gets its own Chrome
for Testing on its own Xvfb display, with the opencli bridge extension, all paired with the single opencli
daemon on `127.0.0.1:19825`. The Postiz app (Docker) drives the slots through the **browser worker**, a small
HTTP service on the host at `host.docker.internal:7788`.

```
Postiz (docker) ──HTTP + x-worker-token──▶ browser worker :7788 ──execFile──▶ account-ctl (sudo systemctl …)
Caddy /screen/* ─(login, injects token)──▶        │                  └─────▶ opencli … -f json  (OPENCLI_PROFILE=<slot>)
                                                  └─ /screen/<slot>/* ──▶ websockify 127.0.0.1:6080+DISP-10 ──▶ x11vnc :DISP
chrome@<slot> ──--proxy-server=127.0.0.1:18000+idx──▶ gost@<slot> ──user:pass──▶ upstream proxy (optional)
```

| File | What it is |
|---|---|
| `account-ctl` | Slot manager (bash). Installed as `/usr/local/bin/account-ctl`. Backward compatible with the slots already on the VM. |
| `install-gost.sh` | Installs the pinned gost v3 (3.3.0, linux-amd64) to `/usr/local/bin/gost`, SHA-256 verified. |
| `chrome-clean-start.sh` | Unchanged copy of `~/chrome-clean-start.sh` (the `ExecStartPre` of every Chrome unit). |
| `oksocial-browser-worker.service` | systemd unit for the worker. |
| `worker/` | The worker: TypeScript on Node 22 (`node src/main.ts`, no build step), Fastify 5, @fastify/http-proxy, zod. |

## Install on the VM

Run as `mac` (never as root; account-ctl refuses root and uses sudo itself). Prerequisites already on the VM:
Node 22 at `/usr/bin/node`, opencli at `/usr/bin/opencli`, Xvfb, x11vnc, websockify + noVNC in `/usr/share/novnc`,
Chrome for Testing, the bridge extension in `~/opencli-ext`, `python3`, `curl`.

```bash
# 0. Copy this folder to the VM as ~/oksocial/browser-fleet (e.g. tar over gcloud compute ssh), then:
cd ~/oksocial/browser-fleet

# 1. gost (per-slot proxy forwarder)
./install-gost.sh

# 2. account-ctl (keep the old one for rollback) + unit templates
sudo cp /usr/local/bin/account-ctl /usr/local/bin/account-ctl.bak
sudo install -m 0755 account-ctl /usr/local/bin/account-ctl
[ -x ~/chrome-clean-start.sh ] || install -m 0755 chrome-clean-start.sh ~/chrome-clean-start.sh
account-ctl install-units          # rewrites xvfb@/chrome@/gost@/x11vnc@/novnc@ templates; running Chromes are untouched
account-ctl list --json            # every existing slot should be listed

# 3. worker dependencies (production only)
cd worker && npm ci --omit=dev && cd ..

# 4. env file (0600, owned by mac). Put the same token in the Postiz app env and in Caddy.
install -m 0600 /dev/null ~/oksocial/browser-worker.env
cat >> ~/oksocial/browser-worker.env <<EOF
BROWSER_WORKER_TOKEN=$(openssl rand -hex 32)
PORT=7788
HOST=0.0.0.0
ACCOUNT_CTL=/usr/local/bin/account-ctl
OPENCLI_BIN=/usr/bin/opencli
MEDIA_DIR=/tmp/oksocial-media
MEDIA_ALLOWED_ORIGINS=https://oksocial.online
MEDIA_MAX_BYTES=1073741824
# Optional but recommended: only these opencli sites may be run (comma-separated first args).
# RUN_ALLOWED_SITES=twitter,xq,xq2,xapi,xiaohongshu,xhs2,xhsdm,weibo,douyin,wechat-channels,bilibili,zhihu,jike,toutiao,instagram,facebook,tiktok,youtube,linkedin,reddit,pinterest,pinterest-auth,weixin,weixin-auth
# Optional, real-time DM watch (see "Real-time DM watch" below); these are the defaults:
# DM_WATCH_STATE_FILE=/tmp/oksocial-dm-watch.json
# DM_WATCH_YIELD=1
EOF

# 5. service
sudo install -m 0644 oksocial-browser-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oksocial-browser-worker
set -a; . ~/oksocial/browser-worker.env; set +a
curl -s -H "x-worker-token: $BROWSER_WORKER_TOKEN" http://127.0.0.1:7788/health
```

Port 7788 must stay closed in the GCP firewall: only the containers (via `host.docker.internal`) and Caddy
talk to it. The traffic is plain HTTP on the host, so for defense in depth you can set `HOST=172.17.0.1` (the
docker0 gateway that `host.docker.internal` resolves to) instead of `0.0.0.0`; the unit then needs Docker up first. Logs: `journalctl -u oksocial-browser-worker -f` (pino JSON; the token and proxy credentials are
never logged). Rollback: `sudo systemctl disable --now oksocial-browser-worker` and restore `account-ctl.bak`.

### opencli plugins

`plugins/` holds the commands oksocial needs that opencli does not ship: `xhs2` (小红书 creator identity and
notes), `xhs-dm` (`xhsdm`, 小红书 web DMs; its page scripts are in `pages.js` next to `dm.js`, so always copy the
whole folder), `pinterest-auth` and `weixin-auth` (`whoami` of the Pinterest and 公众号 channels: opencli has no
login check for those sites). Each folder is a plugin; install or update one with

```bash
opencli plugin install ~/oksocial/browser-fleet/plugins/<name>   # or copy the folder to ~/.opencli/plugins/<name>
opencli <site> --help                                            # e.g. opencli pinterest-auth --help
```

### Updating the bridge extension

Every slot Chrome loads the opencli bridge extension from `~/opencli-ext`. To roll out a new build
(opencli's `extension/dist`, built with `npx vite build` in `extension/`):

```bash
# on your machine
COPYFILE_DISABLE=1 tar czf /tmp/ext-dist.tgz -C <opencli>/extension/dist .
# on the VM
~/oksocial/browser-fleet/update-extension.sh /tmp/ext-dist.tgz
```

It lays the build over a copy of the current extension (manifest, icons and popup stay), swaps it in,
waits for running opencli commands, reloads the extension and restarts each running slot Chrome (a
restart alone keeps the cached service worker while the manifest version is unchanged), then checks
that every Chrome runs the new bundle (`extension-ctl.mjs verify`). Logins survive the restart.

### Caddy (not applied here)

Caddy must authenticate the user first, then forward to the worker with the token. Sketch, to adapt to the
app's auth endpoint (`reverse_proxy` passes the noVNC WebSocket through as is):

```caddy
handle /screen/* {
	forward_auth oksocial:5000 {
		uri /api/<session-check-endpoint>
	}
	reverse_proxy host.docker.internal:7788 {
		header_up X-Worker-Token {$BROWSER_WORKER_TOKEN}
	}
}
```

## opencli version

The VM runs our own opencli build: private repo `Conn-Ho/opencli-oksocial`, branch `oksocial` (upstream
`jackwener/opencli` plus our fixes: 头条号 whoami on profile_v4, 知乎 answer-detail without the signed
API, weixin search in a 公众号 browser, XHS search options, the extension's file chooser gesture).
Versions read `<upstream>-oksocial.<n>`, e.g. `1.8.8-oksocial.1` (`opencli --version`).

To ship a change, commit it on `oksocial`, bump the version, then on a checkout:

```bash
npm ci && npm run build && npm pack            # → jackwener-opencli-<version>.tgz
gcloud compute scp jackwener-opencli-*.tgz social-ops-1:/tmp/opencli-oksocial.tgz --zone asia-east2-a --project agentdesk-505102
# on the VM, when no run is in progress (worker /health: running 0):
sudo npm i -g /tmp/opencli-oksocial.tgz && opencli --version
```

The bridge extension ships separately: `./package-extension.sh <opencli-oksocial checkout>` builds it
into the VM's flat layout with `extension-manifest.json` (name okcli, the VM's permission set), then
`./update-extension.sh <tgz>` rolls it out. Keep the manifest's permissions unchanged: Chrome disables
an unpacked extension whose permissions grow (`disable_reasons` [4] in the profile's Preferences), and
update-extension.sh re-enables any slot where that happened anyway.

The previous build stays in `/usr/lib/node_modules/@jackwener/opencli-1.8.8-upstream` for a rollback
(`sudo rm -rf …/opencli && sudo cp -a …/opencli-1.8.8-upstream …/opencli`). To take an upstream
release, merge it into `oksocial` (the repo keeps `upstream-main`). Plugins in `~/.opencli/plugins` are
untouched by a reinstall.

## account-ctl

```
account-ctl create <name> [--proxy <url|->]   new slot: dir, idx, display 10+idx, CDP 9300+idx, start Xvfb + Chrome
account-ctl proxy <name> <url|-|none>         set/replace/remove the slot's upstream proxy (- = read the URL from stdin)
account-ctl screen|unscreen <name>            noVNC on 127.0.0.1:6080+DISP-10 (x11vnc@ + novnc@ units)
account-ctl start|stop|restart <name>         Chrome on/off (login state stays on disk)
account-ctl remove <name> [--purge]           stop + disable Chrome, gost, screen (and the slot's Xvfb); --purge deletes the dir
account-ctl list [--json]                     text table (unchanged) or [{name, display, cdp, screenPort, chrome, unit, profileId, proxy, screen}]
account-ctl profile <name>                    bridge profile id
account-ctl install-units                     (re)write the systemd unit templates
```

Exit codes: `0` ok, `1` failure, `2` usage / invalid input, `3` no such slot, `4` not supported on a legacy unit.

On-disk layout (unchanged, extended): `/home/mac/accounts/<name>/` holds `idx`, `env` (`DISP=`, `CDP=`, now also
`PROXY_ARGS=`), optional `unit` (legacy unit name override), `profile/`, and when proxied `proxy.url` + `gost.json`
(both 0600). Slots without a `PROXY_ARGS` line keep working (it expands to nothing).

Changes from the previous script, all deliberate:
- `create` on an existing slot is a no-op (it used to rewrite `env` and start Chrome). A stopped slot such as `x2`
  is therefore never started by create, by the worker's `POST /slots`, or by a proxy change (`try-restart`).
- The screen now runs as `x11vnc@<name>` + `novnc@<name>` units bound to 127.0.0.1, with no VNC password: the only way
  in is Caddy's login plus the worker token. Screens started by the old script are killed when a slot's screen is
  (re)started or stopped. The old public `:608x` URL no longer works; the old app's proxy to 127.0.0.1 still does.
- `profile_id` no longer prints a stray `?` line when a profile has only `*.log` or only `*.ldb` files.
- create/proxy/remove take a lock (`flock` on `$BASE/.lock`) so concurrent calls cannot hand out the same idx.

### Per-slot proxy

Chrome's `--proxy-server` cannot carry credentials, so each proxied slot gets a local gost v3 forwarder:

1. `account-ctl proxy <slot> -` reads the URL from stdin (`http|https|socks5|socks5h://[user:pass@]host:port`,
   credentials percent-encoded; the worker normalizes this for you).
2. It writes `proxy.url` and `gost.json` (0600): an HTTP proxy on `127.0.0.1:18000+idx` chained to the upstream, with
   the decoded credentials. The credentials never appear on a command line, in `ps`, `systemctl status` or logs.
   `https://` upstreams are dialed over TLS with certificate verification; `socks5h` is treated as `socks5`
   (gost resolves names on the proxy side either way).
3. `env` gets `PROXY_ARGS="--proxy-server=http://127.0.0.1:<port> --force-webrtc-ip-handling-policy=disable_non_proxied_udp"`
   (the WebRTC flag stops the host IP leaking over UDP), and a drop-in orders `chrome@<slot>` after `gost@<slot>`.
4. `gost@<slot>` is enabled and restarted; `chrome@<slot>` is restarted only if it was running.

If gost or the upstream is down, Chrome's requests fail; they never fall back to the VM's own IP.
`proxy <slot> none` removes all of it. Setting the same URL again is a no-op.

### Migrating a legacy unit (wenwen)

`wenwen` runs on the original `chrome.service` (display :1, CDP 9222) via its `unit` file, so `account-ctl proxy wenwen …`
exits 4 with an explanation. To move it onto `chrome@wenwen` (login state is kept; the bridge profile id lives in the
Chrome profile and does not change):

```bash
account-ctl install-units
ls -la ~/accounts/wenwen/profile      # must be the live profile; if chrome.service used ~/chrome-profile:
#   rm -rf ~/accounts/wenwen/profile && ln -s ~/chrome-profile ~/accounts/wenwen/profile
sudo systemctl disable --now chrome
rm ~/accounts/wenwen/unit             # env keeps DISP=1 / CDP=9222; display :1 stays on the existing xvfb.service
sudo systemctl enable --now chrome@wenwen
account-ctl list --json               # wenwen: unit chrome@wenwen, chrome active
```

## Worker API

Every request, including `/health`, WebSocket upgrades and unknown paths, needs `x-worker-token: $BROWSER_WORKER_TOKEN`
(constant-time compare), otherwise `401 {ok:false, code:"UNAUTHORIZED", error}`. Errors use
`{ok:false, code, error, …}`: `400 BAD_REQUEST` (with `issues`), `403 SITE_NOT_ALLOWED` / `MEDIA_ORIGIN_NOT_ALLOWED`,
`404 NOT_FOUND`, `409` (legacy unit / Chrome not running), `429 QUEUE_FULL`, `502`, `503 SHUTTING_DOWN`,
`504 NOT_READY` (with the last `slot` state), `500 INTERNAL` (details only in logs).

A **slot** is `{name, display, cdp, screenPort, chrome, unit, profileId, proxy, screen}`; `chrome` is the systemd
state (`active`, `inactive`, `failed`, `activating`, …), `profileId` is `null` until the extension registered.

| Route | Request | Response |
|---|---|---|
| `GET /health` | | `{ok:true, slots:n, daemon:"up"\|"down", runs:{running, pending}, dmWatch:{watchers, healthy}}`; 503 if account-ctl fails |
| `GET /slots` | | `Slot[]` |
| `GET /slots/:slot` | | `Slot` or 404 |
| `POST /slots` | `{slot: /^[a-z0-9][a-z0-9-]{1,31}$/, proxy?: string\|null}` | `201 Slot` after Chrome is active (≤30 s), or `200 Slot` if it existed. An existing slot is only touched when `proxy` is given and differs; a stopped one stays stopped. |
| `POST /slots/:slot/proxy` | `{proxy: string\|null}` | `Slot` (waits for Chrome if it was running) |
| `POST /slots/:slot/start` | | `Slot` once active (≤30 s) |
| `POST /slots/:slot/stop` | | `Slot` |
| `DELETE /slots/:slot?purge=1` | | `{ok:true, slot, purged}` |
| `POST /slots/:slot/open` | `{url: http(s)}` | `{ok:true, targetId, url}` (new tab via CDP `PUT /json/new`) |
| `POST /slots/:slot/screen` | | `{path:"/screen/<slot>/vnc.html?autoconnect=1&resize=scale&reconnect=1&path=screen/<slot>/websockify"}` once the port listens |
| `DELETE /slots/:slot/screen` | | `{ok:true, slot}` |
| `GET /screen/:slot/*` (+ WebSocket) | | proxied to `127.0.0.1:<screenPort>/*`; 502 while the screen is not running |
| `GET /slots/:slot/login-form?hints=<JSON>` | `hints`: optional `{loginUrls?: string[≤10], identifier?, password?, code?, submit?, error?, prompt?, captcha?}` (CSS selectors ≤300 chars; `loginUrls` are host+path prefixes) | `{step: identifier\|password\|code\|captcha\|done\|unknown, prompt, detail, error, field: {kind, label, inputType, inputMode, autocomplete, maxLength}\|null, next?: "password"}` of the screen tab |
| `POST /slots/:slot/login-form` | `{step: identifier\|password\|code, value: string[1..512] (no control characters), hints?}` | the state after typing `value` into that step's field and submitting it (`next:"password"`: only typed); `stale:true` when the page was on another step (nothing typed); `409 BUSY` while another submit types into the slot |
| `POST /slots/:slot/run` | `{args: string[1..40] (≤32000 chars each, ≤200000 in all, no NUL), timeoutMs?: 1000..600000 = 120000}` | always 200: `{ok:true, data, durationMs}` or `{ok:false, code, exitCode, message, opencliCode?, help?, durationMs}` |
| `POST /media/fetch` | `{urls: string[1..20]}` | `{paths: string[]}` (same order) |
| `PUT /dm-watch` | `{accounts: [{slot, key: /^[A-Za-z0-9_-]{1,64}$/}] (≤1000)}`: every account to watch | `{ok:true, watchers: Watcher[]}`; accounts left out are dropped and their tabs closed |
| `GET /dm-watch` | | `{ok:true, watchers: Watcher[]}` |
| `GET /dm-watch/changes?cursor=<c>&waitMs=0..55000` | | `{ok:true, cursor, changes:[{slot, key, at}]}`: one per account changed after `cursor`, waiting up to `waitMs` for one; no cursor, or one of another worker process, starts from now (nothing is replayed) |

**Runs** execute `opencli <args> -f json` (unless a format is given) with `OPENCLI_PROFILE=<profileId>` and
execFile (no shell; the worker token is stripped from every child's env); 400 `NO_PROFILE` if the slot has no profile
id yet. `args[0]` must be a site command (`^[a-z0-9][a-z0-9-]*$`, no leading option) and never one of opencli's
built-ins (`browser`, `external`, `plugin`, `daemon`, `profile`, `doctor`, …), external-CLI passthroughs (`docker`,
`gh`, `vercel`, …) or desktop-app adapters: several of those run arbitrary programs. `--profile` is refused anywhere.
With `RUN_ALLOWED_SITES` set, `args[0]` must also be on that list (403 otherwise). One run per slot at a time
(FIFO), at most 3 across slots, at most 50 waiting per slot (then 429); a run still waiting is dropped if the client
disconnects, and on shutdown waiting runs get 503 while running ones finish. `code`: `CHALLENGE` (the platform challenged/restricted the account; checked first, never retried),
`TIMEOUT` (our deadline or opencli exit 75), `USAGE` (2), `EMPTY` (66), `BRIDGE_DOWN` (69), `NOT_LOGGED_IN` (77),
`CONFIG` (78), else `FAILED`. On `BRIDGE_DOWN`, with the slot's Chrome active, the worker restarts that Chrome once,
waits up to 40 s for its profile in `opencli profile list`, and retries once (the shared daemon is never restarted).
A transient "tab not ready" failure is retried once immediately. Both are safe because the command never reached the
page. A stuck bridge tab (`Target closed`, `tab lease`, …) also gets that Chrome restarted, but the run is **not**
retried, because a write may already have gone through. Retries share the run's `timeoutMs` budget (at least 5 s each).

**Login form** (oksocial's own form for password platforms): `LOGIN_FORM_PAGE` runs in the screen tab and detects the
step generically (visible password inputs, `autocomplete`/`inputmode`/name hints, split code boxes, open shadow roots,
captcha frames such as Arkose, reCAPTCHA, hCaptcha, GeeTest and Turnstile, and the URL leaving `loginUrls`); `hints` add
per-platform selectors. It reads the page's heading, the text under it and its error text, never what a field holds.
Typing is a real click into the field, its old text selected and deleted, then CDP key presses (`Input.insertText` for
non-ASCII) with 45-140 ms gaps, then a click on the step's button (or Enter), and the next state once the page changed
(at most ~8 s). The value is only ever in the request body and in `Input.*` events: never in an evaluated expression, a
response, an error message (typing failures become `TYPING_FAILED`) or a log line (`req.body`/`value` are redacted and
errors of `/login-form` requests are logged without their message). A captcha is never touched: the step is `captcha`.

**Real-time DM watch** (`src/dm-watch/`): the orchestrator (oksocial's `okchatDmWatchWorkflow`) PUTs the accounts
linked to okchat every minute and long-polls `/dm-watch/changes`; a change is read right away, the same read as the
poll's. For each watched account the worker keeps one tab on `https://www.xiaohongshu.com/chat` in a window of its
own (`Target.createTarget` with `newWindow`), so the bridge extension, which only ever leases tabs it created in its
automation window, never adopts, reuses or closes it. It attaches over the slot's CDP port with `Runtime.addBinding`
and a MutationObserver (`Page.addScriptToEvaluateOnNewDocument`, and evaluated at once) over the conversation list;
the observer reports ids, unread counts and a hash of each preview (never message text), at most every 2 s. A list
with more unread or a new preview is a change; our own reads (unread going down) are not. Every 15 s the worker also
checks the tab: the check doubles as a fallback when binding calls do not arrive.

- It only ever shows the conversation list: nothing is clicked, typed or marked read.
- It stays out of the account's runs: no tab is opened or navigated while a run of that slot runs or waits, nor
  within 45 s after one (the bridge releases its tab after 30 s). An `xhsdm` run first parks the tab on
  `about:blank` (the web IM may serve one page per account) and it comes back once the slot is quiet; the list is
  then compared with the one before, so a DM that came in meanwhile is still a change. `DM_WATCH_YIELD=0` turns
  parking off if the web IM turns out to serve both tabs.
- A tab that shows no list (`在其他页面打开`, logged out, nothing) for 45 s after it was loaded is reloaded, then again
  after 1, 2, 4… up to 30 minutes; one that looks fine is reloaded every 3 hours.
- When the account's Chrome restarts (the janitor, `update-extension.sh`, a heal), the socket closes and the next
  check opens a new tab. Tabs are remembered in `DM_WATCH_STATE_FILE` (0600) and adopted after a worker restart;
  remembered tabs of accounts the first PUT leaves out are closed.
- Opening never piles up windows: an open that failed but made its window anyway (a busy Chrome) keeps that
  window, a failed open waits 1, 2, 4… minutes before the next, and no tab is opened in a browser that already
  holds 20 pages.
- While `screen` is on (someone on noVNC), nothing is opened, navigated, parked or closed; an existing tab is still
  watched. The login screen's tab picker never takes a watcher tab.
- `Watcher`: `{slot, key, phase: starting|watching|parked|screen|chrome-down|missing|simulated|failed, page:
  list|elsewhere|logged-out|no-list|blank|null, healthy, reason, lastListAt, lastChangeAt}`. Healthy: the list was
  seen in the last 3 minutes, or the tab is parked for the account's runs (up to 45 s + 3 minutes, a read). oksocial reads a
  healthy account every 5 minutes as a safety net instead of every minute.

**Media**: only http(s) URLs on `MEDIA_ALLOWED_ORIGINS`, re-checked after each of at most 3 redirects; `MEDIA_MAX_BYTES`
enforced on `Content-Length` and while streaming (the partial file is deleted); extension from the content type
(jpg/png/gif/webp/mp4/mov/webm) or the URL path; written to a temp file (0600) and renamed to `<sha256(url)>.<ext>`;
reused while present (reuse refreshes the mtime); swept hourly when older than 24 h. At most 4 downloads run at once
and 100 wait (then 429). `MEDIA_DIR` must be a real directory owned by `mac` (a symlink or another user's directory,
e.g. one pre-created in `/tmp`, is refused) and is kept at 0700. There is no total size quota: disk use is bounded
only by what the app requests within 24 h.

## Simulated accounts (E2E)

End-to-end tests of oksocial's real pipelines (login keep-alive, publishing, inbox sync, 监控, 竞品 VS, interact) without
real social-media accounts. Only the browser is fake: backend, Temporal workflows, provider parsing, DB and
notifications all run for real. **Never enable this on the production host.**

**Worker.** Set `SIM_OPENCLI_BIN` to the simulator, `worker/sim/sim-opencli.mjs` (plain Node, no dependencies, never
touches the network; executable in git), and optionally `SIM_STATE_DIR` (default `/tmp/oksocial-sim`). Every slot named
`sim-*` is then virtual; every other slot behaves exactly as before, and with `SIM_OPENCLI_BIN` unset `sim-*` names are
ordinary slots.

- `GET /slots/:slot` and `POST /slots` return `{…, chrome:"active", unit:"simulated", profileId:<slot name>}`; proxy set/clear,
  start, stop and `DELETE` are no-op successes (state files are kept). Nothing reaches account-ctl, and sim slots are not
  listed by `GET /slots` or counted by `/health`.
- `open`, `POST`/`DELETE /slots/:slot/screen` and `/screen/<slot>/*` answer `400 SIMULATED_SLOT`.
- `/run` keeps its validation, `RUN_ALLOWED_SITES` (include `xhsdm` if you set it) and the per-slot queue, but runs the
  simulator with `OPENCLI_PROFILE=<slot>` and `SIM_STATE_DIR`; no Chrome healing, no retries.
- `/media/fetch` is unchanged: publishing downloads the media first, and the simulator checks the files exist.

**Backend.** Set `OKSOCIAL_SIM_ACCOUNTS=1`. A superadmin then creates a simulated channel through the normal login
pipeline (anyone else, or without the flag: `403`; there is no UI for it). `provider` is `xiaohongshu`, `weibo`, `douyin`
or `xweb`; `$BACKEND` is `NEXT_PUBLIC_BACKEND_URL` (e.g. `https://oksocial.online/api`) and `$JWT` the `auth` cookie.

```bash
curl -s -X POST "$BACKEND/browser-sessions" -H "auth: $JWT" -H 'content-type: application/json' \
  -d '{"provider":"xiaohongshu","simulated":true}'
# {"id":"<session>","screenPath":null,"simulated":true}      slot: sim-xiaohongshu-<8 random chars>
curl -s "$BACKEND/browser-sessions/<session>?timezone=480" -H "auth: $JWT"
# {"status":"connected","integrationId":"<channel>"}         whoami answered by the simulator
```

The channel is created exactly like a real one (Integration with the slot as token, keep-alive refresh workflow).

**What the simulator plays.** Each slot is one account per platform, derived from the slot name (names start with
`模拟`). Its state lives in `SIM_STATE_DIR/<slot>.state.json`:

- publishes (`xiaohongshu publish`, `weibo publish`, `douyin publish`, `xq post`/`reply`) add to the account's own posts,
  so the providers' follow-up lookups find the new id; the real adapters' argument checks are mirrored (Xiaohongshu
  title ≤ 20 UTF-16 units, files must exist, Douyin schedule 2 h to 14 days ahead);
- own posts gain views/likes/collects/shares on every read, followers creep up;
- a seeded inbox (comments, @mentions, Xiaohongshu DMs; buyers asking "请问怎么购买？多少钱" and a complaint), plus a new
  comment every `SIM_NEW_COMMENT_EVERY` reads (default 3);
- other accounts, searches, notes/posts/threads and their comments are deterministic per id or keyword, published on a
  fixed timetable so new ones keep appearing; X followers/following include people not followed back.

**Control file** `SIM_STATE_DIR/<slot>.control.json` (optional, written by the test harness):

| Content | Effect |
|---|---|
| `{"loggedOut": true}` | every command fails `NOT_LOGGED_IN` (exit 77): keep-alive marks the channel for re-login |
| `{"challenge": true}` | write commands fail with an `ACCOUNT_CHALLENGE` message: the worker returns `CHALLENGE` |
| `{"failNext": "message"}` | the next command fails once (`FAILED`, exit 1); the key is removed, other keys stay |

**writes.jsonl.** Every successful write (publish, `xq post`/`reply`, `xhsdm send`, `twitter like`/`bookmark`/`follow`)
appends `{"time","slot","args"}` to `SIM_STATE_DIR/writes.jsonl` (`args` without the `-f json`), so tests can assert
what was done.

## Development

```bash
cd worker
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm install
npm test            # node --test, no extra framework
npm run coverage    # fails under 80 % line coverage of src/ (main.ts excluded)
npm run typecheck   # tsc --noEmit
```

Route tests use Fastify `inject` with fake account-ctl / opencli; the screen proxy and media tests run against local
`node:http` servers; `test/shell.test.ts` runs `bash -n`, shellcheck (skipped if not installed) and exercises
account-ctl against stub `sudo`/`systemctl` in a temp directory (`ACCOUNT_CTL_BASE`, `ACCOUNT_CTL_UNIT_DIR`,
`ACCOUNT_CTL_GOST` exist only for that). `test/sim-opencli.test.ts` drives the simulator through the worker's own opencli
runner; `libraries/nestjs-libraries/src/integrations/browser.simulator.spec.ts` (repo root `npx jest`) feeds its output
to the four browser providers.
