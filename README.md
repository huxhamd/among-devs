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

`npm run test:browser` runs browser flows against the production build using installed Edge. Set `BROWSER_CHANNEL=chrome` to use installed Chrome instead (PowerShell: `$env:BROWSER_CHANNEL='chrome'`). Tests cover joining, movement, all four mini-tasks, saved task progress after refresh, training, CI repair, voting, and returning to the lobby. `npm run format` formats the source.

## Sprint rules

The office has a fixed, furnished layout: open central circulation, a development pod, a server room with two entrances, a kitchen island and a product planning room. Workstations sit on the room routes, with permanent plants, printers, bookcases, desks, chairs, sofas, whiteboards and counters providing landmarks. Desks, tables, counters and sofas block movement but not sight; bookcases and server racks also cast shadows. Small plants, printers, chairs and whiteboards are passable, as are the existing supply cupboards and access panels. Page exits and all cupboard/panel spawn rules are unchanged.

To adjust the layout, edit the page-local walls, zones and fixture placements in `src/lib/office.ts`. Its fixture catalogue supplies both rendered dimensions and collision properties. Workstation, player-start and candidate spawn coordinates remain in `src/lib/shared.ts`; the server's sprint selection logic is independent of the layout. Reachability tests cover the floor on a 10-unit grid, every interaction point and the ten player starts.

- One maintenance access pair connects either north/south or east/west for the whole sprint, chosen randomly at the start. Each endpoint is picked from two fixed locations, separate from cupboard entrances; there are no central panels or decoys. Everyone can see an active panel from anywhere on its page, independent of light radius and walls; remote door activity is not disclosed. Only the active Tester can press E nearby to travel in either direction. Entry, hidden travel and visible exit each take one second; observation does not prevent entry. Movement and all other actions are blocked throughout, and the Tester cannot see colleagues during travel. Panels start shut, close during transit, and both remain open after travel. There is no sound or additional cooldown. Reconnects preserve travel; a standup interrupts it at the source unless exit has begun, in which case the Tester stays at the destination.
- Each sprint randomly places three supply cupboards on three distinct pages, with two fixed candidate spots per page (including Open Plan). Only the active Tester can use E nearby to enter or leave. Both interactions take one second with the Tester visible and movement locked; being observed does not prevent use. While hidden, their avatar and position are concealed from colleagues, sight radius is halved to 120, and movement and other actions are blocked until exit. Hiding has no time limit. Cupboards start shut, close while occupied, and remain open after exit; they can be reused. Door activity outside a player's sight is withheld. Standups clear occupancy and leave used cupboards open; reconnecting preserves hiding. There are no cupboard sounds or fast-travel links.
- The host starts with 3–10 connected people. A three-second role reveal identifies the one randomly assigned tester and every dev before play begins; the role reminder remains above the play area.
- Devs visit all four office workstations and complete a short mini-task. Every dev's tickets count, including those of people sent on training. Completing every ticket or voting out the tester wins the release.
- The tester can pretend to work, press B anywhere to break CI (with a 45-second cooldown beginning once CI is repaired), and press T to send a nearby colleague on training (30-second cooldown, starting after 25 seconds). Pressing E at the CI Control Console also breaks healthy CI for the tester. During an outage, E opens a shared three-step repair chosen from several coherent incident runbooks, with the available recovery actions shuffled for each breakdown. Any active colleague, including the tester, can contribute at the console; trainees cannot repair. Tickets remain blocked until all three steps are complete. Repair progress is visible to everyone and survives handoffs, standups, and reconnects. Each new outage starts fresh, and repairs never close tickets. Restarting the server in the Server Cupboard is a separate, regular ticket.
- Devs lose when the four-minute work clock expires. With 4–10 people, the tester also wins when only one active dev remains. With three, the tester's direct training action is disabled so one click cannot decide the round.
- WASD or arrow keys move. E opens a nearby task or repairs broken CI at the CI Control Console. Walk through marked edge doorways to switch between five fixed-size office screens: central Open Plan, Development to the north, Server Cupboard to the east, Kitchen to the south, and Product Corner to the west. Everyone starts in an evenly spaced ring around the central standup table, outside immediate interaction range; smaller groups form a symmetric arc around the ring's top-centre axis. The centre also contains CI. Each wing has one workstation; walls and distance still limit player visibility within a page.
- During rounds, desktop browser viewports at least 761px wide and 560px tall fit the whole room, status and CI information without page scrolling. The map preserves its proportions, tickets scroll independently, and action buttons stay below the ticket list. Meetings scroll within the same available space. Narrower or shorter windows use page scrolling with a sticky status/CI block. The welcome screen, lobby and results retain their normal page layout.
- During work, a soft light follows your player within a 240-unit visibility range. Walls and tall furniture block both light and player visibility, casting full shadows while remaining readable against the dimmed map. Low solid furniture casts a partial visual shadow to indicate collision without affecting visibility. Lighting and server sight checks share the same opaque-edge geometry; movement keeps its separate collision buffer. Visible players have small warm glows clipped to your light area that share their existing 250ms fade. Hidden positions are withheld by the server. Training notices stay where they were issued while trainees move privately. Trainees retain their unrestricted view without the light overlay.
- Each person can call one standup at the central table, when CI is healthy. Finding a training notice also allows a standup. Discuss in Teams and vote in the browser within 40 seconds. Votes are final and anonymous to other clients; submission status is visible. Ties, skips and abstentions can keep everyone in. Roles are revealed only at the end.
- Work time and action cooldowns pause during meetings and the three-second result countdown. Usually allow 4–6 minutes per round; many standups can extend a round. All attendees can observe meetings; training attendees cannot vote and should stay quiet on Teams.
- Refreshing reconnects to the same seat within 60 seconds. A disconnected host transfers control to a connected colleague. If someone fails to reconnect during a round, the round is cancelled rather than leaving an unwinnable set of tasks. The host can return everyone to the lobby and start again.

## Container

```sh
docker build -t among-devs .
docker run --rm -p 3000:3000 -e ORIGIN=http://localhost:3000 among-devs
```

The multi-stage image runs checks, tests and the build, then runs as the unprivileged Node user with only production dependencies. On a public hostname, set `ORIGIN` to that exact HTTPS origin, without a trailing slash. Behind Azure's trusted ingress, the Bicep template uses forwarded protocol/host headers instead.

## GitHub Actions (personal environment)

Application CI/CD runs in [GitHub Actions](https://github.com/huxhamd/among-devs/actions). Public images live at `ghcr.io/huxhamd/among-devs`. The retired Azure DevOps definitions in `danhuxham/among-devs` are disabled; this app no longer depends on the shared ACR.

| Workflow                | Behaviour                                                                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build and deploy        | Every branch push and PR to `master` checks, tests, builds and smoke-tests the production container. Only trusted `master` pushes or manual runs publish and deploy. Existing apps receive an image-only update that preserves custom domains; a manual run on `master` recreates a destroyed app. |
| Infrastructure: Preview | Manual Bicep compilation and Azure what-if; no deployment.                                                                                                                                                                 |
| Infrastructure: Health  | Monthly on the first day at 07:00 UTC, or manually. Verifies Azure access, anonymous access to the deployed GHCR digest, and what-if. Does not request or wake the app. Works while torn down.                             |
| Infrastructure: Destroy | Manual on `master`; requires `DESTROY-among-devs`. Removes the application deployment stack's runtime resources.                                                                                                           |

Builds run without Azure access or package-write permission. The privileged deployment job downloads the exact tested image from the same workflow run, publishes it using GitHub's automatic short-lived `GITHUB_TOKEN`, verifies anonymous pulling, then deploys its immutable digest. There is no rebuild between testing and deployment. Image tags identify source commits; Azure uses the digest even if a tag is later republished. Image artifacts expire after one day; re-run the full workflow if its artifact has expired.

Azure login uses OIDC federation with environment `among-devs-play`, restricted to the `master` branch. Deploy, preview, health and destroy jobs share one concurrency group and do not cancel an operation already running. GitHub may replace older pending jobs with newer ones; use the workflow run page to confirm which request executed. No PAT, registry password or Azure client secret is stored in the repository.

The Bicep deployment stack owns a Consumption Container Apps environment and one Container App in `rg-among-devs-uks`. It is applied when the app does not exist. Routine deployments update only the image and preserve ingress settings. Bicep requires the current custom-domain bindings as an explicit parameter for any full resource preview or deployment; omitting them would reset the bindings. The deploy step restores missing or unsecured `among-devs.dev` and `www.among-devs.dev` bindings with Azure managed certificates. DNS must keep the apex A record pointed at the environment IP, the `www` CNAME pointed directly at the generated Container App hostname, and both `asuid` TXT records. Anonymous public image pulls require no runtime managed identity. The existing deployment identity `id-ado-among-devs` is reused (the name is historical), with Contributor access to this app's resource group. The old ADO federation and runtime-identity attachment permission have been removed; deleting ACR removes its scoped role assignments. Persistent identities remain outside the app stack.

The app uses UK South, 0.25 vCPU, 0.5 GiB memory, zero minimum replicas and one maximum replica. Deployment and scale-to-zero lose in-memory games. Deploy between sessions and close connected browsers when finished. Every deployment verifies the page, health endpoint and three WebSocket lobby joins at the Azure hostname, then checks HTTPS, the page and health endpoint at both custom domains. The HTTPS URL is printed in the log.

### One-time setup

An administrator with existing GitHub CLI and personal Azure CLI access runs `scripts/setup-github.ps1`. It uses only `az-play`, checks the personal tenant and subscription, configures the GitHub environment's master-only policy, adds federation to the existing deployment identity, and sets three non-secret environment variables: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and `AZURE_SUBSCRIPTION_ID`. It reads the repository's actual OIDC subject prefix, including immutable IDs where enabled. No recurring administrator login is needed for workflows.

The prerequisite Azure resource group and deployment identity must already exist, with Contributor on `rg-among-devs-uks` and the `Microsoft.App` provider registered. The scripts reject any subscription except `968d16ad-8f5a-4608-aaca-1facd4121402` and tenant `72e6af23-d94b-40db-ad70-1c01042f48c1`.

If a new container package is private after its first publication, open the [package settings](https://github.com/users/huxhamd/packages/container/among-devs/settings) and set visibility to **Public**, then re-run the failed deployment job. This is a one-time package setting. The workflow deliberately stops before changing Azure if anonymous pulling fails.

### Cost, inactivity and teardown

Public GHCR images can be pulled anonymously. GHCR storage and bandwidth are currently free; standard GitHub-hosted Actions runners are free for this public repository. Azure Consumption remains usage-based, with a target of at most £5/month, not an enforced spending cap. No standing-charge registry is required. See [GHCR billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages), [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), and [Azure Container Apps billing](https://learn.microsoft.com/en-us/azure/container-apps/billing).

GitHub automatically disables scheduled workflows in public repositories after 60 days without repository activity. After a long break, enable the Infrastructure workflow if necessary (`gh workflow enable infrastructure.yml`), then run Health or Preview. Build and deploy is a separate workflow with push/manual triggers. No credentials need renewing, but tooling, dependencies and provider policies can still change over time. See [GitHub's inactivity rule](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows).

Use Infrastructure / Destroy when finished and Build and deploy on `master` when needed again. A push to `master` also recreates a destroyed app. Teardown retains the empty app resource group, deployment identity and GHCR images. Keep digests required for rollback when pruning old package versions. The central platform's ACR code is retained with automatic deployment disabled; intentionally restoring it is a separate operation.

### Local infrastructure preview

Use `az-play` locally; never switch the default Azure CLI profile. The default script command is already `az-play`. Preview and Health use the deployed digest, or a non-deployed placeholder when the application is torn down. To preview a different image, set `CONTAINER_IMAGE` to a public `ghcr.io/huxhamd/among-devs@sha256:...` reference.

```powershell
& ./scripts/infra.ps1 -Mode Preview
```

`node scripts/smoke.mjs https://YOUR-APP-HOSTNAME` can be run with Node 24 after `npm ci` to verify a running deployment.

## Scope and tradeoffs

This is a playable prototype. Development has an ordered merge runbook, Product has acceptance-criteria matching, and the Server Cupboard and Kitchen have configuration panels. Each station has two variants, assigned independently per player and sprint, with shuffled controls. Four accepted steps close each ticket; mistakes require correction without erasing accepted work. Progress survives closing the panel, standups, CI outages, and reconnects. Testers can complete the same interactions for cover, without advancing release progress. CI repair has a shared incident board: read the stage clues, then drag a recovery action onto its destination or select the action and destination using clicks or keyboard. Each breakdown chooses one of six coherent three-stage runbooks and shuffles its recovery actions. Accepted stages lock for everyone; incorrect placements give hints without erasing work. Completing the final verification restores CI. Duplicate submissions cannot advance a stage twice, and submissions from earlier incidents are rejected.

The server validates each task instance and step, roles, phases, proximity, movement speed, cooldowns and votes. There is no artificial reading delay or minimum completion time. Only your own role and tasks are sent to your browser. Workspace attempts and actions are rate limited, payload size is capped, and cross-origin browser socket connections are rejected. These limits are lightweight abuse controls, not a public-service security boundary.

For pacing playtests, each tab keeps per-station counters in session storage under `among-devs-task-metrics`: visible, connected task time (`activeMs`), submission attempts, incorrect submissions (`failures`), and completions. Inspect these with browser developer tools; clear that key and refresh to begin a fresh sample. Counters include tester cover tasks and partial attempts, so use completed samples when estimating task duration. The `ci` entry counts time in the repair panel and repairs completed while that panel is open; shared repairs can be counted by multiple tabs. They contain no names, roles or unresolved answers and are never sent to a service. Aim for roughly 10–25 seconds per ticket and 8–15 seconds per repair, then tune after team playtesting.

Lobbies live in memory. A restart, deployment or scale-to-zero loses the session; no database or Redis is needed. Do not increase the replica count without implementing shared session ownership and Socket.IO coordination. Revisions can briefly overlap during deployments, so deploy between sessions.

Private lobby codes control entry, but the Azure endpoint is public and codes are not corporate authentication. Keep codes within the team. UI copy uses office terms, but that does not guarantee acceptance by corporate filtering; use your workplace's approved access process. Original office visuals are drawn in SVG/CSS, with no Among Us assets.

Movement is rendered from a short client-side snapshot buffer for smooth motion while positions and interactions remain server-authoritative. Hidden player coordinates are still discarded immediately.

Suggested next iteration: a few rounds of balancing with your team, then additional task variants based on observed completion times. Mobile controls, accounts, persistent sessions, and built-in audio/video are outside this first version.
