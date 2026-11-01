# EVER platform: world changes, editions, deploys

Owner: Platform engineer. Design: `docs/GDD_V2.md` sections 14 (Last Page, world changes), 16 (versions), 17.7 and 17.8 (co-op decision, bot limits). Mechanics validator: `docs/MECHANICS.md`.
License: AGPL-3.0-or-later. Every world change merged by the bot is a contribution under that license (GDD_V2 14.7).

This doc has the setup steps the CEO runs once (sections 2 to 5), how the pipeline works (sections 1, 3, 6 and 7), how to roll back (section 8), and what other departments still need to wire up (section 9).

```
 winning book (solo client, or the co-op room)
        │  POST /world/proposals  {v, kind, data, run}
        ▼
 Worker ever-rooms ── WorldBot Durable Object (one, global)
        │  re-validate: world schema + text rules + mechanics validator + balance sim
        │  limits: 3/IP/day, 3/room/day, 1 per win, 30 PRs/day, 10/hour, 1 code block/week
        │  dedupe by content key; queue; ONE open bot PR at a time
        ▼  GitHub App "ever-world-bot" (installation token, REST + GraphQL)
 PR on nircaf/ever  (world/<kind>/<slug>-<key>.json + world/manifest.json,
        │            or game/src/mechanics/blocks/<name>.js + blocks/index.js)
        ▼  workflow "ever-check" (required): path allowlist, size caps, sandbox checker,
        │  world schema + hashes + 200-fight balance sim, npm test, build, bundle budget
        ▼  GitHub auto-merge (squash) when green
 main ──► Cloudflare Pages rebuilds game.dreamz.rest (new edition for NEW books)
      └─► deploy-worker workflow (only when server or rules code changed)
```

---

## 1. Files

| Path | What |
|---|---|
| `world/manifest.json` | Edition number, every world file with its hash and `since` edition, world names, the ledger (last 20 changes). About 1 KB now. |
| `world/{cards,items,lines,npcs,places,paths,presets}/*.json` | One world entry per file, named `<slug>-<content key>.json`. Edition 1 has 8 studio presets (one per theme). |
| `game/src/platform/world-schema.js` | World entry and proposal schema, text sanitizing, titles, content keys, `blocks/index.js` editing. Pure; used by the browser, the Worker and CI. |
| `game/src/platform/world-manifest.js` | Manifest checks, `addToManifest`, `filesForEdition`, hashes (SHA-256 via WebCrypto). |
| `game/src/platform/world-loader.js` | Browser loader: manifest, edition pinning, hash-checked fetch, local snapshots, `resolveWorld`, `linesFor`, `presetsFor`. |
| `game/src/platform/version.js` | `ENGINE_VERSION`, `pinFor`, `checkPin`, `createVersionWatcher`, `installChunkErrorGuard`, `prefetchChunks`, GDD_V2 19 version copy. |
| `game/src/platform/bot-client.js` | Browser client for the bot endpoint plus the Last Page status lines. |
| `game/src/platform/index.js` | Public API (import from here). |
| `game/src/platform/tools/*.mjs` | Node-only tools: `check-world`, `pr-guard`, `world-add`, `bundle-report`, `vite-world` (Vite plugin), `world-fs`. |
| `server/src/world-bot-core.js` | Every bot decision (validation, limits, dedupe, queue, PR building), with no Workers APIs. |
| `server/src/world-bot.js` | `WorldBot` Durable Object shell (storage, alarm), `submitFromRoom` for co-op. |
| `server/src/world-route.js` | Public route `POST /world/proposals`, `GET /world/proposals/<id>`. |
| `server/src/github.js` | GitHub App JWT (RS256, PKCS#1 keys accepted), installation token, the REST calls. |
| `.github/workflows/ever-check.yml` | Required check for every PR and push to main. |
| `.github/workflows/world-auto-merge.yml` | Turns on auto-merge for bot PRs (a fallback; the bot does it too). |
| `.github/workflows/deploy-worker.yml` | `wrangler deploy` of the Worker, off until enabled. |
| `.github/CODEOWNERS` | Optional hardening (section 4.3). |
| `game/static/_headers` | Cache and security headers for Pages. |
| Tests | `game/src/platform/platform.test.js` (20), `server/test/world-bot.test.js` (33, mocked GitHub in `server/test/fake-github.js`). |

npm scripts: `npm run check:world`, `npm run check:blocks`, `npm run world:add -- <draft.json>`, `npm run bundle:report` (after `npm run build`).

---

## 2. One-time setup: the GitHub App

The App is the only identity that writes to the repo. Players never need GitHub accounts.

1. Go to <https://github.com/settings/apps/new> (the repo belongs to the personal account `nircaf`, so the App is created there).
2. Fill in:
   - **GitHub App name**: `ever-world-bot`. Its bot login becomes `ever-world-bot[bot]`. If you pick another name, use its slug everywhere below.
   - **Homepage URL**: `https://game.dreamz.rest`
   - **Webhook**: clear **Active**. The bot polls; it needs no webhook.
   - **Repository permissions**:
     - **Contents: Read and write** (branch and commit)
     - **Pull requests: Read and write** (open, label, close, enable auto-merge)
     - **Metadata: Read-only** (always required)
     - Everything else stays **No access**. In particular, do not grant **Workflows**: without it GitHub itself refuses any bot commit that touches `.github/workflows/`.
   - **Where can this GitHub App be installed?**: **Only on this account**.
3. Click **Create GitHub App**. Write down the **App ID** at the top of the page.
4. On the same page, under **Private keys**, click **Generate a private key**. A `.pem` file downloads. Keep it secret; it goes only into the Worker secret store (step 3.2).
5. In the left menu, click **Install App**, then **Install** next to `nircaf`. Choose **Only select repositories**, pick `nircaf/ever`, and click **Install**.
6. The browser now shows `https://github.com/settings/installations/<NUMBER>`. That number is the **installation ID**.

---

## 3. One-time setup: the Worker (rooms + world bot)

The bot lives in the existing Worker `ever-rooms` (`server/`), as a second Durable Object class `WorldBot` (migration `v2` in `server/wrangler.toml`).

### 3.1 Plan

The bot re-runs the balance sim on every submission. That takes about 20 to 70 ms of CPU, which is over the Workers Free limit of 10 ms per request. Use **Workers Paid**. Rooms are unaffected either way.

### 3.2 Secrets (never in git)

Run from the repo root, logged in with `npx wrangler login`:

```bash
npx wrangler secret put GH_APP_ID              --config server/wrangler.toml   # paste the App ID
npx wrangler secret put GH_APP_INSTALLATION_ID --config server/wrangler.toml   # paste the installation ID
npx wrangler secret put GH_APP_PRIVATE_KEY     --config server/wrangler.toml < ~/Downloads/ever-world-bot.*.private-key.pem
openssl rand -hex 32 | npx wrangler secret put BOT_IP_SALT --config server/wrangler.toml
```

The private key can be the PKCS#1 file exactly as GitHub gives it. `server/src/github.js` converts it.

### 3.3 Vars and routes (`server/wrangler.toml`)

- `WORLD_BOT_ENABLED = "true"` turns the bot on. It ships `"false"`, so the endpoint answers `503 {status: 'offline'}` until you flip it.
- `GH_OWNER = "nircaf"`, `GH_REPO = "ever"`, `GH_BASE = "main"`.
- `WORLD_REQUIRE_REPLAY = "false"`. See 3.4.
- Uncomment the `routes` block. It has both `game.dreamz.rest/room/*` and `game.dreamz.rest/world/proposals*`. The static `world/manifest.json` and `world/f/*` stay on Pages; only `/world/proposals*` goes to the Worker.

Then deploy: `npx wrangler deploy --config server/wrangler.toml`, or let the workflow do it (section 5.3). The first deploy runs migration `v2` and creates the `WorldBot` class.

### 3.4 The endpoint

`POST /world/proposals` with `content-type: application/json` and a body of at most 16 KB:

```jsonc
{"v": 1, "kind": "card",              // card | item | line | npc | place | path | block
 "preset": "forge-banked-hammer",     // only for offline presets (must equal the authored preset)
 "data": {"def": {...mechanics card def...}},  // see section 7 for each kind
 "run": {"seed": "KQ7FM2XB", "edition": 1, "engine": "0.3.0+abc1234", "bookNo": 4,
         "pages": 9, "themes": ["forge", "crow", "ash"], "won": true,
         "log": {...}}}               // replay proof for solo wins (verifier pluggable)
```

Replies are always `{status, ...}`:

| HTTP | status | When |
|---|---|---|
| 202 | `queued` (+`position`) or `open` (+`pr`) | Accepted. `GET /world/proposals/<id>` follows it: `queued` → `open` → `merged` (+`edition`) or `rejected` (+`reason`). |
| 400 | `rejected` | Invalid (`errors[]`, at most 12, each `{code, path, msg}`), missing proof, or an edited preset. |
| 403 | `rejected` | Origin not allowed, or a client claiming a room (co-op wins go server to server). |
| 409 | `duplicate` | Same content already in the world or waiting, or this win was already used. |
| 413 / 415 | `rejected` | Body too large, or not JSON. |
| 429 | `rate` | `error`: `ip`, `room`, `busy` (queue of 40 full), `block_week`. |
| 503 | `offline` | Bot disabled or not configured, or GitHub unreachable. |

`bot-client.js` maps these to the GDD_V2 19 lines ("Waiting in line.", "Ashbrook remembers. Edition {E} is out.", ...).

**What the bot checks** (in `WorldBotCore.submit`), in order: IP limit and queue length (cheap, first); the current `main` (manifest, block files; cached for 2 minutes); `validateProposal` (world schema, GDD_V2 20 text rules and blocklist, unique names, mechanics `validateContent` with `offer: 'global'` and a 24-fight balance sim, or the static sandbox checker for code); room rules; replay proof; preset match; the one-block-a-week rule; dedupe by content key. Then it queues the proposal and calls `tick()`.

**What `tick()` does** (on submit, and on a Durable Object alarm every 2 minutes while there is work): it follows the open bot PR. Merged → `merged`. Closed → `rejected`. Still open after 60 minutes (checks failed) → closed with a comment, branch deleted, `rejected`. When no bot PR is open and the hourly and daily caps allow it, it builds the next PR on top of the **current** `main`: the entry file plus the manifest with `edition + 1`, or the block plus `blocks/index.js`. Then it opens the PR (labels `world-change` and `world-data` or `world-code`), and turns on auto-merge through GraphQL as the App. GitHub 5xx errors are retried up to 5 times; 4xx errors reject the proposal.

**Replay proof (GDD_V2 17.8).** `WorldBotCore` takes a `verifyRun(run, proposal)` function. Systems owns the v2 book action log and the replay. When the verifier exists, pass it in `server/src/world-bot.js` and set `WORLD_REQUIRE_REPLAY = "true"`. Until then, solo wins are trusted and only rate-limited. This is an accepted risk. Every PR still passes the same validation and CI gates.

**Co-op (Network).** The room calls `submitFromRoom(env, proposal, roomCode)` from `server/src/world-bot.js`, with `proposal.run.room = roomCode` and a unique `proposal.run.winId` per win. Clients cannot pass `source: 'room'`: the public route always forwards `source: 'client'`.

### 3.5 Local development

`npm run rooms` serves the bot routes too. Without secrets the bot answers `503 offline`. To try it against a **fork**, create `server/.dev.vars` (git-ignored) with `GH_APP_ID=...`, `GH_APP_INSTALLATION_ID=...`, `GH_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"`, `GH_OWNER=<you>`, `GH_REPO=<fork>`, `WORLD_BOT_ENABLED=true`. Tests never touch GitHub: `npx vitest run server/test/world-bot.test.js`.

---

## 4. One-time setup: the repository

### 4.1 Settings, General

- **Pull Requests**: tick **Allow auto-merge**, **Allow squash merging** and **Automatically delete head branches**.

### 4.2 Branch protection for `main`

Use **Settings, Rules, Rulesets, New branch ruleset**:

- Name `main`, Enforcement **Active**, Target **Include default branch**.
- **Bypass list**: add **Repository admin**, so you can still push directly.
- Rules:
  - **Restrict deletions** and **Block force pushes**.
  - **Require a pull request before merging**, with **Required approvals: 0**.
  - **Require status checks to pass**. Click **Add checks**, type `ever-check` and pick the GitHub Actions one. Leave **Require branches to be up to date before merging** off: the bot builds each PR on the newest `main` and opens only one at a time, and a manifest conflict still blocks the merge.

The classic **Branch protection rules** page works too. Use the same choices: require a pull request, require the status check `ever-check`, and do not require branches to be up to date.

The `ever-check` check exists only after the workflow has run once. Push the workflows first, or open any PR, then add the check.

### 4.3 Optional hardening: code owners

`.github/CODEOWNERS` gives every path to `@nircaf`, except `world/` and `game/src/mechanics/blocks/`. In the ruleset, under the pull request rule, tick **Require review from Code Owners**. After that, a bot PR that touches anything outside its allowlist cannot auto-merge, even if a workflow file were changed in the same PR. This is a third gate, after the bot itself and `pr-guard`. Your own PRs then need your review, or the admin bypass.

### 4.4 Actions variables and secrets

Go to **Settings, Secrets and variables, Actions**.

- **Variables**:
  - `EVER_BOT_LOGIN` = `ever-world-bot[bot]`. It marks bot PRs for the stricter checks and the auto-merge fallback. Branches named `world/...` also get the bot rules.
  - `EVER_DEPLOY_WORKER` = `true`, once you want pushes to deploy the Worker (section 5.3).
- **Secrets** (for deploy-worker only): `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- Under **Settings, Actions, General, Workflow permissions**, keep **Read repository contents** as the default. Each workflow declares the permissions it needs.

### 4.5 What `ever-check` runs

The order matters: no PR code runs before the static checks.

1. `npm ci --ignore-scripts`, so no install scripts run.
2. Bot or human? A PR is a bot PR when its author is `EVER_BOT_LOGIN` or its branch starts with `world/`.
3. `pr-guard.mjs --base --head [--bot]`. A bot PR may only **add** `world/<folder>/*.json` and modify `world/manifest.json`, or **add** one `game/src/mechanics/blocks/*.js` and modify `blocks/index.js` without removing lines. Never both. At most 3 files, 8 KB of data and 120 lines of code. Human PRs only get notes.
4. `check-blocks.mjs`: the static sandbox checker on every block.
5. `check-world.mjs --base <base> --fights 200 [--bot]`. It checks the manifest shape, that every file is listed and present, that hashes and bytes match, the canonical form, that the path matches the content key, unique names and valid presets. Changed cards, items and presets get the full 200-fight sim in the global band (0 to +6 win points). For a bot PR they must also be run-made (`origin.src` is not `studio`, no keepsakes).
6. `npm test` (all unit tests, including the sandbox escape list, plus the bridge smoke test).
7. `npm run build`. It fails if a world hash is wrong.
8. `bundle-report.mjs public --budget-kb 300`. It fails if the first load goes over 300 KB gzip.

---

## 5. One-time setup: Cloudflare (site, domain, Worker deploy)

### 5.1 Cloudflare Pages (the static game)

1. In the Cloudflare dashboard, go to **Workers & Pages, Create, Pages, Connect to Git** and pick `nircaf/ever`.
2. Production branch `main`. Framework preset **None**. Build command `npm run build`. Build output directory `public`. Root directory empty (repo root).
3. **Environment variables** (Production and Preview): `NODE_VERSION` = `22`.
4. Optional: under **Settings, Builds, Branch control**, set preview branches to **None**, or exclude `world/*`, so bot branches do not each start a preview build.
5. Save and deploy. Every merge to `main`, including bot merges, rebuilds the site. `CF_PAGES_COMMIT_SHA` goes into the engine version.

### 5.2 DNS and the custom domain `game.dreamz.rest`

1. In the Pages project, open **Custom domains, Set up a custom domain**, type `game.dreamz.rest` and continue.
2. If the `dreamz.rest` zone is on Cloudflare, Pages creates the record (`CNAME game → <project>.pages.dev`, proxied). If DNS is elsewhere, create that CNAME at your DNS host. Worker routes, though, need the zone on Cloudflare, so moving the zone there is strongly recommended.
3. Wait for **Active**. Then deploy the Worker with the routes from 3.3. Worker routes run in front of Pages on the same hostname, so `/room/*` and `/world/proposals*` go to the Worker and everything else to Pages.

### 5.3 Worker deploys

- **By hand**: `npx wrangler deploy --config server/wrangler.toml`.
- **By CI**: `.github/workflows/deploy-worker.yml` runs on pushes to `main` that touch `server/**`, the shared rules, `game/src/mechanics/**`, `game/src/platform/**` or `vendor/`, or on demand (**Actions, deploy-worker, Run workflow**). It runs only when the variable `EVER_DEPLOY_WORKER` is `true`. It needs `CLOUDFLARE_API_TOKEN`, created from the **Edit Cloudflare Workers** template and scoped to your account and the `dreamz.rest` zone, and `CLOUDFLARE_ACCOUNT_ID`. It uses the GitHub environment `production`; you can add required reviewers there.
- Code-block merges change `game/src/mechanics/blocks/`, so the Worker redeploys and the room's validator learns the new block. That works because the bot turns on auto-merge **as the App**. A merge made through `GITHUB_TOKEN`, which is what the fallback workflow uses, does not start other workflows. If the deploy did not run, start deploy-worker by hand.

---

## 6. Versions, caching and load time

### 6.1 Engine version and world edition

- **Engine version**: `'<package.json version>+<7-char commit>'`, baked in by the Vite plugin as `__EVER_ENGINE__` and read through `ENGINE_VERSION`. Bump the **major** of `package.json` only when saved books cannot continue on new code. `checkPin` then closes them as "unfinished" (GDD_V2 16 copy).
- **World edition**: `world/manifest.json.edition`. Every bot merge adds 1. The world only grows, so **edition E is exactly the files with `since <= E`**. The latest deploy therefore still serves every older edition, and a book pinned to E loads the same world forever. A rollback (section 8) is a new, higher edition.
- **Pinning**: a new book stores `pinFor({edition})`, which is `{engine, edition}`. It loads `loader.load({edition})`. On reload, `checkPin(pin, {latestEdition})` returns one of three states: `current`; `older_edition` (play on, with the "This book began in edition {E}..." line); or `unavailable` (a different engine major, or a missing edition). The loader keeps each loaded edition in `localStorage` (`ever.v2.world.e<E>`, the last 3), so a reload mid-book needs no network.
- **New edition while playing**: `createVersionWatcher({current, onChange})` polls `version.json` (`{engine, edition, built}`, about 70 bytes, no-cache) every 10 minutes and whenever the tab becomes visible. It reports a change once: "Ashbrook has changed. New books will see edition {E}." It never reloads anything.
- **Redeploy while a tab is open**: hashed chunks from the old deploy disappear. `installChunkErrorGuard` catches Vite's `vite:preloadError`, so the UI can offer a reload (the book is saved). `prefetchChunks([...loaders])` loads the lazy chunks while idle, so a long session rarely needs a chunk later.

### 6.2 What the build ships (`game/src/platform/tools/vite-world.mjs`)

| URL | Content | Cache-Control (`game/static/_headers`) |
|---|---|---|
| `/`, `/index.html` | page shell | `no-cache` |
| `/assets/*` | hashed JS/CSS chunks | `public, max-age=31536000, immutable` |
| `/world/f/<hash>.json` | each world file, addressed by the first 16 hex of its SHA-256 (the loader checks it) | `public, max-age=31536000, immutable` |
| `/world/manifest.json` | the manifest | `public, max-age=60, must-revalidate` |
| `/version.json` | `{engine, edition, built}` | `no-cache` |

`vite dev` and `vite preview` serve the same URLs from `world/`. `bridge.mjs` serves them from `public/` (JSON is in its MIME table).

### 6.3 Code splitting and measured sizes

`vite.config.js` now puts `three` in its own chunk. The card engine (vendored Slay the Web including its 22 card files, immer, `combat/rules`, `mechanics`) goes in one `engine` chunk. The game code stays in `index`. A typical redeploy changes only the `index` chunk, so returning players download about 55 KB gzip instead of about 210 KB. Startup went from 26 JS requests to 3.

Measured with `node game/src/platform/tools/bundle-report.mjs <out> --sources` (Vite 7, gzip level 9):

| | Before | After |
|---|---|---|
| First load JS + CSS + HTML, gzip | 216.5 KB (755 KB raw) | 217.9 KB (763 KB raw) |
| JS requests at startup | 26 (1 entry + contracts + 22 tiny card chunks + 2 lazy) | 3 (`three` 124.8 KB gz, `index` 54.7 KB gz, `engine` 30.2 KB gz) |
| Re-download after a typical game-code deploy | about 210 KB gz (one big chunk) | about 55 KB gz (`index` only) |
| Lazy chunks | 24 | 2 (`net/client` 3.6 KB gz, `net/combat-driver` 0.7 KB gz) |
| World data | – | manifest 1.2 KB, 8 files 4.8 KB total, `version.json` 0.07 KB |

With the other departments' v2 work in progress (Systems run screens, content generator, AI moments), the same split measured **258.4 KB gzip** on 2026-10-31: `three` 125.1, `index` 82.5, `engine` 42.5, CSS 6.9, HTML 1.3. Lazy chunks were 4.3 KB.

By source, unminified, first load: `three` 1284 KB (most of it is the WebGL renderer, which the first frame needs), `core` 135 KB, `mechanics` 92 KB, `world` 86 KB, `combat` 64 KB, `shared` 63 KB, Slay the Web 56 KB, immer 37 KB.

The next real cut in first-load bytes needs `main.js` (Systems) to load the combat UI and engine with `import()` when the first fight starts, about 40 KB gz. The v2 run screens should also be loaded with `import()` when a book opens, and the world loader on the cover. `three` cannot be deferred, because the cover draws the village. CI fails at 300 KB gzip; tighten it once the lazy loading lands.

---

## 7. World data format

All files are pretty-printed with tabs and end with a newline (`serializeEntry`). Each file is named `<slug>-<content key>.json`. The content key is the first 8 hex of the SHA-256 of the entry without `origin`, so two runs that propose the same thing collide. Unknown fields fail CI, because the file must already be in canonical form.

```jsonc
{"v": 1, "type": "card",  "origin": {"src": "ai", "book": 4, "edition": 1, "seed": "KQ7FM2XB", "at": "2026-11-02"},
 "def": { /* canonical mechanics def, validated with offer 'global' */ }}
{"v": 1, "type": "item",  "origin": {...}, "def": {...}}
{"v": 1, "type": "line",  "origin": {...}, "npc": "marcus" | "keeper" | "wayfarer" | "npc:<id>",
 "when": {"theme"?: "forge", "trust"?: "cold|wary|guarded|warm|trusting", "echo"?: true}, "text": "≤140 chars, ≤3 sentences"}
{"v": 1, "type": "npc",   "origin": {...}, "id": "pell", "name": "Pell the Tinker", "archetype": "wayfarer" | "keeper",
 "look": {"cloak": <palette key>, "accent": <palette key>, "prop": <ART_PROPS>}, "bias": "card|item|token|handItem|bodyItem|charmItem",
 "openings": {"forge": "line", ...}}
{"v": 1, "type": "place", "origin": {...}, "anchor": <ANCHORS>, "prop": "cairn|lantern|briar|carvedStone|signpost|bench|wildflowers",
 "inscription"?: "≤40 chars (cairn, carved stone, signpost only)"}
{"v": 1, "type": "path",  "origin": {...}, "theme": "briar", "titles": ["The Wood Leans In", ...]}   // 2-6 titles
{"v": 1, "type": "preset","origin": {"src": "studio"}, "id": "forge-banked-hammer", "themes": ["forge"],
 "proposal": {"kind": "card", "data": {"def": {...}}}}                                               // studio only, never code
```

The anchors are `well`, `forgeDoor`, `lecternTree`, `roadFire`, `cart`, `keeperBench`, `gatePillarWest`, `gatePillarEast`, `shrinePath`, `southSignpost`, `eastMeadow` and `westWoodEdge`. Rules text, titles and PR descriptions are rendered from data (`entryTitle`, `entrySummary`, mechanics `rulesText`). Model text survives only as sanitized names, flavor, lines and inscriptions.

`origin.src` is one of three values: `ai` (a run's AI proposal), `preset` (a run picked an offline preset; `origin.preset` names it, and that preset then leaves the Last Page), or `studio` (hand-made with `world-add`).

**Studio changes**: write draft entries, then run `npm run world:add -- drafts.json --at 2026-11-05`. All drafts land in one new edition; cards, items and presets get the 200-fight sim. After a hand edit, run `world-add.mjs --rehash` and `npm run check:world`. Studio commits go through a normal PR, and `ever-check` validates them.

**Kind 7 (code blocks)**: `{"kind": "block", "data": {"file": "kebab-name.js", "source": "..."}}`. The source starts with a comment header that carries `SPDX-License-Identifier: AGPL-3.0-or-later`, passes `checkBlockSource`, has at most 120 lines, a new `id` and a new file name. The bot accepts at most one a week, and never from a preset.

---

## 8. Rollback

| What went wrong | Do this |
|---|---|
| A bad world change merged | Roll **forward**: `node game/src/platform/tools/world-add.mjs --remove cards/<file>.json`, then commit through a PR. The file is deleted, the edition goes **up** by one, the name is freed, and its content key goes into `manifest.retired`, so the bot refuses it from then on. Books pinned to older editions keep it from their local snapshot. Do not `git revert` the bot commit: that moves the edition backwards, and books pinned to the newer edition would close as "unfinished". |
| A bad code block merged | Revert the PR (`git revert <sha>`, through a PR), then redeploy the Worker. Books holding content that uses the block lose those defs on load (`parseRunContent` drops them with a reason). |
| A bad site deploy | Cloudflare dashboard: **Workers & Pages, ever, Deployments**, pick the last good one, then **⋯ Rollback to this deployment**. Old world files stay addressable, because the world only grows. |
| A bad Worker deploy | `npx wrangler deployments list --config server/wrangler.toml`, then `npx wrangler rollback <version-id> --config server/wrangler.toml`. |
| Stop the bot now | Any one of these: set `WORLD_BOT_ENABLED = "false"` and redeploy the Worker (the endpoint answers `offline`); **suspend** the App installation (GitHub, Settings, Applications, ever-world-bot, Configure, Suspend); untick **Allow auto-merge** (PRs then wait for you); or delete the App's private key. |
| Bot PRs keep failing checks | Each one closes itself after 60 minutes and the queue moves on. Read the `ever-check` log on the closed PR. |

---

## 9. Hand-offs (what other departments wire up)

- **Systems** (`core/`, `main.js`):
  - At a new book, call `createWorldLoader().load()`, store `pinFor({edition: w.edition})` in the book, and add world cards and items to offers through `addContent(rc, def, {offer: 'global', src: 'world'})`. Use `world.lines` with `linesFor`, and `world.paths` for Contents titles.
  - On reload, call `checkPin` and then `load({edition: pin.edition})`.
  - The cover shows `manifest().edition` and `.ledger`.
  - For the Last Page, use `presetsFor(world, themes, {rand: seeded})`, `proposalFromPreset`, `createWorldBotClient().submit/status` and `statusLine`, plus the consent text (GDD_V2 14.7).
  - Wire `createVersionWatcher`, `installChunkErrorGuard` and `prefetchChunks` in `main.js`.
  - Load the combat engine with `import()`.
  - Provide the replay verifier (3.4).
- **Network** (`server/`): call `submitFromRoom` after a party vote, with `run.room` and `run.winId`. Relay the status to the room. Pin the room's edition (GDD_V2 17.1).
- **World / Art**: place props at `ANCHORS` from `world.places`, which already resolves "newest wins per anchor". NPC looks come from `ART_TINTS` and `ART_PROPS`.
- **Creative Director**: 16 more presets (GDD_V2 14.5 asks for 24), and the full blocklist (pass it to `WorldBotCore({blocklist})` in `server/src/world-bot.js`).
