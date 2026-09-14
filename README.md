# Among Devs

A private office whodunit for 3–10 colleagues. Built with **Svelte 5, SvelteKit 2, TypeScript and Socket.IO**, served from a single Node.js container. Chrome and Edge desktop are the initial targets. Audio and video stay in your existing Teams call.

## Run locally

Use Node.js 24 LTS:

```sh
npm ci
npm run dev
```

Open http://localhost:5173. Create a workspace and share its six-character code. Use three separate browser tabs with different display names to try a round locally. Each tab stores its own reconnect credential in session storage. Duplicate tabs may copy that credential; use a fresh tab and enter the address manually.

```sh
npm run check
npm test
npm run build
npm start
```

The production server listens on port 3000. `PORT` overrides it. `/healthz` is available in production. SvelteKit and Socket.IO share the same origin and port, including during development. There are no external fonts, analytics, voice services or image requests.

`npm run test:browser` runs the three-person browser flow against the production build using installed Edge. Set `BROWSER_CHANNEL=chrome` to use installed Chrome instead (PowerShell: `$env:BROWSER_CHANNEL='chrome'`). The browser test covers joining, movement, refresh/reconnect, voting, and returning to the lobby. `npm run format` formats the source.

## Sprint rules

- The host starts with 3–10 connected people. A three-second role reveal identifies the one randomly assigned tester and every dev before play begins; the role reminder remains above the play area.
- Devs visit all four office workstations and answer a short task. Every dev's tickets count, including those of people sent on training. Completing every ticket or voting out the tester wins the release.
- The tester can pretend to work, press B anywhere to break CI (45-second cooldown), and press T to send a nearby colleague on training (30-second cooldown, starting after 25 seconds). Pressing E at the CI Control Console also breaks CI for the tester. An active colleague must press E at that console at the top of the central office to repair CI before tickets can continue. Restarting the server in the Server Cupboard is a separate, regular ticket.
- Devs lose when the four-minute work clock expires. With 4–10 people, the tester also wins when only one active dev remains. With three, the tester's direct training action is disabled so one click cannot decide the round.
- WASD or arrow keys move. E opens a nearby task or repairs broken CI at the CI Control Console. Doorways connect rooms through the central office.
- During work, active colleagues see only nearby people with an unobstructed line of sight. Hidden positions are withheld by the server. Training notices stay where they were issued while trainees move privately.
- Each person can call one standup at the central table, when CI is healthy. Finding a training notice also allows a standup. Discuss in Teams and vote in the browser within 40 seconds. Votes are final and anonymous to other clients; submission status is visible. Ties, skips and abstentions can keep everyone in. Roles are revealed only at the end.
- Work time and action cooldowns pause during meetings and the three-second result countdown. Usually allow 4–6 minutes per round; many standups can extend a round. All attendees can observe meetings; training attendees cannot vote and should stay quiet on Teams.
- Refreshing reconnects to the same seat within 60 seconds. A disconnected host transfers control to a connected colleague. If someone fails to reconnect during a round, the round is cancelled rather than leaving an unwinnable set of tasks. The host can return everyone to the lobby and start again.

## Container

```sh
docker build -t among-devs .
docker run --rm -p 3000:3000 -e ORIGIN=http://localhost:3000 among-devs
```

The multi-stage image runs checks, tests and the build, then runs as the unprivileged Node user with only production dependencies. On a public hostname, set `ORIGIN` to that exact HTTPS origin, without a trailing slash. Behind Azure's trusted ingress, the Bicep template uses forwarded protocol/host headers instead.

## Azure pipelines (personal environment)

The app stays in GitHub at `huxhamd/among-devs`. Azure DevOps project `danhuxham/among-devs` runs these pipelines:

| Pipeline                | YAML                           | Behaviour                                                                                                                                                            |
| ----------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build and deploy        | `azure-pipelines.yml`          | Every branch push and PR to `master` checks, tests, builds and smoke-tests the container. Only `master` deploys. Run manually on `master` to stand the app up again. |
| Validate infrastructure | `azure-pipelines.validate.yml` | Manual Bicep compilation and Azure what-if; does not deploy.                                                                                                         |
| Destroy                 | `azure-pipelines.destroy.yml`  | Manual; requires `DESTROY-among-devs` and runs from `master`.                                                                                                        |
| Monthly health          | `azure-pipelines.health.yml`   | First day of each month at 07:00 UTC, or manually. Checks Azure access, the registry, and what-if. Works while the app is torn down.                                 |

The application infrastructure in `infra/main.bicep` follows the platform Container App template while using pre-provisioned identities. This keeps pipeline permissions scoped to this application's resource group and avoids giving a pipeline permission to assign Azure roles. The orchestration supports `master`, Node 24, and the custom Socket.IO entry point. The existing Dockerfile runs checks and tests, builds both `build/` and `dist/`, and runs `dist/server.js` as the unprivileged Node user. The deployment loads the exact image tested by the build stage; it does not rebuild it.

The application deployment stack owns a Consumption Container Apps environment and one Container App in `rg-among-devs-uks`. Persistent identity `id-runtime-among-devs` has `AcrPull` on the existing shared registry `acrplayobbyonpr53zda`; deployment identity `id-ado-among-devs` has `Contributor` only on the app resource group, `AcrPush` and `Reader` only on the registry, and `Managed Identity Operator` only on the runtime identity. There are no registry passwords, database, or saved Log Analytics logs. Destruction removes the app runtime resources while retaining the empty resource group, identities, registry, and pushed images. No shared infrastructure changes are required.

The app uses UK South, 0.25 vCPU, 0.5 GiB memory, a minimum of zero replicas and a maximum of one. Deployments and scale-to-zero lose in-memory games. Deploy between sessions, and close connected browsers when finished. Each deployment verifies the page, `/healthz`, and three WebSocket lobby joins; the HTTPS URL is printed in the deployment log. The monthly health pipeline makes no request to the application and never deploys it.

### One-time Azure DevOps setup

- Connect GitHub repository `huxhamd/among-devs` using the authorized GitHub service connection `github.com_huxhamd` and create the four pipeline definitions above, with default branch `refs/heads/master`.
- Create workload-federated ARM service connection `sc-play-among-devs` targeting personal tenant `72e6af23-d94b-40db-ad70-1c01042f48c1`, subscription `968d16ad-8f5a-4608-aaca-1facd4121402`. The scripts refuse any other tenant or subscription.
- Grant its identity `Contributor` on `rg-among-devs-uks`, `AcrPush` and `Reader` on the shared registry, and `Managed Identity Operator` on `id-runtime-among-devs`. `Reader` lets the pipeline verify the registry login server and disabled admin account; `Managed Identity Operator` lets it attach only that runtime identity to the app. The pipeline does not receive subscription-wide access or permission to manage Azure roles. Keep the ACR admin account disabled. Authorize only these four pipelines to use the connection.
- Register the `Microsoft.App` resource provider in the personal subscription once.
- Create environment `among-devs-play`, authorize the build/deploy and destroy pipelines, and add an **Exclusive lock** check. Both YAML files request sequential locking so teardown and deployment cannot run concurrently.
- Confirm Microsoft-hosted Linux agent capacity is available. Keep fork builds from receiving secrets or privileged pipeline access. Set short run retention to avoid retaining unnecessary image artifacts.

### Cost and teardown

The target is at most £5/month of additional usage, excluding the already-deployed shared registry. Consumption has a subscription-wide free allowance; a zero-replica app incurs no compute consumption charge. This is a usage-based service, so £5 is a target, not an enforced spending cap. See [Azure Container Apps billing](https://learn.microsoft.com/en-us/azure/container-apps/billing).

Use **Destroy** when finished and **Build and deploy** on `master` when needed again. A later push to `master` also recreates a destroyed app. Image tags are commit SHAs and remain in the shared registry after teardown; prune obsolete `among-devs` images if storage accumulates, keeping images needed for rollback. A budget alert can notify you about spend, but does not stop resources automatically.

### Local infrastructure preview

Use `az-play` locally; never switch the default Azure CLI profile. In Azure Pipelines, `AzureCLI@2` supplies an isolated service-connection login and the same script verifies its tenant and subscription.

```powershell
$env:IMAGE_TAG = git rev-parse HEAD
& .\scripts\infra.ps1 -Mode Preview
```

`node scripts/smoke.mjs https://YOUR-APP-HOSTNAME` can also be run with Node 24 after `npm ci` to verify a running deployment.

## Scope and tradeoffs

This is an initial playable prototype. Tasks are intentionally simple multiple-choice interactions; they need team playtesting for difficulty and pacing. The client shows a short reading delay, but this is not an anti-cheat control. The server validates roles, phases, proximity, movement speed, cooldowns and votes. Only your own role and tasks are sent to your browser. Workspace attempts and actions are rate limited, payload size is capped, and cross-origin browser socket connections are rejected. These limits are lightweight abuse controls, not a public-service security boundary.

Lobbies live in memory. A restart, deployment or scale-to-zero loses the session; no database or Redis is needed. Do not increase the replica count without implementing shared session ownership and Socket.IO coordination. Revisions can briefly overlap during deployments, so deploy between sessions.

Private lobby codes control entry, but the Azure endpoint is public and codes are not corporate authentication. Keep codes within the team. UI copy uses office terms, but that does not guarantee acceptance by corporate filtering; use your workplace's approved access process. Original office visuals are drawn in SVG/CSS, with no Among Us assets.

Suggested next iteration: real mini-tasks, better movement interpolation, and a few rounds of balancing with your team. Mobile controls, accounts, persistent sessions, and built-in audio/video are outside this first version.
