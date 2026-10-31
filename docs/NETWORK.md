# EVER: Multiplayer (rooms) — network notes

Owner: network engineer. Design rules: `docs/GDD.md` §7. Contracts and the wire table: `game/src/core/contracts.js` §7 and `docs/TECH.md` §6. This file explains **how the room server and the client are built, how to run them locally, and how to deploy them**. If this file and `contracts.js` disagree, the code wins.

---

## 1. Pieces

| File | What |
|---|---|
| `server/src/index.js` | Worker entry. `GET /room/health`, `POST /room/new`, `GET /room/<CODE>?v=1` (WebSocket). Origin check, CORS for local pages, hands sockets to the room's Durable Object. |
| `server/src/room.js` | `Room` Durable Object: a thin shell. WebSocket **Hibernation API** (`state.acceptWebSocket`, attachments `{cid, seat}`), saves the room to DO storage after every authoritative change, one storage alarm for all timers, 10 Hz movement batching. |
| `server/src/room-core.js` | `RoomCore`: **every room decision**, as a plain class with no Workers APIs (seats, reconnect, lobby, party combat, votes, shared memory, timers, snapshot). Tests drive it with plain objects. |
| `server/src/schema.js` | Deep validation of client frames (rebuilds every field the room uses), movement speed check, token bucket. |
| `server/src/rules.js` | The shared pure rules the room runs: `applyBookAction` (`game/src/core/rules/book.js`) and the party combat (`game/src/combat/rules/index.js`, which wraps the vendored Slay the Web engine). Same files as solo. |
| `game/src/net/client.js` | `createNetClient()` (the `NetClient` contract), `probeRooms()`, `roomServer()`, `NET_ERROR_TEXT`, `PEER_TEXT`. |
| `game/src/net/combat-driver.js` | `createNetCombatDriver(net)`: the co-op `CombatDriver`. |
| `game/src/net/interp.js` | Interpolation buffer for other players' positions. |
| `game/src/net/peers.js` | `attachPeers(net, world)`: per-frame glue that draws peers through `WorldApi.upsertPeer/removePeer`, sends our position, applies server corrections. |

Tests: `server/test/schema.test.js`, `server/test/room-core.test.js`, `game/src/net/net.test.js` (vitest, part of `npm test`), and `server/test/rooms-integration.mjs` (real `wrangler dev`).

---

## 2. Run locally

```bash
npm install
npm run rooms          # terminal 1: wrangler dev on http://127.0.0.1:8787 (no Cloudflare login)
npm run dev            # terminal 2: Vite on http://127.0.0.1:5173, proxies /room (HTTP + WS) to :8787
```

Open two browser windows on http://127.0.0.1:5173, host in one, join with the code in the other.

How the client finds the room server (`resolveRoomServer`, contracts.js):

1. `?rooms=<url>` page override (only local hosts or `*.dreamz.rest`), e.g. `http://127.0.0.1:5173/?rooms=http://127.0.0.1:8788`.
2. Build-time `VITE_ROOMS_URL` (a staging Worker).
3. Vite dev/preview (ports 5173/4173): same origin; Vite proxies `/room` to `EVER_ROOMS_URL` or `http://127.0.0.1:8787`.
4. Any other local page (the bridge `npm start` on :1455): `http://127.0.0.1:8787` directly (the Worker allows local origins).
5. Hosted: same origin, `wss://game.dreamz.rest/room/<CODE>?v=1`.

Tests:

```bash
npm test                                   # unit tests (incl. schema, room core, net client) + bridge smoke
node server/test/rooms-integration.mjs     # starts wrangler dev on a free port, runs the full flow, stops it
node server/test/rooms-smoke.mjs [base]    # quick check against an already running `npm run rooms`
```

`rooms-integration.mjs` picks free ports for the server and the inspector, persists into a temp dir (deleted afterwards), and kills the wrangler process group at the end, pass or fail. It covers: host, join, a too-far village action, both players walking to the Ash Gate at legal speed and seeing each other, the gate lobby, a fight with 2 fighters (Warden 184 HP), playing a card, a rejected card, ending turns, one client dropping mid-fight (the Warden acts without them), reconnecting with the seat token to the same seat with the same hand, a second full round, a bad frame, a version mismatch, `bye`. It then runs `rooms-smoke.mjs` against the same server.

---

## 3. Protocol v1 additions (beyond TECH.md §6.2)

Every frame is `{v: 1, t, ...}`. The table in TECH §6.2 holds. Small additions, all optional fields (no version bump needed):

| Frame | Addition | Why |
|---|---|---|
| `err` | `why` (string, combat only): the rules' detail, e.g. `energy`, `unplayable`, `no_card`, `bad_target` | so the UI can show "Not enough energy." / "Doubt can't be played." while `code` stays in the fixed ErrorCode list |
| `mvs` | `fix: [x, z]`, sent **only to the mover**, with `m: []` | the room clamped the mover's position (speed check, map edge) or respawned them at page one after death / new book; the client snaps with `world.teleport` (done by `attachPeers`) |
| `cbt` | `ev` on the first `cbt` of a fight carries `pc.startEvents` (`round`, token lines) | token feedback "Ember burns: +1 Energy." etc. |

Frame sizes (measured with 4 seats in a fight): `welcome` 2.0 KB, `book` 1.2 KB, `cbt` 2.2 KB, `room` 0.7 KB, `peer` 55 B, `mvs` about 25 B per moving player.

### Message validation

1. `decodeClient` (contracts.js): string, ≤ 4 KB, JSON object, `v === 1`, type whitelist, basic field shapes.
2. `cleanClientMsg` (schema.js): rebuilds the message from whitelisted fields only. `act.a` is rebuilt per BookAction type (uids `c\d+`, station names from `STATIONS`, card ids, option ids, free text ≤ 120 chars, AI proposals re-validated with `validateAiProposal`). `marcus.friendStruck` is always refused from clients. Unknown action types pass with at most 4 primitive fields, so the systems engineer can add actions without a server change; the rules reject anything meaningless. `play.target` must be `enemyN` or `player`; `cardId` `[A-Za-z0-9_-]{1,64}`.
3. The rules then decide (station distance from the **server** position, uses left, card in hand, energy, turn state).

Repeated garbage (> 10 bad frames) closes the socket with 4400. Version mismatch → `err version` + 4001.

### Limits

| Limit | Value |
|---|---|
| Frame size | 4 KB (client frames) |
| Rate | token bucket per socket: burst 30, 15 frames/s; over it → `err rate` (at most once per second); more than 40 dropped frames → close 4400 |
| Movement | clamped to the map (±32) and to 6 u/s × 1.5 slack with up to 2 s of banked budget; positions relayed at 10 Hz, rounded to 0.01 |
| Hello | first frame must be `hello`, within 10 s |
| Seats | 4; seat token 144-bit random, never broadcast |

---

## 4. Room behaviour (RoomCore)

- **Seats.** `hello` with a live seat token (within 120 s of the drop) reclaims the seat, its book and its fight seat (`peer back`). A second tab with the same token takes over and the old socket closes with 4010. Otherwise a new seat with a fresh book (`booksWritten` from the client's meta, for "Have we met?").
- **Drop.** Socket close/error: seat kept, `peer drop`, gate ready cleared, Marcus bubble cleared; in a fight the fighter is marked away (auto-ended, skipped by the Warden). After 120 s: seat freed (`peer left`); in a fight the fighter is removed (not dead).
- **Host leaves.** Nothing special. The room is authoritative and keeps running.
- **Village actions.** `act` → `applyBookAction(book, a, {pos: server position, now, coop: true, friendStruck})`. Reply `book {ref, book, fx}` or `err {code: too_far|not_allowed, ref}`. Refused while the player is in a fight.
- **Shared memory (GDD 7.2).** When a book's `marcus.flags.struck` turns true, the room sets `struck`, sends `ann {e: 'struck'}` and applies `{type: 'marcus.friendStruck'}` to every other seat's book (trust −1 once, no Doubt), each getting an unsolicited `book` frame.
- **Talking bubble.** `marcus.talk/option/free` sets `talking` (`ann talking`) until an effect `close` comes back or the player walks away from Marcus (`ann quiet`).
- **Gate lobby (GDD 7.4).** `gate {ready: true}` only inside the circle (server position), only in the village phase, only with an `exploring` book. Fight starts when everyone connected (and not fighting) is ready, or 30 s after more than half are (`room.lobby.startsAt`). Leaving the circle un-readies.
- **Fight start.** For each fighter: `spendTokensForCombat`, book status `fighting` (sent as `book`), then `createPartyCombat({fighters: [{seat, name, book, tokens}], enemyId: 'ashWarden', seed, now})`. Each fighter gets their own `cbt` (`viewFor` their seat: own hand only). Non-fighters get only `room` (`warden {state: 'fighting', round}`), which drives "Your party is fighting the Warden. Round {n}."
- **Combat.** `play`/`end` → `combatStep`; a 1 s alarm runs `tickTimers` (60 s turn timer). After every step: per-fighter `cbt` (the requester's carries `ref`), then deaths, then `outcome`.
- **Death (GDD 7.3/7.5).** `done {won: false, hpLeft: 0, dead: true}`, then a fresh `book` (`booksWritten + 1`, page one) and `mvs {fix: [0, 22]}`. They cannot rejoin this fight.
- **Win.** Survivors: `done {won: true, hpLeft, turns}`, book `hp = hpLeft`, status `won`. Every other seat's book also becomes `won` (everyone sees "Chapter complete"). Room phase `epilogue`, Warden `defeated`.
- **Loss.** Everyone fell or was removed: Warden back to `dormant`, phase `village`; the party can gather again.
- **New book vote.** `vote {newBook}` in the epilogue; when every connected seat has voted yes, every seat gets a new book at page one, `struck` resets, phase `village`.
- **Idle.** 10 minutes with nobody connected: storage is deleted; the code answers `no_room` from then on.
- **Persistence.** `RoomCore.toJSON()` (seats with books, party combat state, lobby, phase) is written to DO storage after each authoritative change; positions at most every 2 s. On a hibernation wake or eviction the constructor restores it and reconciles live sockets from their attachments.

---

## 5. Client (game/src/net)

```js
import {createNetClient, NET_ERROR_TEXT} from './net/client.js'
import {createNetCombatDriver} from './net/combat-driver.js'
import {attachPeers} from './net/peers.js'

const net = createNetClient({bus})
const {code, seat} = await net.hostGame({name})        // or net.joinGame(code, {name})
// errors: NetError with .code in no_room|full|version|network|name and .message = GDD 6 copy
store.attachNet(net)                                     // book store adopts the room's book frames
const detachPeers = attachPeers(net, world)              // avatars + our position + corrections
makeDriver = () => createNetCombatDriver(net)            // co-op combat
net.onState((room) => ...)                               // RoomSnapshot: party list, lobby, warden, votes
net.on(MSG.ANN, ...); net.on(MSG.DONE, ...); net.on('closed', ({reason}) => ...)
net.send(MSG.GATE, {ready: true}); net.send(MSG.VOTE, {newBook: true})
net.leave()
```

- **Reconnect.** An unexpected close (not 4000/4001/4004/4009/4010/4408) sets status `reconnecting` and retries after 0.5, 1, 2, 4, 8, 8, ... s until the 120 s seat window is over; the browser `online` event retries at once. The seat token is kept in memory and in `ever.v1.seat.{CODE}` in sessionStorage (per tab, survives a reload; two tabs of one browser are two players). On success: status `open`; on failure `closed` and the `closed` event.
- **Status** goes to `EV.NET_STATUS`; room snapshots to `EV.ROOM`; raw peer samples to `EV.PEER_MOVE`; combat views to `EV.COMBAT_VIEW`. The client shows no toasts itself (core/game.js owns the GDD 6 copy; `PEER_TEXT` has it too).
- **request(t, body)** adds `ref` and resolves with the reply frame (`book`, `cbt` or `err`); 10 s timeout or a dead socket resolves `err {code: 'server'}`. It never rejects.
- **sendMove** sends at most 10 Hz, only when something changed (including stopping), rounded to 0.01.
- **Interpolation.** Each peer is drawn 130 ms in the past between the two samples around that time; past the newest sample it extrapolates up to 150 ms while walking, then holds; jumps over 8 units snap (respawn, correction). `net.peerAt(seat)` returns `{x, z, yaw, walking}`.
- **Combat driver.** `view()` starts from the last `cbt` the client got (the fight may start before the UI mounts). `play`/`endTurn` resolve `{ok}` or `{ok: false, error}` (`error` = `why` if present). `done` resolves on `done`, or as a loss without death if the room is gone for good. `COMBAT_ERROR_TEXT` maps errors to copy.

---

## 6. Deploy (not done here)

1. In `server/wrangler.toml` uncomment
   `routes = [{pattern = "game.dreamz.rest/room/*", zone_name = "dreamz.rest"}]`.
   The zone must be on the same Cloudflare account as the Pages project. Worker routes run in front of the Pages custom domain, so the browser stays same-origin (`wss://game.dreamz.rest/room/<CODE>`), and Pages `_headers` CSP already allows `wss://game.dreamz.rest`.
2. `npx wrangler login` (once), then `npx wrangler deploy --config server/wrangler.toml`. The `v1` migration creates the SQLite-backed `Room` class (required for the free plan and for `setAlarm`).
3. Check: `curl https://game.dreamz.rest/room/health` → `{"ok":true,"v":1}`.
4. Pages: build `npm run build`, output `public`. Deploy the Worker and Pages **together** whenever `PROTOCOL_VERSION` changes.
5. Preview deployments (`*.pages.dev`) need their origin added to `ALLOWED_ORIGINS` in `wrangler.toml`, and a `?rooms=` or `VITE_ROOMS_URL` pointing at the Worker.
6. Optional hardening at the edge: a Cloudflare rate-limiting rule on `POST /room/new` (e.g. 10/min per IP); the Worker itself only caps per socket.

Costs: a room is one Durable Object; with the Hibernation API an idle socket does not keep it billed. During a fight the 1 s alarm keeps it awake (about 4 minutes per fight).
