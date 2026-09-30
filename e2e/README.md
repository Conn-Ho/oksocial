# End-to-end tests

Runs the real product (backend, Temporal workflows, browser worker, provider parsing, database,
notifications) against a deployed oksocial. Social platforms are replaced by the simulator
(`deploy/browser-fleet/worker/sim`), so no real account is touched.

Requirements on the server: the worker runs with `SIM_OPENCLI_BIN` / `SIM_STATE_DIR`, the backend with
`OKSOCIAL_SIM_ACCOUNTS=1`, and the test user is a superadmin (only superadmins can create simulated
accounts).

```
E2E_AUTH=<auth cookie of the test user> \
E2E_MEMBER_AUTH=<auth cookie of a 内容运营 member of the same team> \
E2E_SSH="gcloud compute ssh social-ops-1 --zone asia-east2-a --project agentdesk-505102 --command" \
node --test --test-concurrency=1 e2e/*.test.mjs
```
