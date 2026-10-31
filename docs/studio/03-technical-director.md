# 03-technical-director report

The project skeleton is set up, builds and passes its tests. Four engineers can now work in separate folders against one set of written contracts. `npm run build` puts the game in public/. `npm test` passes: 12 unit tests plus the 18 bridge checks. `npm run rooms` starts the room server locally with `wrangler dev` and needs no Cloudflare login. `node server/test/rooms-smoke.mjs` passes against it and through the Vite dev proxy. It covers host, join, seeing each other move, drop and reconnect to the same seat, wrong version, unknown room and leave. The browser shows the cover page over the rendered village with no console errors. Both servers were stopped afterwards.

**1. Package and build**
- package.json: AGPL-3.0-or-later. Scripts are dev, build, preview, test (vitest plus the bridge smoke test), test:unit, test:bridge, rooms (`wrangler dev` on :8787) and start (`node bridge.mjs`).
- Dependencies: three 0.170.0 and immer 10.2. Dev dependencies: vite 7.3, vitest 3.2 and wrangler 4.156. No UI framework.
- vite.config.js: root is game/, output is ../public (emptied first), `base: './'`. Target is es2022 because the vendored cards.js uses top-level await. The dev server proxies /room (HTTP and WebSocket) to 127.0.0.1:8787.
- game/static/ holds the favicon, the Pages `_headers` file (CSP and caching) and CREDITS.txt.
- The old public/index.html is now legacy/inkwell-v0.html. The root LICENSE is the full AGPL text. public/ and .wrangler/ are git-ignored.

**2. Vendored engine**
- The Slay the Web engine (src/game, src/utils.js, the content files it imports, all cards, LICENSE) is copied byte-for-byte into vendor/slaytheweb/ with NOTICE.md (commit a108c3e). No file or import path was changed, so NOTICE.md lists none.
- All GDD engine changes happen at runtime in game/src/combat/rules/:
  - `ensureEngine()` adds the Doubt card to the engine's card tables and adds the `unplayable` condition.
  - `createFighterState` builds a one-node dungeon and sets 50 max HP.
  - The Doubt tick, death at HP below 1, tokens and co-op are left to the combat engineer's own wrappers (TECH.md 5.2).
- The engine runs both in Node tests and inside workerd.

**3. docs/TECH.md** covers the architecture, an ownership table, build/run/ports, every contract, the multiplayer URLs and protocol, flows, authority rules, deploy steps and rules for working in parallel.

**4. Contracts (game/src/core/contracts.js)**
It has no DOM or three.js code, so the Worker imports it too.
- **Book:** `{v, bookNo, booksWritten, seed, status, hp, maxHp:50, deck:[{uid,id,upgraded}], nextUid, tokens:['ember'|'ward'|'whetstone'], curses:{cold,struck,shrine}, used, lecternOffer, visited, openedAt, marcus:{trust, beat, flags, upgradesLeft, anvilClosed, freeTextGain, freeTextCount, aiDisabled}, stats}`.
  - I added a `uid` per card so "remove that Strike" is unambiguous over the network.
  - No gold. Doubts are ordinary deck cards; `curses` only records where they came from.
- **Deck changes:** pure functions addCard, removeCard, upgradeCard, addCurse, addToken, spendTokensForCombat and upgradableCards, which only the village rules and the room call. The UI changes the book only through `BookStore.dispatch(BookAction)`, which goes to `applyBookAction(book, action, ctx)` in core/rules/book.js. That function is pure and the room imports the same file.
- **Bus:** `createBus` and `bus`, with the `EV` event names.
- **Modes:** `createModeController({world, combat, makeDriver})` gives `showWorld()` and `startCombat({enemyId}) -> Promise<{won, hpLeft, turns}>`. Solo and co-op share this flow; only the CombatDriver differs (local or network). Interfaces: `WorldApi`, `CombatUiApi`, `CombatDriver`, `CombatView`, and pure combat rules (`createPartyCombat`, `combatStep`, `tickTimers`, `viewFor`, `outcome`).
- **Saving:** keys `ever.v1.meta`, `ever.v1.seat.{CODE}`, `ever.v1.name`, all wrapped in try/catch.
- **AI:**
  - `createBridgeClient` is active only on http://127.0.0.1:1455; elsewhere it makes no network calls. It has status, login and ask with a 20 s timeout.
  - `AI_INSTRUCTIONS` is the GDD text verbatim.
  - `buildAiInput` builds the request input, and `validateAiProposal` implements GDD validation steps 1-4.
- **Multiplayer:**
  - Room rules: `PROTOCOL_VERSION=1`, room codes in the GDD alphabet, `MAX_SEATS` (4) and the reconnect, idle, turn-timer and lobby times.
  - Map data: `STATIONS` and `inStationRange` (radius plus 1). A test keeps these in sync with the art kit's coordinates.
  - Protocol: `resolveRoomServer`, `ROOM_ROUTES`, close codes, the `MSG` type table and `encode`/`decodeClient`.
  - Types: `RoomSnapshot` and `NetClient` (hostGame, joinGame, leave, onState, on, send, request, sendMove).

**5. Room URL decision**
- In production a Worker named `ever-rooms` answers the route game.dreamz.rest/room/* (commented out in wrangler.toml until deploy), so the browser stays on the same origin: POST /room/new, GET /room/health, and wss://game.dreamz.rest/room/<CODE>?v=1.
- The client finds the server in this order: a `?rooms=` override (local or dreamz.rest only), then `VITE_ROOMS_URL`, then same origin on Vite ports 5173/4173 (proxied), then 127.0.0.1:8787 for other local pages such as the bridge, otherwise same origin.

**6. Skeletons and stubs**
- game/index.html has #world (the one WebGL canvas both modes use), #combat and #ui. main.js wires everything and loads the fonts without blocking.
- Each owner has a stub with the agreed signatures: world/index.js (renders the village), combat/index.js, combat/rules, core/rules/book.js, core/rules/marcus.js, core/book-store.js, net/client.js and net/combat-driver.js.
- The server skeleton (server/src/index.js and room.js) already handles room creation, origin checks, seats with secret tokens, the 120 s reconnect, join/left/drop/back events, the 10 Hz movement relay, leaving and village actions via `applyBookAction`.
- README has "Run locally" and "Deploy" sections.

## Files
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/package.json
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/package-lock.json
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/vite.config.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/LICENSE
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/README.md
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/.gitignore
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/legacy/inkwell-v0.html
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/docs/TECH.md
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/vendor/slaytheweb/NOTICE.md
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/vendor/slaytheweb/LICENSE
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/vendor/slaytheweb/src/game/
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/vendor/slaytheweb/src/content/
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/vendor/slaytheweb/src/utils.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/game/index.html
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/game/src/main.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/game/src/core/contracts.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/game/src/core/book-store.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/game/src/core/rules/book.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/game/src/core/rules/marcus.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/game/src/combat/index.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/game/src/combat/rules/index.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/game/src/combat/rules/content/doubt.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/game/src/world/index.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/game/src/net/client.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/game/src/net/combat-driver.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/game/static/_headers
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/game/static/CREDITS.txt
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/game/static/favicon.svg
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/server/wrangler.toml
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/server/src/index.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/server/src/room.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/server/test/rooms-smoke.mjs
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/test/unit/contracts.test.js

## Open issues
- Combat engineer: implement createPartyCombat, combatStep, tickTimers, viewFor and outcome in game/src/combat/rules/index.js. Do the Doubt tick (before discard), death at HP < 1, tokens and co-op in your own wrappers. Do not call the engine's endTurn/playMonsterActions for the shared Warden. Engine caveats (in vendor NOTICE.md): Dungeon() mutates its module defaults, so always pass every option; card instance ids come from Math.random; never import vendor/.../backend.js, which calls api.slaytheweb.cards.
- Combat engineer: createLocalCombatDriver and the #combat UI are stubs. The open question about upgraded card names is answered: the engine's createCard(name, true) appends '+' itself ('Strike' becomes 'Strike+'), and books store base ids with upgraded:true.
- Systems engineer: applyBookAction, classifyFreeText, rememberedLineFor and BookStore.finishCombat are stubs. Marcus option ids are yours to define in core/rules/book.js. Cover, chapter, win and death screens, the HUD, dialogue and the deck screen are still to build; main.js only has a placeholder cover.
- Network engineer: server/src/room.js still needs the gate lobby, party combat (PLAY/END through combat/rules), new-book votes, sharing the 'friend struck Marcus' memory with every other player, a movement speed check, rate limits, storage.setAlarm for the 120 s seat expiry and the 10-minute idle close (it uses setTimeout now), and saving room state to DO storage. game/src/net/client.js (createNetClient) and net/combat-driver.js are stubs; probeRooms() and roomServer() already work.
- World engineer: world/index.js only renders the village and follows the camera. Movement, input, interaction prompts (emit EV.INTERACT), other players' avatars and the combat camera are still to build. The cover is drawn over the live village because world.show() is called at boot; change this if the cover should show the 3D book scene instead.
- Contract additions beyond the GDD: book.deck entries carry a uid; the HELLO message carries booksWritten so the room-created book can use the 'Have we met?' greeting. GDD 3.1 says {name, upgraded}; the code uses {id, upgraded}, where id is the STW base name. The Creative Director may want to update the GDD wording.
- Art: fonts stay on Google Fonts, loaded at runtime by main.js; an inline onload attribute would break the Pages CSP. I did not self-host them because the bridge's MIME table has no .woff2, and the bridge must not change. No art-kit gallery page is in the repo yet; add one under game/ if wanted.
- Deploy (not done): the production route game.dreamz.rest/room/* is commented out in server/wrangler.toml. The Worker and Pages must be deployed together when PROTOCOL_VERSION changes. Add Pages preview origins to ALLOWED_ORIGINS if needed. The _headers CSP allows only self, Google Fonts and wss://game.dreamz.rest.
- The main bundle is about 512 kB (134 kB gzip), mostly three.js. Vite warns above 900 kB, so this is fine for now. The vendored cards become 22 tiny lazy-loaded chunks because of the engine's dynamic imports; this is harmless.
- While cleaning up I ran pkill -f 'workerd serve' and pkill -f 'vite --host 127.0.0.1 --port 5173'. These would also stop any other workerd or matching Vite process the user had running on this machine.
