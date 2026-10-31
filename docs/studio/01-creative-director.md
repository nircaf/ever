# 01-creative-director report

I wrote /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/docs/GDD.md (about 580 lines), the single source of truth for the EVER MVP. It covers all 7 required areas, multiplayer included. The scope is 1 scene (Ashbrook clearing), 1 NPC, 4 stations, 1 enemy, 1 new curse card and 3 tokens. A full read takes about 10 minutes.

Key decisions:
1. **Loop.** Book cover ("Book N", with the remembered line quoted) -> Chapter page -> Ashbrook -> Ash Gate circle -> combat. A win shows "Chapter complete" (start a new book, or stay in an epilogue village). A death shows "The book closes" and starts a new book. Only two values persist, in localStorage key ever.v1.meta: booksWritten and rememberedLine. The doc gives the priority rules for picking the line. On later books Marcus has a small "Have we met?" greeting.
2. **NPC: Marcus Hale, the grieving blacksmith.** His secret is that he built the Ash Warden and his son Tobin died trying to stop it. Trust runs from -3 to +3 and decides deck outcomes:
   - -2: one Doubt curse and the anvil closes.
   - +1: one upgrade.
   - +2 after his confession: the Ember token.
   - +3: a second upgrade.
   There are 4 beats with exact options and trust changes. Free text has a pattern classifier, and each of the 8 intents (help, threaten, bribe, deceive, flatter, steal, attack, ask) has a deterministic rules row. Free text can raise trust by at most +2 per book. The AI contract is exact: the verbatim instructions, the input JSON, the response {reply, intent, trust in -1..1} and 7 validation steps. The model's trust value is only used for ask and flatter. All outcome lines come from the game. In co-op, the talking player's client calls the AI and the room re-validates.
3. **Deck changes.** The starter deck is the Slay the Web Classic deck (5 Strike, 4 Defend, 1 Bash), with 50 HP.
   - Lectern: choose 1 of 3 from Pommel Strike, Iron Wave, Sucker Punch, Thunderclap, Body Slam, Intimidate.
   - Well: remove a card OR take the Ward token.
   - Marcus's anvil: upgrades.
   - Grindstone: Whetstone token.
   - Crooked Shrine: the bad deal, Bludgeon plus 2 Doubts.
   The only new card is Doubt: unplayable, and you lose 2 HP per Doubt in hand at end of turn. Tokens are one-shot charms, at most one of each (so 3 max), all spent when the fight starts:
   - Ember: +1 energy on turn 1.
   - Ward: start with 8 block.
   - Whetstone: the Warden starts with Vulnerable at max(current, 2).
4. **Combat: the Ash Warden**, 82 HP, a fixed 4-step cycle: Cleave 12, Brace 8 + Block 10, Smother 6 + Weak, Ember Slam 20. I tuned it with a 20,000-fight simulation of a careful player who can see the intent:

   | Deck at the gate | Sim win rate |
   |---|---|
   | Starter deck only | 78% (humans should land near the 70% target) |
   | A good village run | about 100% |
   | One Doubt | 32% |
   | Shrine deal | 48% |
   | Two Doubts | 11% |

5. **Map.** About 64x64 units with coordinates for spawn (0,22), Well (0,0), Forge/Marcus (-13,0), Grindstone (-10,5), Lectern (13,3), Shrine (16,-14, hidden and never hinted) and Ash Gate circle (0,-22). It includes the discovery order, hint lines and a time budget. The visual identity section has a 9-color palette and card styling shared by both modes.
6. **Copy.** All strings for the title, chapter page, HUD, station panels, toasts, free text, combat, win and death screens, and the multiplayer screens.
7. **Multiplayer.**
   - Room codes are 5 characters with no ambiguous letters or digits. The host has no special powers after creating the room.
   - Seat tokens live in localStorage, with 120 s to reconnect to the same seat. Players can join mid-exploration; anyone arriving during a fight waits for the next one.
   - Stations, Marcus trust, deck, HP and tokens are per player. One shared memory: if anyone attacks Marcus, everyone else loses 1 trust.
   - The room validates every deck change, including distance to the station.
   - Combat turns are simultaneous. The Warden shows one intent per living fighter, offset by seat. Its block, Vulnerable and Weak are shared.
   - Warden HP is 82 / 184 / 280 / 374 for 1 to 4 players (simulated at about 85% party win). There is a 60 s turn timer once the first player ends their turn.
   - A player who dies loses only their own book, restarts at page one in the same room, and can't rejoin that fight; the Warden's HP stays the same. Disconnected players are skipped by the Warden. If every fighter falls, the Warden resets. A win completes the chapter for the whole room, and starting a new book together needs everyone's vote.

The doc ends with a 4-engineer split (World, Combat, Rooms, Book & Marcus) around one pure rules module that the room server also imports, plus an acceptance checklist.

The simulation scripts are in /private/tmp/claude-501/-Users-eleanorbleiberg-Library-Application-Support-Claude-scratch-workspaces-ebffec8e-3aba-41b5-93c2-d80c6ceb207f-3fb8c771-f8e2-47e7-b5cb-ff5a423aa4e3-scratch-2026-10-31-0c5ade/bfd7d364-c043-4864-aeed-5f4ea6b38006/scratchpad/sim.mjs (solo) and /private/tmp/claude-501/-Users-eleanorbleiberg-Library-Application-Support-Claude-scratch-workspaces-ebffec8e-3aba-41b5-93c2-d80c6ceb207f-3fb8c771-f8e2-47e7-b5cb-ff5a423aa4e3-scratch-2026-10-31-0c5ade/bfd7d364-c043-4864-aeed-5f4ea6b38006/scratchpad/coop2.mjs (co-op).

## Files
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/docs/GDD.md

## Open issues
- Technical Director: the vendored Slay the Web engine needs these changes. (a) Add a Doubt curse card (src/content/cards/doubt.js) and register it in cardIndex. (b) Add an 'unplayable' condition in conditions.js. (c) In endTurn, before discardHand, apply the Doubt tick of -2 HP per Doubt in hand. (d) endTurn checks death with currentHealth < 0; the GDD treats HP <= 0 as death, so change it to < 1. (e) Set player maxHealth to 50 and use a one-node dungeon for the Ash Warden. (f) Apply tokens after the combat state is created.
- Technical Director: the engine assumes one player per state. For co-op, the room must keep one Slay the Web state per player plus one shared Warden (HP, block, powers), and add 'one intent per fighter, offset by seat' targeting. That needs a small wrapper around takeMonsterTurn.
- Technical Director: pick and document the room URL (for example wss://game.dreamz.rest/room/<code>), the versioned message schema and how the client finds wrangler dev locally. The GDD only sets gameplay requirements: 5-character codes, 120 s seat reconnect, rooms closing after 10 minutes empty, and the room validating station distance to within 1 unit.
- Balance numbers come from a simulated near-optimal player who sees the enemy's intent, not from playtests. Expect humans to win about 5 to 10 points less. The co-op win rate drops off sharply with Warden HP (2-player: 188 HP gives 77%, 193 gives 58%), so playtest before changing the 184/280/374 table.
- The upgrade card name is shown with a '+' suffix by convention. Check how createCard(name, true) sets display names in the engine (Succube's upgrade renames itself, but that card is not in the MVP pool).
- Art Director: the palette and model descriptions in GDD section 5.1 and the character/enemy looks are a starting point. If the art department owns a separate style doc, align it with these hex tokens or note the differences.
- In co-op, AI free text can't be verified by the room. A modified client could always claim the 'help' intent; this is accepted because free-text trust gains are capped at +2 per book.
