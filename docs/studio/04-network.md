# 04-network report

Co-op multiplayer is built and tested. A host clicks "Host a game", gets a 5-character room code, and up to 3 friends join with it. The room server makes every decision; clients only send what the player wants to do.

Checks run:
- `npm run build` passes.
- `npm test` passes (152 unit tests plus the 18 bridge checks).
- `node server/test/rooms-integration.mjs` passes against real `wrangler dev`. It starts wrangler on a free port, connects two players, hosts, joins, and walks both to the Ash Gate at legal speed while each sees the other move. Both ready up and the fight starts (Warden 184 HP). It plays a card, has a bad card rejected and ends turns. It drops one player mid-fight (the Warden acts without them) and reconnects them to the same seat with the same hand. Then it plays a second round, sends a bad frame, a wrong version and a leave, and runs the Technical Director's smoke test against the same server. It stops wrangler afterwards, and nothing is left running.

**Server (`server/`)**
- `src/room-core.js` (new): all room logic as a plain class with no Cloudflare APIs, so tests drive it with plain objects.
  - Seats: 4 seats with private seat tokens. A dropped player keeps their seat for 120 s and gets the same seat and book back. A second tab with the same token takes over the seat. A leaving player frees the seat at once, and expired seats are freed. The room keeps running when the host leaves.
  - Village actions: every one runs through `applyBookAction` using the room's own copy of the player's position, never the message's.
  - Marcus: if anyone strikes him, every other player's trust drops by 1 once, and others see a "talking to Marcus" bubble.
  - Gate lobby: the fight starts when everyone connected is ready, or 30 s after more than half are.
  - Party combat: the room spends tokens, then runs `createPartyCombat`, `combatStep`, a 1 s check for the 60 s turn timer, `viewFor` (each player sees only their own hand) and `outcome`.
  - Death: the player gets a new book at page one and is moved back to spawn. Win: the chapter completes for the whole room. Loss: the Warden resets.
  - Other rules: a disconnected fighter is skipped, a seat that expires mid-fight is removed (not dead), and a new book after a win needs everyone's vote.
  - Timers and storage: 10 s to send the first message, a 10-minute idle close that deletes the room, and the full state saved after every change and restored on restart.
- `src/room.js` (rewritten): the Durable Object, a thin shell around room-core. It uses the WebSocket Hibernation API as the brief asked (TECH.md 6.5 suggested plain sockets). One storage alarm drives every timer, movement is batched at 10 Hz, and state is saved to storage.
- `src/schema.js` (new): checks every incoming message beyond the shared `decodeClient` and rebuilds it from allowed fields only.
  - Village actions are rebuilt per type. Unknown action types pass with up to 4 simple fields so new actions need no server change. `marcus.friendStruck` is always refused from clients.
  - AI proposals sent by clients are re-validated.
  - Movement is clamped to the map and to walking speed (6 u/s with 1.5x slack and up to 2 s of banked budget).
  - Rate limit per connection: 30 burst, 15 messages/s. Repeated garbage or flooding closes the socket with code 4400.
- `src/rules.js` (new): the shared rules set the room runs (the same files solo uses).
- `src/index.js` is unchanged.

**Client (`game/src/net/`)**
- `client.js`: `createNetClient` implements the full NetClient contract.
  - Join errors map to the GDD copy ("No room with that code.", "That room is full.", version, network, empty name).
  - Reconnect backs off 0.5, 1, 2, 4, then every 8 s within the 120 s window, and retries at once when the browser comes back online. The seat token is kept in memory and in localStorage.
  - `request()` matches replies by ref, never rejects, and times out after 10 s. Movement is sent at most 10 times a second, plus a 20 s ping.
  - It also keeps an interpolated position for each other player (`peerAt`).
- `combat-driver.js`: `createNetCombatDriver` is the co-op combat driver. It starts from the last combat view received, because the fight can start before the UI mounts.
- `interp.js`: draws other players about 130 ms in the past, extrapolates briefly, and snaps on teleports.
- `peers.js`: `attachPeers(net, world)` draws other players through the WorldApi, sends your position and applies server corrections.

**Small optional protocol additions (still version 1)**
- Combat errors carry a `why` field (energy, unplayable, no_card) so the UI can show the right line.
- A movement frame can carry `fix: [x, z]`, sent only to the mover when the server corrected their position or sent them back to spawn.
- The first combat frame of a fight carries the token lines.

**Tests**
- `server/test/schema.test.js` and `server/test/room-core.test.js` run the real shared rules: seats, reconnect, expiry, replacement, idle close, restore, validation, flood, speed clamp, station distance, the Marcus strike, forged AI proposals, lobby and countdown, tokens, a round, the turn timer, death plus win plus vote, a full party wipe, disconnect and reconnect mid-fight, expiry and joining mid-fight.
- `game/src/net/net.test.js` runs the client against a real room-core through a fake WebSocket, plus the combat driver, interpolation and `attachPeers`.
- `server/test/rooms-integration.mjs` (new) is the wrangler test above. I updated `rooms-smoke.mjs` because its 16-unit instant move is now correctly clamped.

`docs/NETWORK.md` covers the pieces, local run, how the game finds the room server, the protocol additions, validation and limits, room behaviour, the client API and deploy steps (nothing was deployed). Measured message sizes with 4 players: room-joined message 2.0 KB, book 1.2 KB, combat view 2.2 KB, room snapshot 0.7 KB.

During the work I removed the client's own toasts, because `core/game.js` already shows the GDD join/leave/reconnect lines and the client would have doubled them.

## Files
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/server/src/room.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/server/src/room-core.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/server/src/schema.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/server/src/rules.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/server/test/room-core.test.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/server/test/schema.test.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/server/test/rooms-integration.mjs
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/server/test/rooms-smoke.mjs
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/game/src/net/client.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/game/src/net/combat-driver.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/game/src/net/interp.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/game/src/net/peers.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/game/src/net/net.test.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/docs/NETWORK.md

## Open issues
- Systems engineer (core/game.js): the room sends `mvs {m: [], fix: [x, z]}` only to the mover when it clamps their position or respawns them at page one (after death or a new-book vote). game.js does not apply it yet. Call `world.teleport(fix[0], fix[1])` in the existing MSG.PEERS handler, or use `attachPeers(net, world)` from net/peers.js, which also draws interpolated peers. Without this, a respawned player's local position and the room's copy disagree until their movement budget catches up, and station actions can return too_far.
- Systems engineer: after a co-op win the room sets every seat's book.status to 'won' (same as solo finishCombat). applyBookAction only allows marcus.talk in 'epilogue', and co-op has no 'stay in Ashbrook' action, so Marcus can't be talked to in the co-op epilogue. Options: add a BookAction such as {type:'epilogue.stay'} that sets status 'epilogue' (the room passes unknown action types through), or tell me and the room can set 'epilogue' itself.
- Systems engineer: combat errors now carry `why` (energy | unplayable | no_card | bad_target | over); the net combat driver returns it as `error`, and net/combat-driver.js exports COMBAT_ERROR_TEXT for the GDD copy.
- Technical Director: TECH.md 6.5 says to use plain ws.accept(), not hibernation, but the network brief required the WebSocket Hibernation API, so room.js uses state.acceptWebSocket with per-socket attachments. Please update TECH.md 6.5, and link docs/NETWORK.md from TECH.md 6 and the README.
- Technical Director: please consider adding `"test:rooms": "node server/test/rooms-integration.mjs"` to package.json (I don't own package.json). It takes about 9 s, needs no Cloudflare login, uses free ports and a temp persist dir, and stops wrangler on exit.
- Protocol v1 additions (all optional fields, so no version bump): err.why, mvs.fix, and the first cbt of a fight carrying pc.startEvents in `ev`. They are documented in docs/NETWORK.md section 3; TECH.md 6.2 could mention them.
- Deploy (not done): uncomment the routes line in server/wrangler.toml, then `npx wrangler deploy --config server/wrangler.toml`. Add Pages preview origins to ALLOWED_ORIGINS if needed. Consider a Cloudflare rate-limiting rule on POST /room/new; the Worker only limits per socket.
- Accepted risk (GDD 2.5): the room re-validates the shape of AI proposals sent by clients but cannot prove the model produced them; the rules' +2 free-text trust cap still applies.
- Movement check: a newly joined seat starts with no banked movement budget, then banks up to 18 units after 2 s still. A client whose own avatar does not start at the spawn point (0,22) is clamped and receives a `fix`.
