# EVER: Technical Design (MVP)

Owner: Technical Director. Gameplay truth is `docs/GDD.md`; look truth is `docs/ART_BIBLE.md` + `game/src/shared/`. This doc is the truth for **where code lives, who owns it, and how the pieces talk**. The contracts are real code in `game/src/core/contracts.js`; this doc explains them. If the two disagree, the code wins and this doc gets fixed.

License: AGPL-3.0-or-later (root `LICENSE`), because combat reuses Slay the Web (`vendor/slaytheweb/`, see its `NOTICE.md`). Every new source file starts with the short copyright + `SPDX-License-Identifier: AGPL-3.0-or-later` header.

---

## 1. Architecture in one picture

```
 browser (game/, built by Vite into public/)                         room server (server/, Cloudflare Worker)
 ┌───────────────────────────────────────────────────────────┐       ┌───────────────────────────────────────┐
 │ index.html: #world (one WebGL canvas)  #combat  #ui        │       │ Worker  /room/health  /room/new        │
 │                                                            │       │         /room/<CODE>  (WebSocket)      │
 │ main.js ── createModeController ── showWorld/startCombat  │       │            │                           │
 │   │            │                         │                 │       │            ▼                           │
 │ world/  (three.js village, input,   combat/ (card UI)      │       │ Durable Object "Room" (one per code)   │
 │          peers, combat staging)      │  uses CombatDriver  │  WS   │   seats, books, positions, lobby,      │
 │   │                                  │                     │◄─────►│   party combat (authoritative)         │
 │ core/ (book store, Marcus UI, HUD,   │ Local driver (solo) │ JSON  │            │ imports the SAME pure     │
 │        screens, persistence, AI)     │ Net driver (co-op)  │  v1   │            ▼ modules as the browser:  │
 │   │                                  │                     │       │  core/contracts.js                     │
 │   └── core/rules/  (PURE) ◄──────────┼─── combat/rules/ (PURE) ◄───┤  core/rules/**     (book + Marcus)     │
 │                                      │        │                    │  combat/rules/**   (engine adapter)    │
 │ net/ (room client, net combat driver)│        ▼                    │  vendor/slaytheweb (via combat/rules)  │
 │ shared/ (art kit: style.js/.css)     │  vendor/slaytheweb (engine) └───────────────────────────────────────┘
 └───────────────────────────────────────────────────────────┘
```

Key decisions:

1. **One rules codebase, two hosts.** Everything that decides an outcome (deck changes, trust, combat) is pure JS in `game/src/core/rules/**` and `game/src/combat/rules/**`. Solo runs it in the browser; co-op runs the identical files in the Durable Object, which is authoritative. Clients only render and send intents.
2. **Solo is a party of one without a server.** Same combat rules (`createPartyCombat` with one fighter), same `CombatDriver` interface; only the driver differs (local vs network). No socket is opened in solo.
3. **One canvas.** Combat re-frames the same Three.js scene (ART_BIBLE 5). The combat module draws its UI in the `#combat` DOM layer and moves 3D actors through `WorldApi` (`getWardenActor`, `getPartyActor`).
4. **Vendor stays pristine.** All GDD engine changes are applied at runtime by `combat/rules` (section 5.2), so `vendor/slaytheweb` is byte-identical to upstream `a108c3e`.
5. **Plain DOM, no UI framework.** three, immer (engine dependency) and nothing else at runtime. Ask the TD before adding a runtime dependency.

---

## 2. Folders and ownership

Only the owner edits a folder. Everyone may **import** from anything listed. Need a change elsewhere? Ask the owner (or note it in your hand-off `openIssues`).

| Path | Owner | What | Rules |
|---|---|---|---|
| `game/src/world/**` | **World engineer** | Village scene, movement (WASD, click/tap to walk), follow camera, interaction prompts and `EV.INTERACT`, other players' avatars, combat staging (camera, actor slots) | Exports `createWorld(el, ctx) -> WorldApi` |
| `game/src/combat/**` | **Combat engineer** | Combat UI in `#combat`, `createLocalCombatDriver`, card art cache | Exports `createCombat(el, ctx) -> CombatUiApi`, `createLocalCombatDriver` |
| `game/src/combat/rules/**` | **Combat engineer** | PURE engine adapter: Doubt, `unplayable`, Doubt tick, death `< 1`, tokens, Ash Warden, co-op party combat (one STW state per fighter + shared Warden) | **No DOM, no three.** Imported by the server |
| `vendor/slaytheweb/**` | Combat engineer (content only) | Upstream engine, unchanged | May add new content files only; never edit upstream files without recording it in `NOTICE.md` |
| `game/src/core/**` | **Systems engineer** | `contracts.js`, book store, Marcus dialogue UI, HUD, cover/chapter/win/death pages, persistence, AI client, toasts, deck screen | `contracts.js` changes need a TECH.md note + heads-up |
| `game/src/core/rules/**` | Systems engineer | PURE book rules: `applyBookAction`, classifier, rules table, remembered line | **No DOM.** Imported by the server |
| `game/index.html`, `game/src/main.js`, `game/static/**` | Systems engineer | Page shell and wiring | Keep main.js thin |
| `server/**` | **Network engineer** | Worker, Room Durable Object, `wrangler.toml`, room tests | May import `game/src/core/contracts.js`, `core/rules/**`, `combat/rules/**` only (never `shared/`, `world/`, three) |
| `game/src/net/**` | Network engineer | Room client (`createNetClient`), `createNetCombatDriver`, reconnect UX hooks | |
| `game/src/shared/**` | **Art** | `style.js` (3D kit, palette), `style.css` (UI tokens + components) | Everyone else: import only |
| `docs/GDD.md` / `docs/ART_BIBLE.md` / `docs/TECH.md` | Creative Dir. / Art Dir. / Tech Dir. | | |
| `package.json`, `vite.config.js`, `LICENSE`, `README.md`, `test/unit/contracts.test.js` | Technical Director | Build, deps, contract tests | |
| `bridge.mjs`, `test/smoke.mjs`, `test/fake-openai.mjs` | (frozen) | Local AI bridge | Do not change its API |
| `legacy/`, `inkwell-grimoire.html`, `ever-style-forge.html` | (frozen) | Old prototypes | Not built, not shipped |

Tests live next to code as `*.test.js` under `game/src/**` or `server/**` (vitest picks them up), plus `test/unit/**`.

---

## 3. Build, run, ports

| Command | What | Port |
|---|---|---|
| `npm install` | Deps: three 0.170, immer 10; dev: vite 7, vitest 3, wrangler 4 | |
| `npm run dev` | Vite dev server, root `game/`, proxies `/room/*` (HTTP + WS) to the room server | 5173 |
| `npm run rooms` | `wrangler dev` for `server/` (local workerd + Durable Objects, no Cloudflare login) | 8787 |
| `npm run build` | Vite build `game/` -> `public/` (emptied first), target es2022 | |
| `npm start` | `node bridge.mjs`: serves `public/` + the AI bridge API | 1455 |
| `npm run preview` | Vite preview of `public/` | 4173 |
| `npm test` | `vitest run` + bridge smoke test | |
| `node server/test/rooms-smoke.mjs [base]` | Room server smoke test against a running `npm run rooms` (or the Vite proxy: `http://127.0.0.1:5173`) | |

Notes:
- `base: './'` so the same build works at `https://game.dreamz.rest/` and `http://127.0.0.1:1455/`.
- `build.target: 'es2022'` because the vendored `content/cards.js` uses top-level await. Card files become tiny lazy chunks; that is fine.
- `game/static/**` is copied verbatim to `public/` (`favicon.svg`, `_headers` for Pages, `CREDITS.txt`).
- `public/` is build output (git-ignored). The bridge's MIME table knows html/js/css/json/png/svg only; don't ship other file types (fonts come from Google Fonts with offline fallbacks; see 8).
- Fonts are added by `main.js` at runtime (no inline handlers, so the Pages CSP in `_headers` holds).

---

## 4. Core contracts (`game/src/core/contracts.js`)

### 4.1 Book (one per player per run)

```js
{ v: 1, bookNo, booksWritten, seed, status: 'exploring'|'fighting'|'won'|'dead'|'epilogue',
  hp: 50, maxHp: 50,
  deck: [{uid: 'c0', id: 'Strike', upgraded: false}, ...],   // id = STW base name, never has '+'
  nextUid,
  tokens: ['ember','ward','whetstone'] subset, unique, max 3,
  curses: {cold: bool, struck: bool, shrine: n},              // sources; the Doubt cards are in deck
  used: {well, lectern, grindstone, shrine}, lecternOffer: [3 ids],
  visited: {well, marcus, grindstone, lectern, gate}, openedAt,
  marcus: {trust, beat, flags: {met, promised, askedWhy, confessed, tip, struck, friendStruck, emberGiven, upgradeAt1, upgradeAt3},
           upgradesLeft, anvilClosed, freeTextGain, freeTextCount, aiDisabled},
  stats: {turns} }
```
- Plain JSON (it goes over the wire and into DO storage). `newBook({meta, seed})` builds one.
- `uid` makes "remove that Strike" unambiguous; GDD 3.1 `{name, upgraded}` maps to `{id, upgraded}`.
- No gold in the MVP.
- **Meta** (`ever.v1.meta`) = `{booksWritten, rememberedLine}`, the only cross-book state. No mid-book save.

### 4.2 Deck mutation API (pure, RPG side only)

`addCard(book, id, upgraded?)`, `removeCard(book, uid)`, `upgradeCard(book, uid)`, `addCurse(book, source, n?)`, `addToken(book, kind)`, `spendTokensForCombat(book) -> {book, spent}`, `upgradableCards(book)`. They return a new book and never mutate. **Only `core/rules` and the room call them**, after the GDD 3.5 checks. Combat code never changes a book; it reports `{won, hpLeft, turns}`. UI code never calls them; it dispatches a `BookAction`.

### 4.3 Book actions (the only way the village changes a book)

`applyBookAction(book, action, ctx) -> {ok, book, effects, error?}` in `core/rules/book.js`, pure.

| Action | Station | Notes |
|---|---|---|
| `{type:'visit', place}` | any | hint progression |
| `{type:'well.remove', uid}` / `{type:'well.ward'}` | well | one or the other, once |
| `{type:'lectern.take', id}` / `{type:'lectern.leave'}` | lectern | `id` must be in `lecternOffer` |
| `{type:'grindstone.take'}` | grindstone | Whetstone |
| `{type:'shrine.take'}` | shrine | Bludgeon + 2 Doubt |
| `{type:'marcus.talk'}` / `{type:'marcus.option', option}` | marcus | beats 1-4; option ids chosen by the systems engineer and listed in `book.js` |
| `{type:'marcus.free', text, ai?}` | marcus | `ai = {reply, intent, trust}` already validated client-side; re-validated by the room |
| `{type:'anvil.upgrade', uid}` | marcus | needs `upgradesLeft > 0` |
| `{type:'marcus.friendStruck'}` | – | room-internal only (shared memory, GDD 7.2); rejected from clients |

`ctx = {pos: [x, z], now, coop?, friendStruck?}`. In co-op the room fills `pos` from **its own** copy of the player's position; `inStationRange(station, x, z)` adds the 1-unit tolerance. Error strings: `too_far`, `used`, `not_allowed`, `bad_card`, ... (rules decide; the room maps unknown ones to `not_allowed`).

`effects` are display-only: `say`, `options`, `trust`, `hp`, `card`, `token`, `toast`, `lantern`, `picker`, `close`. All text is GDD copy, except `say` may carry a validated AI reply (render with `textContent`, never `innerHTML`).

### 4.4 Book store

`createBookStore({net, getPos}) -> {get, dispatch(action), subscribe, finishCombat, openNewBook}` (`core/book-store.js`). Solo: applies rules locally. Co-op: `net.request('act', {a})`, adopts the room's `book` reply, and also listens to unsolicited `book` frames (e.g. friend struck Marcus, death in a party fight).

### 4.5 Event bus

`bus.on(type, fn) -> off`, `bus.once`, `bus.emit`. Names in `EV`: `book:changed`, `meta:changed`, `mode`, `world:interact {station}`, `world:range {station|null}`, `ui:toast {text}`, `net:status`, `net:room`, `net:move`, `combat:view`, `combat:done`. Add new names to `EV`, don't invent strings inline.

### 4.6 Modes

`createModeController({world, combat, makeDriver})` -> `showWorld()`, `startCombat({enemyId:'ashWarden'}) -> Promise<{won, hpLeft, turns}>`, `showTitle()`.
- `WorldApi` (world): `show, hide, setStage('explore'|'combat'), syncBook(book), getPlayerPos(), upsertPeer(seat, p), removePeer(seat), getWardenActor(), getPartyActor(seat), teleport(x, z), dispose`.
- `CombatUiApi` (combat): `run(driver) -> Promise<CombatResult>`, `dispose`.
- `makeDriver` returns `createLocalCombatDriver({book, enemyId})` in solo and `createNetCombatDriver(net)` in co-op.

### 4.7 Persistence keys

`ever.v1.meta` (Meta), `ever.v1.seat.{CODE}` (`{seatToken, seat, name, at}`), `ever.v1.name`, `ever.v1.settings`. Every read/write is try/catch; the game runs with storage blocked. Helpers: `loadMeta/saveMeta`, `loadSeat/saveSeat/clearSeat`, `loadName/saveName`.

### 4.8 AI

- `createBridgeClient({origin: location.origin})`: `enabled` only when origin is exactly `http://127.0.0.1:1455`. `status()`, `login()` (POST `/api/login`, `x-ever: 1`), `ask(input)` (POST `/api/ai`, `{instructions: AI_INSTRUCTIONS, input}`, 20 s timeout) -> `{ok, proposal}` or `{ok:false, reason: 'off'|'limit'|'auth'|'invalid'|'error'}`. On the hosted site nothing touches the network.
- `AI_INSTRUCTIONS` is GDD 2.5 verbatim; `buildAiInput(book, says)` builds the `input` JSON (the `knows` list grows after `confessed`).
- `validateAiProposal(textOrObj)` = GDD 2.5 steps 1-4 (extract, intent whitelist, sanitize reply to 240 chars, trust rounded and clamped to -1..1). Steps 5-7 are rules (`core/rules`). The room calls it again on what a co-op client sends.
- `classifyFreeText(text)` (local classifier, `core/rules/marcus.js`) is the offline path and the fallback.

---

## 5. Combat contract

### 5.1 Pure rules (`game/src/combat/rules/index.js`)

```
createPartyCombat({fighters: [{seat, book}], enemyId, seed?}) -> pc     // solo: one fighter, seat 0
combatStep(pc, seat, action, now) -> {pc, events, error?}
    action: {type:'play', cardId, target?} | {type:'end'}
          | {type:'disconnect'} | {type:'reconnect'} | {type:'remove'}   // last three: room only
tickTimers(pc, now) -> {pc, events}        // 60 s auto-end after the first End turn
viewFor(pc, seat) -> CombatView            // what that player may see (own hand only)
outcome(pc) -> null | {won, bySeat: {seat: {hpLeft, dead}}, rounds}
```
- `pc` is plain JSON (the DO may store it). Engine states use immer; keep them serializable.
- `cardId` is the engine card instance id. In co-op the room's copy is the truth.
- Tokens: applied after state creation (`ember` energy +1, `ward` block 8, `whetstone` Warden Vulnerable `max(cur, 2)`); the caller first runs `spendTokensForCombat(book)` and passes the spent list in.
- Co-op specifics from GDD 7.3: intent per living fighter = step `(round - 1 + k) mod 4`; shared Warden block/Vulnerable/Weak; Warden HP `WARDEN_HP_BY_PARTY[n-1]` fixed at start; Doubt tick at the fighter's End turn; death at HP < 1 removes the fighter; disconnected fighters auto-end and are skipped.
- Already provided: `ensureEngine()`, `ENEMIES.ashWarden`, `createEnemy(id, partySize)`, `createFighterState(book, monster)`, `engineCard(deckCard)`.

### 5.2 How the engine is changed without editing vendor

| GDD change | Where |
|---|---|
| Doubt card | `combat/rules/content/doubt.js`, pushed into engine `cards`/`cardUpgrades` by `ensureEngine()` |
| `unplayable` condition | `allConditions.unplayable = () => false` in `ensureEngine()` (the engine's `canPlay` looks it up) |
| Doubt tick before `discardHand` | adapter's own end-turn: `removeHealth` 2 per Doubt in hand, then the engine's per-step actions |
| Death at HP < 1 | adapter checks `currentHealth < 1` itself; never relies on `endTurn`'s `< 0` |
| 50 max HP, one-node dungeon | `createFighterState` |
| Co-op | adapter drives the engine's exported actions per fighter and runs the shared Warden itself (do not call the engine's `endTurn`/`playMonsterActions` for the shared Warden) |

### 5.3 CombatDriver (what the combat UI talks to)

`{view(), onView(fn) -> off, play(cardId, target?) -> Promise<{ok, error?}>, endTurn(), done: Promise<{won, hpLeft, turns, dead}>}`. The UI must not know whether it is solo or co-op.

`CombatView`: `{round, you, warden: {hp, maxHp, block, powers, intents: [{seat, step, damage?, block?, weak?}]}, fighters: [{seat, name, hp, maxHp, block, energy, powers, ended, dead, connected, handCount, drawCount, discardCount}], hand: [{id, name, type, energy, upgraded, playable, target, description}], timerEndsAt, over}`.

---

## 6. Multiplayer

### 6.1 URLs and routing

| | Production | Local |
|---|---|---|
| Static game | Cloudflare Pages project, output `public/`, custom domain `https://game.dreamz.rest` | `npm start` (bridge, :1455) or `npm run dev` (:5173) |
| Room server | Worker `ever-rooms` with route **`game.dreamz.rest/room/*`** on zone `dreamz.rest` (Worker routes run in front of the Pages custom domain), so the browser stays same-origin | `npm run rooms` -> `http://127.0.0.1:8787` |
| Health | `GET /room/health` -> `{ok, v}` | same |
| Create | `POST /room/new` body `{v}` -> `201 {code, v}`; `426 {error:'version'}` | same |
| Join | `GET /room/<CODE>?v=1` with `Upgrade: websocket` | same |

Why a Worker route and not a Pages Function: Durable Objects must be defined in a Worker script anyway; a route on the same hostname avoids CORS, cookies and a second domain, and the Worker deploys independently of the static site.

**How the client finds the room server** (`resolveRoomServer(location, import.meta.env.VITE_ROOMS_URL)`):
1. `?rooms=<url>` in the page URL (only localhost/127.0.0.1 or `*.dreamz.rest`, for testing).
2. Build-time `VITE_ROOMS_URL` (e.g. a staging Worker).
3. Page on localhost/127.0.0.1 on port 5173/4173 (Vite) -> same origin; Vite proxies `/room` to :8787 (`EVER_ROOMS_URL` env var overrides the proxy target).
4. Any other local page (the bridge on :1455) -> `http://127.0.0.1:8787` directly (the Worker allows local origins via CORS).
5. Otherwise same origin (`https://game.dreamz.rest`, `wss://game.dreamz.rest/room/<CODE>`).

Origin policy (Worker): requests with an `Origin` must match `ALLOWED_ORIGINS` (`https://game.dreamz.rest`) or a local origin (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`, any port). Add Pages preview origins to `ALLOWED_ORIGINS` if you need them.

### 6.2 Wire protocol v1

Every frame is one JSON object `{v: 1, t: <type>, ...}`. `encode(t, body)` builds one; the server parses client frames with `decodeClient(raw)` (version, type whitelist, field shapes, 4 KB cap). Mismatched `v` -> `err {code:'version'}` + close 4001 ("That room runs a different version of EVER. Refresh the page.").

**Client -> server**

| t | Body | When |
|---|---|---|
| `hello` | `{name, seatToken?, booksWritten?}` | first frame; `seatToken` from `ever.v1.seat.{CODE}` reclaims a seat within 120 s |
| `mv` | `{p: [x, z, yaw], w: 0|1}` | movement, at most 10 Hz, only while moving or on stop |
| `act` | `{ref, a: BookAction}` | any village/Marcus/deck action |
| `gate` | `{ready}` | in the gate circle |
| `play` | `{ref, cardId, target?}` | co-op combat |
| `end` | `{ref}` | end my turn |
| `vote` | `{newBook}` | after a win |
| `ping` | `{ts}` | every 20 s (keeps NATs and the DO warm; RTT for UI) |
| `bye` | `{}` | leave on purpose: seat freed at once |

**Server -> client**

| t | Body | To |
|---|---|---|
| `welcome` | `{code, seat, seatToken, room, book, peers}` | the joiner |
| `err` | `{code, ref?}` codes: `version`, `no_room`, `full`, `bad_msg`, `not_allowed`, `too_far`, `not_your_turn`, `not_in_fight`, `rate`, `server` | one client |
| `room` | `{room: RoomSnapshot}` | all, on shared changes (seats, lobby, warden state, votes); never at 10 Hz |
| `peer` | `{seat, e: 'join'|'left'|'drop'|'back', name}` | all others (toasts in GDD 6) |
| `mvs` | `{m: [[seat, x, z, yaw, w], ...]}` | all, batched at 10 Hz, values rounded to 0.01 |
| `book` | `{ref?, book, fx}` | owner only (private) |
| `ann` | `{seat, e: 'talking'|'quiet'|'struck'}` | all (speech bubble, shared memory) |
| `cbt` | `{ref?, view: CombatView, ev}` | each fighter/spectator gets their own `viewFor` |
| `done` | `{won, hpLeft, turns, dead}` | each fighter when their fight ends |
| `pong` | `{ts}` | sender |

`RoomSnapshot`: `{code, v, phase: 'village'|'fighting'|'epilogue', seats: [{seat, name, connected, hp, maxHp, ready, inFight, talking, bookNo}], warden: {state: 'dormant'|'fighting'|'defeated', round}, struck, lobby: {ready, of, startsAt}, votes: {newBook: [seat]}}`.

Close codes: 4000 leave, 4001 version, 4004 no room, 4009 full, 4010 replaced by another tab, 4400 protocol violation, 4408 idle close.

Size budget: movement frames under 60 bytes; `book` about 1.5 KB; `cbt` under 3 KB. Don't send `room` per movement.

### 6.3 Flows

- **Host**: `POST /room/new` -> code -> open socket -> `hello` -> `welcome` (seat 0). The host has no special powers after that.
- **Join**: normalize code (`normalizeRoomCode`), `isValidRoomCode`, open socket, `hello {name, seatToken?}`. Errors map to GDD 6 copy (`no_room`, `full`, `version`, network failure -> "Can't reach the room server. Check your connection.").
- **Seat tokens**: 144-bit random, issued by the room in `welcome`, stored by the client in `ever.v1.seat.{CODE}`. The token is the only credential; never log or broadcast it.
- **Drop / reconnect**: socket closes -> seat kept 120 s (`peer drop`); the client retries with backoff (0.5, 1, 2, 4, 8 s, cap) and `hello` with the token -> same seat, same book, `peer back`. After 120 s the seat is freed (`peer left`).
- **Leave**: `bye` -> seat freed at once, client clears `ever.v1.seat.{CODE}`.
- **Host leaves**: nothing special; the DO keeps running.
- **Idle**: 10 minutes with nobody connected -> the DO clears its storage (use `state.storage.setAlarm`).
- **Fight**: lobby per GDD 7.4 -> room calls `spendTokensForCombat` on each fighter's book, `createPartyCombat`, sends `cbt` views; `play`/`end` -> `combatStep`; a 1 s alarm/timer runs `tickTimers`; on `outcome` the room updates books (hp, status, death -> fresh `newBook` for that seat) and sends `done` + `book`.

### 6.4 Authority rules (non-negotiable)

1. The room never trusts client numbers except the movement sample, and clamps that (map bounds ±32, speed check 6 u/s with slack).
2. Every `act` runs `applyBookAction` with server context. Every `play`/`end` runs `combatStep`. Clients never send results.
3. AI proposals from clients are re-validated with `validateAiProposal`, and free-text trust stays capped at +2 per book (GDD 2.5 accepted risk).
4. Rate limit per socket (suggested: 30 frames/s burst, 15/s sustained; over it -> `err rate`, repeated -> close 4400).

### 6.5 Room storage

Skeleton keeps seats in memory and `created/code` in DO storage. Recommended: persist `{seats (minus sockets), books, pc}` after each authoritative change so a DO restart keeps the room. Use plain `ws.accept()` (not hibernation) for the MVP; rooms are small and short-lived.

---

## 7. Deploy (not done by the studio pipeline)

1. **Pages**: project root = repo root, build command `npm run build`, output directory `public`, Node 22. Custom domain `game.dreamz.rest`. `public/_headers` sets CSP (self + Google Fonts + `wss://game.dreamz.rest`), nosniff, and immutable caching for `/assets/*`.
2. **Rooms**: in `server/wrangler.toml` uncomment `routes = [{pattern = "game.dreamz.rest/room/*", zone_name = "dreamz.rest"}]`, then `npx wrangler deploy --config server/wrangler.toml`. The `v1` migration creates the SQLite-backed `Room` class.
3. Bump `PROTOCOL_VERSION` whenever a message changes incompatibly, and deploy the Worker and Pages together.

---

## 8. Practical rules for working in parallel

- Pure modules (`core/contracts.js`, `core/rules/**`, `combat/rules/**`) must not touch `window`, `document`, `localStorage`, `three` or `shared/` at module top level. `npm test` imports them in Node, and `npm run rooms` bundles them into the Worker; both catch violations.
- Never import `vendor/slaytheweb/src/game/backend.js` (it calls a third-party API).
- Render untrusted text (names, AI replies) with `textContent`.
- Seeds: world props via `seedFromPos`, Lectern via `book.seed`. Every client in a room must build identical geometry.
- Fonts: Google Fonts (Young Serif, Figtree) are added at runtime by `main.js`; offline, style.css falls back to Georgia/system-ui. Self-hosting would need the bridge to serve `.woff2` (it doesn't today), so we don't.
- Before handing off: `npm run build`, `npm test`, and for net work `npm run rooms` + `node server/test/rooms-smoke.mjs`.
