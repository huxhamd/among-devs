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

- The host starts with 3–10 connected people. One randomly assigned tester gets a secret role; everyone else is a dev.
- Devs visit all four office workstations and answer a short task. Every dev's tickets count, including those of people sent on training. Completing every ticket or voting out the tester wins the release.
- The tester can pretend to work, break CI (45-second cooldown), and send a nearby colleague on training (30-second cooldown, starting after 25 seconds). An active colleague must repair CI in the server cupboard before tickets can continue.
- Devs lose when the four-minute work clock expires. With 4–10 people, the tester also wins when only one active dev remains. With three, the tester's direct training action is disabled so one click cannot decide the round.
- WASD or arrow keys move. E opens a nearby task. Doorways connect rooms through the central office.
- During work, active colleagues see only nearby people with an unobstructed line of sight. Hidden positions are withheld by the server. Training notices stay where they were issued while trainees move privately.
- Each person can call one standup at the central table, when CI is healthy. Finding a training notice also allows a standup. Discuss in Teams and vote in the browser within 40 seconds. Votes are final and anonymous to other clients; submission status is visible. Ties, skips and abstentions can keep everyone in. Roles are revealed only at the end.
- Work time and action cooldowns pause during meetings. Usually allow 4–6 minutes per round; many standups can extend a round. All attendees can observe meetings; training attendees cannot vote and should stay quiet on Teams.
- Refreshing reconnects to the same seat within 60 seconds. A disconnected host transfers control to a connected colleague. If someone fails to reconnect during a round, the round is cancelled rather than leaving an unwinnable set of tasks. The host can return everyone to the lobby and start again.

## Container

```sh
docker build -t among-devs .
docker run --rm -p 3000:3000 -e ORIGIN=http://localhost:3000 among-devs
```

The multi-stage image runs checks, tests and the build, then runs as the unprivileged Node user with only production dependencies. On a public hostname, set `ORIGIN` to that exact HTTPS origin, without a trailing slash. Behind Azure's trusted ingress, the Bicep template uses forwarded protocol/host headers instead.

## Azure, with small recurring costs

`infra/main.bicep` provisions a Consumption Container Apps environment and one app with HTTPS ingress, 0.25 vCPU, 0.5 GiB memory, a health probe, single revision mode, and a maximum of **one replica**. Supply your built container image. A private registry is supported through secure deployment parameters; do not commit credentials. Nothing is deployed automatically.

1. Build and push the container to a registry you control (for example, use `az acr build --registry YOUR_REGISTRY --image among-devs:v1 .` with an existing private Azure Container Registry).
2. Create a resource group in your preferred region.
3. Deploy `infra/main.bicep`, supplying `image`, and `registryServer`, `registryUsername`, and the secure `registryPassword` parameter for a private registry. Use a secure parameter source rather than a password in shell history. The template outputs the HTTPS URL.
4. Open the URL before your session. Test joining from your work browser and another colleague's device. For predictable warm sessions, deploy with `minReplicas=1`, then return it to `0` afterwards. Connected browsers should be closed when finished.

Example for an image whose registry does not require authentication:

```sh
az deployment group create --resource-group YOUR_RESOURCE_GROUP --template-file infra/main.bicep --parameters image=YOUR_IMAGE minReplicas=0
```

Azure Container Apps supports WebSockets and consumption scale-to-zero. No resource consumption is charged for an app scaled to zero, but a private registry, logs, networking, and other resources can still incur charges. Actual charges depend on your region, usage and subscription. Set a small Azure budget alert. This template does not provision a registry or a Log Analytics workspace.

Sources: [Azure ingress](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview), [billing](https://learn.microsoft.com/en-us/azure/container-apps/billing), [pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/), [SvelteKit Node adapter](https://svelte.dev/docs/kit/adapter-node).

## Scope and tradeoffs

This is an initial playable prototype. Tasks are intentionally simple multiple-choice interactions; they need team playtesting for difficulty and pacing. The client shows a short reading delay, but this is not an anti-cheat control. The server validates roles, phases, proximity, movement speed, cooldowns and votes. Only your own role and tasks are sent to your browser. Workspace attempts and actions are rate limited, payload size is capped, and cross-origin browser socket connections are rejected. These limits are lightweight abuse controls, not a public-service security boundary.

Lobbies live in memory. A restart, deployment or scale-to-zero loses the session; no database or Redis is needed. Do not increase the replica count without implementing shared session ownership and Socket.IO coordination. Revisions can briefly overlap during deployments, so deploy between sessions.

Private lobby codes control entry, but the Azure endpoint is public and codes are not corporate authentication. Keep codes within the team. UI copy uses office terms, but that does not guarantee acceptance by corporate filtering; use your workplace's approved access process. Original office visuals are drawn in SVG/CSS, with no Among Us assets.

Suggested next iteration: real mini-tasks, better movement interpolation, and a few rounds of balancing with your team. Mobile controls, accounts, persistent sessions, and built-in audio/video are outside this first version.
