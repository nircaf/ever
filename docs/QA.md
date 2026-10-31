# EVER: QA and integration report (MVP)

Owner: lead engineer (integration + QA). Date: 2026-10-31.
Build under test: `npm run build` output in `public/`, served by the local bridge (`EVER_NO_OPEN=1 EVER_PORT=1499 node bridge.mjs`), with a room server from `npx wrangler dev --config server/wrangler.toml --port 8797` (port 8787 was already taken by another session's wrangler, so it was left alone). The page was opened as `http://127.0.0.1:1499/?debug&rooms=http://127.0.0.1:8797`. Both servers were stopped afterwards.

## 1. Automated checks

| Check | Result |
|---|---|
| `npm install` | ok |
| `npm test` (vitest + bridge smoke) | **201 / 201** unit tests pass (12 files), **18 / 18** bridge checks pass |
| `npm run test:rooms` (new script: `server/test/rooms-integration.mjs` against a real `wrangler dev` on free ports) | pass: host, join, movement relay, fight with 2 players (Warden 184 HP), drop mid-fight, reconnect to the same seat with the same hand, round 2, bad frames, version mismatch, leave |
| `npm run build` | pass, main bundle 686 kB (195 kB gzip), no warnings |

## 2. Browser play-test

Done in the built-in browser pane against the production build. That pane was hidden, so `requestAnimationFrame` never fired and screenshots stayed frozen. I drove the page with a small QA helper injected at runtime: a `setTimeout`-based rAF shim, a walker that moves the player at legal speed, and keyboard events (E, Tab, Esc, 1-9). The helper is not part of the repo. I checked the results through the DOM and the debug handle. **The 3D rendering was not checked visually in this pass.** The world and combat teams already checked it in headless Chrome at 1280x760 and 390x844.

### 2.1 Solo loop (all pass)

- Cover -> Begin a new book -> chapter page (click to skip) -> Ashbrook. The HUD shows HP 50/50, Deck 10 and the hint "Walk into the village."
- Walking with W works (about 6 u/s).
- Every station was used through its real panel, with E to open:
  - **Lectern:** 3 seeded cards shown; took Sucker Punch -> deck 11, station marked used.
  - **Grindstone:** Whetstone token in the HUD slot.
  - **Shrine:** Bludgeon + 2 Doubt, with the toast copy from GDD 3.5.
  - **Well:** dropped a Doubt -> deck 13, well used (the Ward choice was tested in co-op).
- **Marcus**, every beat:
  - "I'm sorry" (trust 1) -> anvil upgrade of Bash (Bash+, gold rim; the "+" comes from CSS).
  - "I'll put it down" (trust 2).
  - Free text through **Try something else** (offline classifier, answers in character).
  - "Who made the Warden" (the confession) -> Ember token.
  - "It wasn't your fault" (trust 3) -> second upgrade (Bludgeon+).
  - "Then tell me how to beat it" (the tip).
  - Free text "I punch Marcus in the face" -> -8 HP, trust -3, +1 Doubt, toast, remembered line.
- Deck viewer (Tab) groups the cards with counts, upgraded cards first and the curse last. Esc closes it.
- **Gate:** walking into the circle opens "The Warden stirs. Begin the fight?" with Fight and Not yet. Fight starts combat.
- **Combat with the mutated deck and tokens:**
  - Ember: 4/3 energy on turn 1. Whetstone: Warden Vulnerable 2. Doubt tick logged "(-2 HP)".
  - Bludgeon+ hit for 54 on a Vulnerable Warden. Won in 3 turns.
  - **Deck after the fight was byte-identical to the deck before it**, and the tokens were spent.
- Win -> "Chapter complete" (book, turns, HP). booksWritten +1 and remembered line saved.
  - **Stay in Ashbrook** -> epilogue: Marcus has his final line, and the stations no longer open.
- **Death path:** new book -> straight to the gate -> only ending turns -> "The book closes" on turn 5 with the remembered line.
  - Begin a new book -> chapter page -> book N+1 at spawn with the starter deck, 50 HP, no tokens. Only meta carried over.
- Console: no errors in any tab during the whole session.

### 2.2 Combat never mutates the deck; deck changes are world-only

- In code: combat only reads the book (`createLocalCombatDriver({book})` / room `createPartyCombat`). Every deck change is a `BookAction` through `applyBookAction` (store in solo, room in co-op). `applyBookAction` refuses any action unless the book is `exploring` (or `marcus.talk` in the epilogue, plus the new `epilogue.stay`).
- The room refuses `act` while a player is fighting.
- In play: the deck was compared before and after a solo win and a co-op win (both players). Identical every time.

### 2.3 Co-op (2 tabs, real room server) (all pass after the fixes in section 3)

- **Host:** "Ada" hosts -> 5-character code (e.g. `6CSVM`) -> Enter Ashbrook. HUD shows the room chip, roster and Leave room.
- **Join:** "Bo" joins with the lowercase code -> seat 1, roster shows both. The host stays seated (this failed before fix 3.1).
- **Walking together:** each tab sees the other at the right place through `peerAt`, and position updates reach the room. No `fix` corrections at legal speed.
- **Different deck changes per player,** all room-validated:
  - Bo: well remove a Strike, grindstone Whetstone, lectern card.
  - Ada: lectern, shrine (2 Doubts), Marcus upgrades, Ember, well Ward.
  - Each player's book changed only their own deck.
  - Forged frames from the console: `shrine.take` from far away -> `err too_far`; `marcus.friendStruck` -> refused.
- **Host leaves mid-exploration:** the room keeps running with Bo (host migration not needed). Ada re-joins mid-exploration with the code as a new seat and a fresh book.
- **Gate lobby:** "0/2 ready" -> Ready -> "1/2" -> second Ready -> fight starts for both.
  - Warden 184 HP, Vulnerable 2 from Bo's Whetstone, Ada starts with Ward 8 Block and 4 energy from Ember.
  - Intents name their target ("-> Ada: Cleave 12 / -> You: Brace 8, Block 10").
- **Full round:** Bo plays and ends -> "Waiting for Ada..." with the 60 s timer -> Ada plays and ends -> the Warden hits each target with the right numbers (Weak and Block applied).
- **Disconnect mid-fight:** Bo's socket was force-closed. Bo shows `reconnecting`, and Ada sees Bo as AWAY. Ada ends her turn, and the Warden acts without Bo (Bo's HP unchanged).
- **Reconnect:** Bo comes back online -> status `open`, same seat 1, **same hand** (Defend, Strike, Strike, Pommel Strike, Defend), toast "You're back in the room."
- **Fight to a result:** the party won on round 5. Both got "Chapter complete" and both decks were unchanged.
- **Co-op epilogue:** Bo pressed Stay. Marcus can now be talked to ("It's done, then. Good.").
- **Reload with the same seat:** Bo reloaded the tab and joined the same code -> same seat, same book (epilogue). The seat token is kept per tab.
- **New-book vote:** Ada voted "1/2 ready". Bo, who had stayed, got the "Chapter complete" page back with the vote button. Bo voted, and both got a fresh book at page one in the same room.
- **Co-op death:** Ada fought on alone while Bo was AWAY and died -> "The book closes / Your friends read on" -> Begin a new book -> a fresh book in the same room.
- **Connection lost for good mid-fight:** Bo's reconnect could not complete -> back to the cover with the network line (it used to show a false death screen; fix 3.4).
- **Phone width (375x812):**
  - No horizontal scroll on the cover, village HUD or combat.
  - The hand wraps to 2 rows and the End turn button stays reachable.
  - HUD pills and the party roster no longer overlap (fix 3.6), and Leave room is reachable (fix 3.5).

## 3. Bugs found and fixed in this pass

1. **Two tabs in one browser could not both play** (`game/src/net/client.js`). Seat tokens were in localStorage under the room code, so the joining tab sent the host's token and took over the host's seat (the host's socket was closed with 4010). Seat tokens now live in **sessionStorage**, which is per tab and survives a reload. Tests that pass their own storage are unchanged. NETWORK.md was updated.
2. **The room's position correction (`mvs.fix`) was ignored** (`core/game.js`). The client now snaps with `world.teleport` when the room clamps it or respawns it at page one (the open issue from the network team).
3. **Marcus could not be talked to in the co-op epilogue.** A new book action, `epilogue.stay`, is allowed only on a `won` book and sets `epilogue` with no deck change. It is in `core/rules/book.js` with a unit test. The room passes it through as a new action type. Co-op "Stay in Ashbrook" now sends it.
4. **A dropped connection mid-fight showed "The book closes".** The leave also left a book stuck in `fighting`, so "Begin a new book" opened a village where no station worked. Now it goes to the cover with "Can't reach the room server." The death and win buttons fall back to solo when the room is gone.
5. **No way to leave a room on a phone.** `.ever-party__leave` was `display:none` under 640 px. It is shown now.
6. **On phones the HUD and the party roster overlapped** (the room chip sat on top of the token slots). Under 640 px the roster now sits below the HUD row.
7. **No curse indicator in the shipped HUD** (the world team's open issue). There is now a "Doubt N" pill in `core/ui/hud.js`, hidden at 0, in the curse colour.
8. **A player who stayed in the epilogue could never vote for a new book**, which blocked the party (the vote needs every connected seat). The win page now comes back when a friend votes.
9. **The combat log said "You is back."** after your own reconnect. It now skips your own away/back lines; the toast covers them.
10. **The `__ever` debug handle was always on.** It is now set only in dev builds or with `?debug` in the URL. Nothing in the game reads it any more: `main.js` passes `ui: 'core'` and the store to the world explicitly, and `game.js` calls `world.setNet(net)` on host/join/leave.
11. `package.json`: added `npm run test:rooms`.

Files changed: `game/src/main.js`, `game/src/core/game.js`, `game/src/core/rules/book.js`, `game/src/core/rules/book.test.js`, `game/src/core/ui/hud.js`, `game/src/core/ui/core.css`, `game/src/core/copy.js`, `game/src/net/client.js`, `game/src/combat/index.js`, `docs/NETWORK.md`, `package.json`, `docs/QA.md`.

## 4. Remaining issues (not fixed)

- ~~The 3D rendering was not visually checked in this pass.~~ Checked in the polish pass (section 5), at 1024x768 and 375x812.
- **Hello-timeout close (4408) is treated as fatal by the client.** If a reconnect socket opens but its hello is delayed for 10 s, the client gives up instead of retrying inside the 120 s window. I only hit this with an artificial outage. Network team: consider treating 4408 during `reconnecting` as retryable.
- **An AWAY fighter keeps a fight open.** If every connected fighter has fallen but one fighter is still AWAY, the room stays `fighting` until that seat expires (up to 120 s). The other players have new books but cannot start a new fight until then.
- **"Your friends read on"** is shown on a co-op death even when the only friend is AWAY. This is cosmetic.
- **Rejoining a room after a reload replays the chapter page** and teleports you to spawn until the room's position catches up. Harmless.
- **The co-op win screen's onStay with the room gone** (connection lost on the win screen) just returns to the village with a `won` book. This is an edge case.
- **The bridge AI path was not exercised.** AI detection is exact-origin `http://127.0.0.1:1455`, so on the QA bridge port 1499 the game ran fully offline, which is the expected hosted behaviour. The user's own bridge on 1455 was running and was not touched. The bridge client itself is covered by `ai.test.js` and the 18 bridge checks.
- **Toasts for peers' drop and back** were not seen in the DOM when checked. They had probably already expired (each lasts about 4 s) before my checks. The combat log does show "X lost connection."
- The earlier open issues from other departments stand (GDD copy "Connect AI" vs "Connect ChatGPT", the duplicate world UI in `world/ui.js`, the bundle size; the dark Warden is addressed in section 5). See the department reports.
- Not deployed (as instructed). Deploy steps are in `docs/NETWORK.md` section 6.

## 5. Polish pass (ship-review findings)

Verified on the production build served by the bridge on port 1497 (`EVER_NO_OPEN=1 EVER_PORT=1497 node bridge.mjs`, stopped afterwards), at 1024x768 and at 375x812 (mobile emulation). The browser pane was hidden, so frames were driven by a `setTimeout` rAF shim and CSS animations were switched off for screenshots. `npm test` (201 unit tests + 18 bridge checks) and `npm run build` pass.

### Major findings, all fixed

| Finding | Fix | Files |
|---|---|---|
| Card icons spilled out of the art square | `createIconRenderer` now fits an ortho frustum to the object's projected vertices (12% padding, square, centred) and renders at 2x. `.ever-card__art` is a flex box with `overflow: hidden`, and the `img` is height-fitted (a % max-height on a grid item never resolved). Checked: the image box sits inside the art box in the picker, deck viewer, lectern and combat hand. | `shared/style.js`, `shared/style.css`, `combat/combat.css` |
| Card text 7-9 px | Card base font is `max(12px, w * 0.083)`; description >= 11 px, type band >= 9 px, name >= 13 px (measured 11.04 / 9 / 13.2 px in the well picker). Deck grid cards are 140 px, picker/offer cards 150 px, picker panels widen to 660 px. Combat hand cards also get the floor (phones: 10-10.5 px on 100 px cards). Hovering or keyboard-focusing a hand card shows a 200-230 px preview above it (desktop only). | `shared/style.css`, `combat/combat.css`, `combat/index.js`, `core/ui/panels.js` |
| Pines hid the shrine | The three shrine pines moved behind and beside it, the big tree moved north-east of the lectern (17.4, -0.6), and the south-west house moved from (-6, -10) to (-10.5, -11), out of the combat shot and the gate view. `ASHBROOK` and `nav.js LAYOUT` stay equal (unit test). On top of that, houses and the big trees now fade to 22% opacity when they stand between the camera and the player, the station in range or the fight, or crowd the near edge of the frame (`updateOccluders` in the world, cloned materials so the kit's shared ones are untouched). | `shared/style.js`, `world/nav.js`, `world/scene.js`, `world/index.js` |
| Stray roof in the combat frame | The house moved (above); the combat shot and the gate prompt now show no roof. | same |
| Cover was not the 3D book | The cover now shows the closed 3D book (`makeBook`) on its table (`makeTable`) with a lit lantern and Tobin's hammer, built past the south edge of the village and lit by the same rig. Wide screens put the title page on the right and the book on the left; tall screens put the book above the page. "Begin a new book" opens the cover (600 ms page turn, camera pushes in) before the chapter page. A static paper "Opening the book..." card in `index.html` covers the first blank frames and is removed after the first frames (or after 4 s at most). | `world/index.js` (`setCover`, `openBook`), `core/game.js`, `core/contracts.js` (WorldApi typedef), `core/ui/core.css`, `index.html`, `main.js` |

### Minor findings

- **Picker hover clipping:** pickers get 14 px top padding and a smaller lift (-6 px, 1.03), so the first card is no longer clipped. Fixed.
- **Room code glyphs:** codes (host screen, HUD chip, join input) use the UI face (Figtree 800) with `lining-nums tabular-nums` and wider tracking, since Young Serif only has old-style figures. The alphabet already excludes O, 0, I and 1. Fixed.
- **Palette and readability:** grass is cooler and less saturated (`grass #5B8462`, `grassLight #6A9168`, `grassDark #4C7459`). The Warden body has a faint ash emissive. Marcus's apron is lighter (`#5E5B69`) and he no longer receives the forge roof's shadow. The signpost's blank boards are now three arrow boards: gold up the road (gate), ember west (forge), ward east (stone). The walk hint names the directions ("Forge west, stone east, gate north."). Fixed. Not done: the sky still does not show in the explore camera (the camera framing is unchanged).
- **HUD hint and prompts:** the hint now moves on (well, then forge "to the west", then "Still to see: ..." naming only the unvisited places, then the gate) instead of sticking on the forge line until Marcus's beat 2. The interact prompt is paper with an ink border. On phones the hint sits 12 px above the prompt (measured), and at 641-1240 px widths the hint drops under the HUD row so it no longer runs into the token slots. Token slots show a paper tip on hover, focus or tap ("Whetstone: the Warden starts Vulnerable."), and the grindstone and well panels state what their token does. The lobby toggle reads "Ready" then "Cancel ready" (quiet), and the line becomes "Waiting for friends... n/m ready". Fixed. The lobby change was not seen live (needs a room server); it is a small view change.
- **Combat feedback and phone:** damage numbers on the Warden rise from above its head in the 3D view (measured at the head, clear of the HP bar), with the old under-panel position as the fallback. Keyboard hints (the E on End turn and the card numbers) are hidden on coarse pointers. Party seats are 0.4 u further apart per seat. The portrait combat camera target moved 0.6 u left, so the Warden's arm is no longer cropped at 375 px. Fixed. A 4-player roster was not seen live.
- **Difficulty:** the Warden's numbers are unchanged (the room server shares the rules). The first turn of every fight now shows a combat-log tip: "Tip: Block wears off each turn. Play Defend before you end your turn."

### Bug found during the pass

- A first version of the hand preview referenced its element before it was declared, which threw when combat opened. Fixed before the final build. A full solo fight was then played through the real gate prompt to the end by a simple click bot (it lost, so the run ended on "The book closes"); no new console errors. The solo win screen was not re-run in the browser in this pass (the combat rules are unchanged and covered by the unit tests).

Files changed in this pass: `game/index.html`, `game/src/main.js`, `game/src/shared/style.js`, `game/src/shared/style.css`, `game/src/world/index.js`, `game/src/world/scene.js`, `game/src/world/nav.js`, `game/src/core/game.js`, `game/src/core/contracts.js`, `game/src/core/copy.js`, `game/src/core/rules/book.js`, `game/src/core/rules/book.test.js`, `game/src/core/ui/core.css`, `game/src/core/ui/hud.js`, `game/src/core/ui/panels.js`, `game/src/combat/index.js`, `game/src/combat/combat.css`, `docs/QA.md`, plus the rebuilt `public/`.

Still not covered: the AI path on :1455, a 4-player roster, the hosted domain, co-op win and death screens, and the co-op lobby after the label change (no room server was started in this pass).
