# EVER v2: Game Design Document (seeded runs, living world)

**EVER — Evolving Virtual Experiences & Reincarnation**
Owner: Creative Director. Status: v2 spec. This doc **extends** `docs/GDD.md` (the MVP spec). Where v2 replaces an MVP rule, `GDD.md` carries a "v2:" note pointing here; everything this doc does not mention (Marcus's story and beats, free-text intents, the MVP palette, copy tone, co-op seats and reconnect) still holds as written in `GDD.md`.

Look: `docs/ART_BIBLE.md` and `game/src/shared/`. Code contracts: `docs/TECH.md` (the Technical Director turns the data shapes sketched here into real schemas; if this doc and the schema disagree, raise it).

License unchanged: AGPL-3.0-or-later, combat built on Slay the Web (oskarrough/slaytheweb, commit a108c3e). World changes made by players are contributions to the same AGPL repo (see 14.7).

---

## 0. The pitch in seven lines

1. A run is still a **book**. A new book starts with a **seed** and **one card**.
2. The seed picks **three themes** and a **path**: 8 to 10 pages through Ashbrook (people to talk to, stations, fights), ending at the **Ash Gate**.
3. At every page the book can gain or change mechanics: new cards that never existed, upgrades, **items**, **curses**, tokens. Some are gifts, some are bargains.
4. NPCs (Marcus first) **make those changes up with the AI**, as data from a fixed library of building blocks. The game checks every one with a power budget and a quick balance simulation before it touches your book. Without AI, a seeded local generator makes them from the same blocks.
5. One-card start, 12 to 20 minutes later a deck that can beat a Warden scaled to your path.
6. **Win**, and your last choice becomes a small, permanent change to Ashbrook for everyone: a GitHub pull request opened by a bot, checked by tests and the balance sim, auto-merged, redeployed.
7. **Die**, and only a small echo follows you into your next book. The shared world does not change.

### 0.1 What changed from the MVP

| Area | MVP (`GDD.md`) | v2 (this doc) |
|---|---|---|
| Start of a book | 10-card Classic starter deck | **1 keepsake card** chosen by the seed (section 4) |
| Randomness | Lectern offer seeded per book, nothing else | **Shareable seed** decides keepsake, themes, path, enemies, offline offers (section 3) |
| Structure | Free roam, any order, 1 fight | **Path of 8–10 pages** in a fixed order, 3–4 fights (section 6) |
| NPCs | Marcus only, fixed outcomes | Marcus + 2 archetypes (Wayfarer, Keeper) who **offer generated changes** (section 10) |
| Deck changes | 4 stations + anvil, fixed content | Stations, moments, spoils; content generated from building blocks (sections 8, 9) |
| New systems | – | **Items** (3 slots), generated **curses**, generated **tokens**, spoils, Hearth |
| Enemy | Ash Warden 82 HP | Ash Motes, Cinder Hound, Iron Husk, **Ash Warden v2** scaled by path and themes (sections 7, 13) |
| After a win | Remembered line | **Last Page**: the run's final choice becomes a shared world change via an auto-merged PR (section 14) |
| After a death | Remembered line | Remembered line + **echo** for your next book only (section 15) |
| Save | No mid-book save | Book saved after every page, **pinned** to its engine and world edition (section 16) |
| Time | 8–12 min | **12–20 min** |

---

## 1. Words we use

| Word | Meaning |
|---|---|
| **Book** | One run. Starts at page one, ends in a win (Last Page) or a death (the book closes). |
| **Seed** | Short code that decides everything about a book that is not a player choice or AI output. |
| **Theme** | One of 8 flavors (Forge, Well, Briar, Ash, Lantern, Crow, Oath, Bargain). A book has 3: primary, secondary, shadow. |
| **Page / node** | One step of the path: a moment, a station, a fight, the Hearth or the Gate. |
| **Moment** | An AI-led NPC conversation that ends in an **offer**. |
| **Offer** | 1–3 proposed minor changes shown as cards; the player takes one or none. |
| **Minor change** | Anything that changes one book: card, upgrade, item, curse, token, removal, transform, path twist. Lives only in the book. |
| **Building block** | A named, engine-backed piece of mechanics (effect, trigger, condition, target, scaling, duration). The only vocabulary the AI and the generator may use. |
| **PP (power points)** | The budget unit. 1 PP is about 1 damage or 1 Block. |
| **Major change** | A change to the shared world, made after a win, shipped as a pull request. |
| **Edition** | The world content version (`world/` manifest number). Players see "Ashbrook, edition 14". |
| **Engine version** | The build of the game code. Players never see it except in error copy. |
| **Echo** | The small thing a death leaves for the same player's next book. |
| **Mark** | A sign of the player's hostility (attacked or robbed an NPC) that the final Warden carries. |

---

## 2. The loop

```
Cover ─► New book (seed) ─► Chapter page ─► Contents ─► page 1 ─► page 2 ─► … ─► Hearth ─► Ash Gate (final)
  ▲                                                       │  moments / stations / fights                │
  │                                                       └── HP 0 in any fight ─► The book closes ─► echo ┤
  │                                                                                                         │
  └─────────────── Last Page: final decision ─► world change sent ─► Chapter complete ◄──── win ◄──────────┘
```

### 2.1 Screens in order (new or changed in **bold**)

| # | Screen | What happens |
|---|---|---|
| 1 | Book cover | As MVP, plus **"Continue Book N"** if a book is in progress, and the **edition line** ("Ashbrook, edition 14 · What changed"). |
| 2 | **New book** | Seed field, Random, Today's page, live preview of keepsake, themes and page count. Begin. |
| 3 | Chapter page | Now names the themes and shows the seed (small). |
| 4 | **Contents** | The path as a table of contents. Shown once at the start (4 s or click), then on `C` / the Page pill. |
| 5 | Ashbrook | Walk to the current page's site (gold bookmark ribbon over it). Only the current page can be used. |
| 6 | **Moment** | Dialogue panel (MVP style) that ends in the **Offer** panel. |
| 7 | Station | MVP stations with v2 content; new station **Hearth**. |
| 8 | Combat | Slay the Web rules, skirmish / elite / final. After a skirmish or elite: **Spoils**. |
| 9a | **Last Page** | After the final win: choose the world change, see it sent, then Chapter complete. |
| 9b | The book closes | As MVP, plus the **echo** line. |

---

## 3. Seeds

### 3.1 Format

- **Seed code**: 8 characters from the room-code alphabet `BCDFGHJKLMNPQRSTVWXZ23456789` (28 symbols, no vowels, no 0/O/1/I). No vowels means a seed can never spell a word, so shared codes are always clean. 28^8 ≈ 3.8 × 10^11 seeds.
- **Shown** in two groups of four: `KQ7F-M2XB`. Input ignores case, spaces and dashes.
- **Share code** = edition + seed: `14-KQ7F-M2XB`. The edition prefix is optional; without it the current edition is used. The share button always copies the full form.
- **Word seeds**: anything else a player types (1–24 characters, e.g. `tobin`) is normalized (trim, lowercase, collapse spaces) and hashed (FNV-1a 64-bit, base-28, 8 chars) into a seed code. The panel shows "'tobin' becomes KQ7F-M2XB." Same word, same book, everywhere.
- **Today's page**: seed = hash of `daily:YYYY-MM-DD` (UTC). Everyone gets the same book that day. The cover button reads "Today's page".
- **Random**: 8 random symbols from `crypto.getRandomValues`.

No check digit: typing a seed shows the preview (keepsake, themes, page count) at once, which catches typos better than a checksum would.

### 3.2 What the seed decides

Every decision uses its own named random stream, `rng(seed, label)`, so changing how one thing is picked never shifts another (adding a theme later must not change every path).

| Label | Decides |
|---|---|
| `themes` | Primary, secondary and shadow theme (3 different of 8; 336 combinations) |
| `keepsake` | The starting card (one of the primary theme's two keepsakes) |
| `path` | Page count (8, 9, 10 at 30/45/25%), node order within the grammar, which stations, which archetype(s) |
| `site:<i>` | Which fight ring or moment site a page uses |
| `npc:<i>` | Archetype name and look variant, opening mood |
| `enemy:<i>` | Skirmish enemy and its theme variant |
| `offer:<i>:<j>` | Offline generator for offer j at page i (also the AI fallback) |
| `spoils:<i>:<seat>` | Spoils cards after fight i, per seat |
| `lectern` | Lectern offers |
| `warden` | Shadow twist intent, the Warden's opening tell line |
| `titles` | Page titles in the Contents |

### 3.3 What the seed does not decide

- Player choices (obviously), free text, trust.
- **AI output.** With the AI on, the moments' replies and offers differ between readers of the same seed. Without the AI, the whole book is reproducible: same seed + same choices + same typed requests = same offers. The result screen says which: "AI-voiced read" or "Fair read" (offline).
- The echo from your last death (section 15). A book with an echo says "with an echo" on its result; the setting **Clean reads** turns echoes off for seed races.
- The world edition. A seed is replayed exactly only on the same edition; that is why the share code carries it (section 16).

---

## 4. The one card (keepsakes)

A keepsake is the whole deck on page one, so it must win the first skirmish alone, be useful all run, and say what the book is about. Every keepsake is 1 energy and about **10 PP** (a common card is 7 PP; the keepsake gets 3 extra because it is the only card). Keepsakes **can be upgraded** and **cannot be removed** (the Well refuses: "Not that one. It's the only thing you came with.").

The seed picks one of the primary theme's two keepsakes.

| Theme | Keepsake | Type | Text (base / upgraded) | Icon (kit) |
|---|---|---|---|---|
| Forge | **Tobin's Hammer** | attack | Deal 7 damage. Gain 3 Block. / Deal 10. Gain 4 Block. | hammer, iron head |
| Forge | **Banked Coal** | attack | Deal 5 damage. Gain 1 Strength. / Deal 6. Gain 1 Strength. Gain 2 Block. | coal octahedron, ember |
| Well | **Well Rope** | skill | Gain 6 Block. Deal 4 damage. / Gain 8 Block. Deal 6 damage. | rope coil (torus), wood |
| Well | **Cold Water** | attack | Deal 5 damage. Gain 3 Block. Draw 1 card. / Deal 7. Gain 4 Block. Draw 1. | water drop, ward |
| Briar | **Thorn Sprig** | attack | Deal 3 damage. Apply 3 Poison. / Deal 4. Apply 4 Poison. | thorn sprig, pine + moss |
| Briar | **Bramble Coat** | attack | Deal 5 damage. Gain 2 Regen. / Deal 7. Gain 3 Regen. | leaf over shield |
| Ash | **Mourning Cut** | attack | Lose 1 HP. Deal 11 damage. / Lose 1 HP. Deal 15 damage. | sword, ash blade |
| Ash | **Grave Dust** | attack | Deal 6 damage. Apply 1 Weak. / Deal 8. Apply 2 Weak. | ash cloud (icos), haze |
| Lantern | **Guiding Light** | attack | Deal 5 damage. Gain 4 Block. Draw 1 card. / Deal 6. Gain 5 Block. Draw 1. | lantern, lit |
| Lantern | **Spark of Hope** | skill | Gain 5 Block. Deal 5 damage. Next turn draw 1 card. / Gain 7 Block. Deal 6. | gold spark (bolt) |
| Crow | **Crow's Beak** | attack | Deal 6 damage. Apply 1 Vulnerable. / Deal 8. Apply 2 Vulnerable. | feather + beak cone, ink |
| Crow | **Black Feather** | attack | Deal 4 damage. Apply 1 Weak and 1 Vulnerable. / Deal 6. Apply 1 Weak, 2 Vulnerable. | feather, ink |
| Oath | **Sworn Blade** | attack | Deal 5 damage. Gain 5 Block. If you haven't lost HP this fight, gain 3 more Block. / Deal 7. Gain 6 Block. Same condition, 3 more Block. | sword over bell |
| Oath | **Bell of Vows** | skill | Gain 8 Block. Deal 3 damage. / Gain 10 Block. Deal 5 damage. | bell, slate |
| Bargain | **Crooked Coin** | attack | Deal 9 damage. Lose 1 HP. / Deal 12. Lose 1 HP. | coin, gold |
| Bargain | **Pawned Ring** | attack | Deal 6 damage. Gain 3 Block. Deal 3 more for each curse in your deck. / Deal 8. Gain 4 Block. Deal 3 more per curse. | ring (torus), gold |

Rule: every keepsake deals damage, so a one-card book can always kill an Ash Mote (16 HP) in 3 turns.

---

## 5. Themes

A book has a **primary** theme (flavors about half of all offers, picks the keepsake, gives the Warden its aspect), a **secondary** theme (about 30% of offers) and a **shadow** theme (flavors curses, bargains, and the Warden's twist). The remaining ~20% of offers come from the shared global pool (cards and items that players added to the world, section 14).

| Theme | Color (palette) | NPC flavor and words | Mechanics it leans on | Its curse | Warden aspect (if primary) | Warden twist (if shadow) |
|---|---|---|---|---|---|---|
| **Forge** | ember, iron | craft, heat, debts, hammers; Marcus at his most open | big hits, Strength, upgrades, Block from attacks | **Slag**: costs 1, does nothing, exhausts | **Heart-coal**: after each Ember Slam it gains 1 Strength | Smother becomes **Spit Slag** 7 damage + adds a Slag to your discard |
| **Well** | ward, slate | memory, letting go, cold water, the deep | Block, draw, removal, cheap skills | **Undertow**: unplayable; when drawn, discard 1 random card | **Undertow**: Smother also makes you discard 1 random card | Smother becomes **Drag Down** 5 damage, you draw 1 fewer next turn |
| **Briar** | moss, pine | the wood creeping in, patience, growth | Poison, Regen, effects that grow per turn | **Bramble**: unplayable; when you play an attack, take 1 damage | **Thorned**: 2 Thorns (you take 2 damage per attack card you play) | Smother becomes **Choke** 4 damage + 2 Poison on you |
| **Ash** | ash, doubt | grief, Tobin, things burned down, giving up something | lose HP for power, exhaust, curses that pay off | **Mourning**: unplayable; end of turn in hand lose 1 HP; if exhausted gain 1 Strength | **Shroud**: starts the fight with 15 Block | Smother becomes **Ash Fall** 9 damage, ignores Weak |
| **Lantern** | gold, window | hope, guidance, light in windows, being seen | draw, energy, tokens, items | **Gutter**: unplayable; when drawn, lose 1 energy | **Glare**: Brace gives 6 more Block | Smother becomes **Blind** 6 damage + you can't see its next intent |
| **Crow** | ink, haze | secrets, omens, the future, birds on the gate | Weak, Vulnerable, damage per debuff, seeing intents | **Ill Omen**: unplayable; at fight start gain 1 Vulnerable | **Omen**: Cleave also applies 1 Vulnerable | Smother becomes **Peck** 3 damage × 3 |
| **Oath** | slate, paper | promises, vows, honor, keeping your word | conditional payoffs ("if you didn't…"), Block that becomes damage | **Broken Vow**: unplayable, can only be removed by keeping a promise (section 12) | **Vowbound**: heals 6 HP each time it uses Brace | Smother becomes **Judgement** 7 damage, +4 per curse in your deck |
| **Bargain** | gold, doubt | deals, prices, the Crooked Shrine, the Wayfarer | costs and payoffs, sealed offers, scaling with curses | **Debt**: unplayable; when a fight ends, lose 3 HP | **Collector**: +6 max HP per curse in the party's decks at fight start | Smother becomes **Collect** 5 damage + lose 1 random token |

How themes reach content:
- **NPCs**: the theme words and the NPC's theme mood go into the AI input and into the offline opening-line tables (each archetype has one opening line per theme).
- **Generated cards**: the generator draws block templates with theme weights (Forge favors damage/Strength templates 3:1, etc.); names come from the theme lexicon (section 10.6); icon props default to the theme's props.
- **Final fight**: primary theme gives the aspect, shadow theme replaces Smother with the twist (same damage budget). The gate prompt names both.
- **Look**: the chapter page band and the Contents ribbon use the primary theme's palette color. The world itself does not recolor (ART_BIBLE rule 1 stands).

---

## 6. The path

### 6.1 Node types

| Type | What | Uses site | Can be skipped |
|---|---|---|---|
| `marcus` | Marcus's moment (always page 1) | forge | no |
| `moment` | Archetype moment: **Wayfarer** or **Keeper** | moment site | yes ("Walk on") |
| `station` | Lectern, Well, Grindstone or Crooked Shrine | their MVP sites | yes ("Turn the page") |
| `skirmish` | Small fight: Ash Motes or Cinder Hound | fight ring | no |
| `elite` | Iron Husk | fight ring or shrine clearing | no |
| `hearth` | Rest and mend (new station) | Road Fire, or the forge if lit | yes |
| `final` | Ash Warden v2 | Ash Gate | no |

### 6.2 Grammar

```
path    := ACT_I  TURN  ACT_II  hearth  final
ACT_I   := marcus  shuffle(lectern, skirmish)  [station]           3–4 nodes
TURN    := moment                                                   1 node
ACT_II  := shuffle( [skirmish], station, [moment] )  elite          2–4 nodes
```

Constraints (the generator re-rolls the `path` stream until all hold; tests check 10,000 seeds):

1. Page 1 is Marcus. The one-card start always gets a moment before its first fight.
2. The Lectern is page 2 or 3. The first skirmish is page 2, 3 or 4.
3. No two fights on adjacent pages. The elite is always the page right before the Hearth.
4. Fights: exactly 1 elite and 1 final, 1 or 2 skirmishes (so 3–4 fights).
5. Moments: Marcus plus 1 or 2 archetypes, each archetype at most once.
6. Stations: Lectern exactly once, Hearth exactly once (page L-1), Well / Grindstone / Shrine at most once each. The Shrine appears only if Bargain or Ash is one of the themes, otherwise with 25% chance.
7. **Removal guarantee**: if the path has no Well, the Keeper (if present) or the Hearth must offer removal.

The `path` stream picks L first, then fills the grammar to exactly L nodes. Lengths: L = 8 (3 fights), 9, 10 (both 3 or 4 fights). Example L = 9: `Marcus · Lectern · Skirmish · Keeper · Grindstone · Skirmish · Iron Husk · Hearth · Ash Gate`.

### 6.3 Using and extending Ashbrook

v2 stays in the 64 × 64 Ashbrook clearing. No new zone is needed: the path gives the village an order. The world team adds **named anchor sites** (positions are proposals; the world engineer may move them for camera and navigation, keeping them in `nav.js LAYOUT`):

| Site | Position (x, z) | Used for | Kit pieces |
|---|---|---|---|
| Forge (Marcus) | MVP | `marcus`, `hearth` when lit | MVP forge |
| Lectern, Well, Grindstone, Shrine, Gate | MVP | stations, final | MVP stations |
| **Road Fire** | (4, 16) | `hearth` | `makeCampfire`, two log benches (boxes) |
| **Wayfarer's Cart** | (-4, 11) | `moment` Wayfarer | cart (boxes, 2 six-sided wheels, paper canvas wedge), `makeLantern` |
| **Keeper's Bench** | (7, -9) | `moment` Keeper | stool + lantern by the east house |
| **Ring S** south meadow | (-14, 16) | skirmish | ash ground tile (`makeGroundTile` ash), ember sparks |
| **Ring E** east meadow | (22, 9) | skirmish | same |
| **Ring W** wood edge | (-22, -8) | skirmish, elite | same |
| **Ring NE** shrine clearing | (12, -18) | elite | same, near the shrine |

A fight ring is an ash patch that appears (fade in, 0.6 s) only when its page is current. The fight uses the same camera trick as the MVP gate: the camera eases to a fixed shot of that ring (`COMBAT_STAGE` gets one entry per ring). Marked anchors (section 14.3) are reserved for world-change props.

**Wayfinding**: the current page's site has a **gold bookmark ribbon** (a thin gold box strip, slow sway) floating 3 u above it, and the hint line names it with a direction ("Next: the Margin Stone, east."). Done pages are dim (`setUsed(true)`); future pages show nothing, so the village stays calm. Stations and NPCs that are not the current page answer with one line ("Marcus nods at you. Later." / "The well is still. Not yet.").

### 6.4 Time budget (target 12–20 min)

| Piece | Minutes |
|---|---|
| Cover, seed, chapter, contents | 0.75 |
| Marcus moment | 2.0 |
| Archetype moment | 1.5 each |
| Station | 0.5 each |
| Skirmish (2–3 turns) | 1.25 each |
| Elite (4 turns) | 2.5 |
| Hearth | 0.5 |
| Final (6–7 turns) | 4.0 |
| Spoils screen | 0.3 per fight |
| Walking between pages | 0.25 per page |

L = 8: about **16 min**; L = 10: about **19 min**; a fast reader skipping talk: about **12 min**.

### 6.5 Between pages

- HP carries between fights. Max HP 50. No healing after skirmishes except items and the Hearth.
- After a skirmish: **Spoils**, choose 1 of 3 cards (rarity by page, section 9.3) or "Leave them" (heal 4 HP).
- After the elite: Spoils is **1 of 2 items** or 1 of 3 cards.
- **Hearth**: one of: Rest (heal 30% of max HP, rounded down = 15), Temper (upgrade a card), Burn a curse (only if you hold 2 or more curses). If Marcus's trust ended at +2 or more, the Hearth is at his lit forge and Temper upgrades **two** cards at trust +3 ("One more. For Tobin.").
- The book is saved after every page (section 16).

---

## 7. Fights

All numbers are solo. Co-op HP multipliers in 17.6. First-pass numbers from a quick design sim (section 23); the Technical Director's balance simulator on the real engine is the authority and may move them by up to 15% without asking; larger moves come back to me.

| Enemy | Where | HP | Intent cycle (fixed, no random) | Look (kit) |
|---|---|---|---|---|
| **Ash Motes** | first skirmish | 16 | Flick 4 · Flick 6 · Smoulder 3 + Weak | three floating ember octahedra in a loose triangle, one HP bar ("a swarm") |
| **Cinder Hound** | second skirmish (a book with one skirmish meets Motes on pages 2–3, the Hound on page 4) | 32 | Bite 7 · Snarl 5 + Vulnerable · Lunge 10 | low box body, cone snout, ember cracks, ash-cone tail; silhouette: long and low |
| **Iron Husk** | elite | 52 | Guard 7 + Block 8 · Rake 13 · Rust 6 + Weak + Vulnerable · Crush 16 | 2 m Warden-kin, one arm ends in a hammer head, no coal (cold cracks, `ash`); top-heavy like the Warden but half height |
| **Ash Warden v2** | final | 120 (section 13) | Cleave 14 · Brace 9 + Block 12 · Smother 7 + Weak · Ember Slam 23 | MVP Warden |

Shadow theme can re-skin a skirmish enemy with an equal-budget intent swap (Briar Hound: Snarl applies 2 Poison instead of Vulnerable). Max one re-skinned enemy per book.

---

## 8. The building blocks (design library)

Everything the AI and the offline generator may produce is **data made only from these blocks**. The game renders all rules text from the data; the AI never writes rules text (it only supplies a name and a flavor line). Each block has a fixed PP cost used by the budget check. New blocks only arrive through reviewed world changes (14.2, kind 7).

### 8.1 Blocks

**Effects** (what happens)

| Block | Params | PP | Engine backing |
|---|---|---|---|
| `damage` | n, hits 1–3, target | 1 per damage (+1 per extra hit) | card `damage`, adapter repeat |
| `block` | n | 1 per Block | card `block` |
| `draw` | n 1–3 | 3 each | `drawCards` |
| `energy` | n 1–2, this turn | 5 each | `addEnergyToPlayer` |
| `heal` | n (in fight) | 1.5 each | `addHealth` |
| `power` | kind (vulnerable, weak, strength, regen, poison, thorns), n, target | vuln/weak 3 per stack; strength 5; regen n(n+1)/2 × 0.8; poison n(n+1)/2 × 0.8; thorns 2 | `setPower` / powers; **thorns** is new (adapter) |
| `loseHp` | n (self) | -1 each | `removeHealth` |
| `damageFrom` | block / vulnerable / weak, multiplier | estimated per page by the sim | `dealDamageEqualTo*` |
| `addCard` | card ref, pile (hand, draw, discard) | value of that card (curses negative) | `addCardToHand` / adapter |
| `cleanse` | – | 3 | `removePlayerDebuffs` |
| `exhaustSelf` | – | positive part × 0.75 | adapter |
| `delayed` | effect, next turn | effect × 0.8 | adapter |

**Out-of-combat effects** (items, moments, station results only)

`maxHp ±n` (2 PP each), `healNow n` (0.5 each), `upgrade` (chosen / random card), `remove` (chosen card), `transform` (card → random card of the same rarity and theme), `gainCard`, `gainItem`, `gainToken`, `gainCurse`, `ripen` (this card becomes another card at the next Hearth), `pathTwist` (change a later page's content, e.g. "the Lectern will show 4 cards").

**Triggers** (items, curses, powers): `fightStart`, `turnStart`, `turnEnd`, `onPlay(type)`, `firstCardEachTurn`, `onDraw(self)` (curses), `onHpLoss`, `everyNthTurn(n 2–4)`, `fightWon`, `pageEnter`.

**Conditions**: `hpBelow(pct)`, `handHasCurse`, `enemyHas(power)`, `cardsPlayedThisTurn ≥ n`, `deckSize ≤ n`, `turn = n` / `turn ≥ n`, `energyLeft ≥ n`, `noAttackThisTurn`, `notDamagedThisFight`, `firstTimeThisFight` (this card's first play in a fight).

**Targets**: `enemy`, `allEnemies`, `self`, `ally` (co-op: lowest-HP other fighter; solo: self), `party` (co-op only, items only).

**Scaling** (always with a cap ≤ 5): per curse in deck, per item equipped, per card played this turn, per turn number, per 10 missing HP, per debuff stack on the enemy.

**Durations**: instant, this turn, next turn, this fight, n turns (1–3), next fight (tokens), rest of the book (items, curses, maxHp).

**Card frame**: type (attack, skill, power, curse), energy 0–3, target, rarity, exhaust, unplayable (curses only), upgrade delta (numbers +~30%, or energy −1).

### 8.2 Budgets

| Thing | Budget |
|---|---|
| Common card | 6 × energy + 1 PP (0-cost: 2) |
| Uncommon card | 6 × energy + 3 (0-cost: 4) |
| Rare card | 6 × energy + 5 (0-cost: 6) |
| Keepsake | 10 at 1 energy |
| Upgrade | +3 PP, or energy −1 |
| Item | value per average fight (6 turns): common 8, uncommon 12, rare 16 |
| Token | 6–10, one fight |
| Curse | −4 (mild) to −10 (severe) per fight |
| Bargain (good + cost) | good part up to 1.5 × its band; cost must take back at least half of the excess |
| Sealed offer | net ≥ +4 PP, may include one curse |

Conditions multiply the gated effect by a likelihood the sim measures per page (first guesses: `firstCardEachTurn` 0.9, `hpBelow(50)` 0.4, `noAttackThisTurn` 0.35, `notDamagedThisFight` 0.3).

**Hard caps** (checked before the sim, no exceptions):
- A card: ≤ 30 damage total, ≤ 25 Block, ≤ 3 draw, ≤ 2 energy, ≤ 3 stacks of any power applied.
- A card that gives energy and draw must exhaust.
- No trigger may add or copy cards into the hand on `onPlay` (no loops). `everyNthTurn` n ≥ 2.
- Scaling cap 5. Max HP stays in 20–80. Out-of-Hearth healing ≤ 30 HP per book.
- Curses: tick damage ≤ 2 per card per turn. A player holds at most **3 curse cards**; a 4th curse becomes "−4 max HP" instead.
- Items: no permanent +1 energy per turn except rare and with a drawback; no effects on other players (co-op `party` items are v2.1).

### 8.3 Balance check (what "passes" means)

For every candidate the game runs a quick sim (target under 300 ms in the browser, a few hundred fights): add it to the **three reference decks for its page** (early: keepsake + 1–2 commons; mid: 5 cards; late: 8 cards and 1 item) against the page's reference enemy (Motes, Husk, Warden v2). Pass bands for the change in sim win rate:

| Offer kind | Must land in |
|---|---|
| Common | 0 to +5 points |
| Uncommon | 0 to +8 |
| Rare / item | 0 to +12 |
| Bargain | −5 to +12 |
| Curse | −20 to −3 |
| Global pool (major change) | 0 to +6 against the full-run reference, stricter caps (14.4) |

And for all: the late reference deck must never kill the Warden at full HP in one turn, and average fight length must stay ≥ 3 turns. Fail → the offer is replaced from the offline stream for the same slot.

---

## 9. Minor changes

### 9.1 Kinds

| Kind | Example | Notes |
|---|---|---|
| **New card** | "Quenched Edge" | Built from blocks, rarity, art spec. Goes into the deck. |
| **Upgrade** | Tobin's Hammer+ | Existing card, upgrade delta from 8.1. An NPC may also offer a **themed upgrade** (a new upgrade path: "Tobin's Hammer, banked") within the +3 PP budget. |
| **Item** | "Wayfarer's Lantern" | Section 11. |
| **Curse** | Doubt, Slag, Undertow | Section 12. |
| **Token** | Ember, Ward, Whetstone, or a generated one | One-shot, next fight, max 3, one of each kind. |
| **Removal** | "Drop Strike in the well" | Never the keepsake. |
| **Transform** | "The Keeper reshapes Strike into…" | Random card of same rarity from the book's themes, seeded. |
| **Ripening** | Green Apple → Red Apple at the Hearth | Shown on the card ("Ripens at the Hearth into …"). |
| **Path twist** | "The Lectern will show four cards" | Changes a later page of this book only. In co-op, shared (17.3). |

### 9.2 How many per book

| Source | Count (L = 9) | What you pick |
|---|---|---|
| Marcus | 1 | 1 of 1–3 offers (always at least one new card, since you hold one) |
| Archetype moments | 1–2 | 1 of 1–3 offers each |
| Lectern | 1 | 1 of 3 cards (book themes + global pool) |
| Well | 0–1 | remove a card, or the Ward token |
| Grindstone | 0–1 | upgrade a card, or the Whetstone token |
| Crooked Shrine | 0–1 | a rare card + 2 Doubt (MVP deal, rare now generated) |
| Spoils | 2–3 | 1 of 3 cards (elite: 1 of 2 items) |
| Hearth | 1 | heal, upgrade, or burn a curse |
| **Total** | **8–11 changes** | |

Expected deck at the gate: **6–9 cards** (keepsake + 5–7 gains − 0–1 removals), **1–3 upgrades**, **1–2 items**, **0–2 curses**, 0–3 tokens.

### 9.3 Rarity and the power curve

Rarity odds for generated cards, by page:

| Pages | Common | Uncommon | Rare |
|---|---|---|---|
| 1–3 | 75% | 22% | 3% |
| 4–6 | 55% | 35% | 10% |
| 7+ | 40% | 40% | 20% |

Trust with the NPC moves one band (Trusting: one step rarer; Cold: one step commoner).

Why a one-card start works: you draw 5 and have 3 energy, so the **first four cards you add are always in your hand**; every gain early is pure power. After about 6 cards, each new card competes for a slot, so quality and removals start to matter. A curse in a thin deck is drawn almost every turn, which is why curses hurt more in v2 and why removal is guaranteed (6.2 rule 7) and Burn a curse exists.

Target shape (careful play):

| After | Deck | Can it beat |
|---|---|---|
| Page 1 (Marcus) | 2 cards | Ash Motes easily (lose ~4 HP) |
| Act I | 3–5 | Cinder Hound (lose 5–10 HP) |
| Elite | 6–8 + 1 item | Iron Husk (lose 8–15 HP) |
| Hearth | 7–9, 1–3 upgrades | Warden v2 about 3 times in 4 |

### 9.4 Good, bad, and fair

Target mix of **accepted** changes over many books: about **70% gifts**, **20% bargains**, **10% bad** (curses and costs).

The fairness rule: **no unearned pure-bad change**. Every bad change is one of:
1. **Chosen**: a visible cost on an offer you took (bargains, the Shrine).
2. **Earned**: you were hostile (attacked, stole, lied and got caught) or let trust fall to Cold.
3. **Announced**: a sealed offer's curse (sealed offers are labeled "Sealed: may hold a curse", and their net value is still ≥ +4 PP).

The AI may suggest a twist; the validator rejects any negative effect that is not tied to one of these three.

### 9.5 From proposal to book (design view of the pipeline)

1. Source: AI proposal (bridge on, page served from :1455) or offline generator.
2. Parse: one JSON object; unknown fields dropped.
3. Shape: only library blocks and enum values; numbers rounded and clamped to block ranges.
4. Budget: the **game** computes PP (any PP the AI claims is ignored) and checks the band and hard caps.
5. Sim: section 8.3.
6. Text: name and flavor sanitized (section 20); rules text rendered by the game from the data; art spec checked against the icon enum.
7. Show the offer. Only after the player takes it does it enter the book, as data, saved with the book (a few hundred bytes per change; a full book stays under ~8 KB).
8. Co-op: the room runs steps 2–6 again (same deterministic sim seed) before applying.

Any failed offer is swapped for the offline offer of the same slot. The player sees no error, only (once per book) "Some offers were written by the local script."

---

## 10. AI-led moments

### 10.1 Flow

```
arrive ─► opening line ─► exchange 1 ─► exchange 2 ─► (exchange 3) ─► OFFER ─► take one / take nothing ─► parting line
                 options ×3 + "Try something else" (free text)        ▲
                 "What can you offer me?" (from exchange 2 on) ───────┘
```

1. **Opening**: an authored line per NPC × primary theme (no AI call; fast and safe).
2. **Exchanges** (up to 3): three option buttons (authored per beat) plus **Try something else** (free text, 120 characters). Replies move trust with the MVP rules (`GDD.md` 2.2–2.4: 8 intents, rules table, +2 free-text cap), per NPC.
3. v2 adds a 9th intent, **`request`**: the player asks for something specific ("can you make my hammer burn?"). No trust change. The request text steers the next offer (AI: passed in as `request`; offline: keyword map, 10.6).
4. **Offer**: opened by "What can you offer me?" (shown from exchange 2) or automatically after exchange 3. The NPC says one line, then the Offer panel shows the offers.
5. **Take one** or **Take nothing**. Some offers carry a **cost** (shown on the card: "Costs: lose 5 max HP"), some are **Sealed** (face down until taken), some are **With a twist** (a shown delayed effect: ripening, a path twist, a promise).
6. **Parting line**, page done.

Offer count and quality by trust at the time of the offer:

| Trust | Offers | Shape |
|---|---|---|
| Cold (−3, −2) | 1 | "Take it and go": a bargain or a curse with a bonus attached. Or nothing at all after an attack. |
| Wary, Guarded (−1, 0) | 2 | commons, one may carry a cost |
| Warm (+1) | 2 | rarity by page |
| Trusting (+2, +3) | 3 | one band rarer, one may be an item |

AI calls per moment: one per free-text exchange (as MVP) plus **one** for the offer. About 6–10 calls per book. Model stays `gpt-6-luna`, low reasoning effort (the bridge already does this).

### 10.2 Marcus in v2

Everything in `GDD.md` section 2 still holds (profile, secret, trust, beats, free text, AI reply validation, remembered lines), with these changes:

- He is **always page 1**. With one card in hand, his first offer always includes at least one **new card** ("his work"), not only upgrades.
- Beat 4 ("Can you work on my cards?") now opens the **Offer panel**, Forge-weighted (book themes still mix in). At trust +1: 2 offers. At +2: 3 offers. The Ember token stays the gift at +2 after the confession, and goes into the token slots for the next fight.
- Trust −2: Doubt as before. Attacking him: as before, and the book gains a **Mark** (section 13).
- How he ends the moment carries forward: trust ≥ +2 lights the forge, which **becomes the Hearth** (6.5); trust +3 makes that Hearth temper two cards.
- With the AI, Marcus's offer call uses the Forge voice and his `knows` list; his offers may be named after Tobin, the forge, the old lord. Offline, his lexicon is the Forge lexicon plus a short Marcus list ("Tobin's", "Hale", "Cold", "Heart-coal").

### 10.3 Archetype 1: the Wayfarer

| | |
|---|---|
| **Who** | A traveling seller who parks a two-wheeled cart on the south road. Seeded name from: Ferrin, Oda, Tamsin, Bram, Ilse, Corwin, Mabry, Juno. |
| **Look (kit)** | `makeCharacter({body: 'haze', accent: 'gold', hat: 'hood', holding: 'lantern', scale: 1.0})`, a gold sash (thin box), the cart from boxes and two 6-sided wheels, a paper canvas wedge. Silhouette: the hood plus the cart's square top. |
| **Personality** | Cheerful, quick, honest about prices, loves a fair deal. Dislikes theft and pity. Threats amuse them. |
| **Speciality** | Items, bargains, tokens, sealed offers. **Always one Sealed offer.** |
| **Prices** | There is no gold. The Wayfarer takes HP, max HP, a card from your deck, a token, or a promise (Oath books). |
| **Beats** | 1 "Fair evening. Buying or selling?" · 2 "Everything has a price. Most of them are small." · 3 (trust +1) "Between us: the road north eats people. This might help." |
| **Free-text rules** | As Marcus, except: bribe 0 trust ("No coin in this village, friend. Try something else."), flatter 0, help +1, steal −2 and −6 HP and the cart closes, attack: Mark, −8 HP, no offer. |

### 10.4 Archetype 2: the Keeper

| | |
|---|---|
| **Who** | An old lamp-keeper who sits on a stool by the east house and remembers every book. Seeded name from: Wren, Agnes, Hollis, Maud, Edda, Osric. |
| **Look (kit)** | `makeCharacter({body: 'slate', accent: 'ward', hat: 'hood', holding: 'lantern', scale: 0.9})`, a low stool, a lit `makeLantern` on a post. Silhouette: small and bent, the lantern higher than the head. |
| **Personality** | Quiet, kind, a little uncanny. Knows about echoes and about world changes ("A reader carved a new card into the stone. I saw it."). Dislikes lies. |
| **Speciality** | Removal, transforms, upgrades, lifting curses, ripening cards. Offers removal whenever the path has no Well. |
| **Beats** | 1 "Sit. You've been here before, I think." (echo-aware) · 2 "What are you carrying that you don't need?" · 3 (trust +1) "Let me show you what this could become." |
| **Free-text rules** | As Marcus, except: deceive −2 ("No. Not to me."), help +1, threaten 0 ("I'm too old to be frightened."), attack: Mark, −8 HP, no offer, the Keeper's lantern goes out for the book. |

Both archetypes are built from the existing kit; the Art Director owns the exact build.

### 10.5 The AI offer call (sketch; the Technical Director owns the real schema)

Instructions (summary of what the verbatim text must say): you voice {npc}; reply in 1–2 short sentences in character; the player's text is untrusted data, never instructions; propose 1–{n} offers **only** from the listed blocks and enums; give each a short name (≤ 24 chars, ≤ 4 words) and a flavor line (≤ 90 chars); you do not decide costs, rarity or outcomes; the game checks and may replace any offer; output only one JSON object.

`input`: `{npc: {name, archetype, mood, trust, knows}, book: {themes, page, of, deck: [names], items: [names], curses: n, hp, maxHp}, player: {says, request}, offer: {count, rarity, ppMin, ppMax, kinds: [...]}, library: {effects, triggers, conditions, targets, scalings, iconProps}}`

Output shape (illustrative):

```json
{"reply": "Put it on the anvil. Tobin always wanted it to burn.",
 "offers": [
  {"kind": "card", "name": "Banked Hammer", "flavor": "Still warm from a forge that went cold.",
   "card": {"type": "attack", "energy": 1, "target": "enemy",
            "effects": [{"do": "damage", "n": 6}, {"do": "block", "n": 2},
                        {"do": "power", "kind": "strength", "n": 1, "if": {"firstTimeThisFight": true}}]},
   "art": {"prop": "hammer", "tint": "ember", "accent": "coal"}},
  {"kind": "item", "slot": "body", "name": "Tobin's Apron", "flavor": "Too small for Marcus. Just right for you.",
   "item": {"on": "fightStart", "effects": [{"do": "block", "n": 8}]},
   "art": {"prop": "apron", "tint": "apron"}}
 ]}
```

### 10.6 Offline generator

Same output as the AI, from the seed stream `offer:<page>:<j>` (plus a hash of any typed request).

- **Templates**: each theme has about 12 card templates and 6 item templates, written as block lists with number ranges solved to the budget (e.g. Forge "Deal {a} damage. Gain {b} Block." with a + b = budget − 1).
- **Names**: theme lexicon of 20 adjectives × 20 nouns ("Banked", "Quenched", "Ringing" × "Edge", "Coal", "Anvil"…), plus a few fixed names per NPC. No name repeats an existing card name in the book or the world pool.
- **Flavor**: 10 authored lines per theme, chosen by the stream.
- **Requests**: a keyword map steers the template: burn/fire/hot → Forge damage/Strength; shield/protect/safe → Block; heal/rest/grow → Regen; poison/thorn → Poison; see/draw/learn → draw; luck/coin/deal → a Bargain template; weak/scare → Weak; break/crack → Vulnerable. Unknown → book themes.
- **Replies**: authored per NPC beat (as MVP), so the offline game is fully voiced.

---

## 11. Equipment (items)

**An item is a passive effect that lasts the rest of the book.** Items are not cards and never enter the deck.

### 11.1 Slots

| Slot | Holds | Leans on |
|---|---|---|
| **Hand** | tools and weapons | attack bonuses, on-play triggers |
| **Body** | aprons, cloaks, coats | Block, max HP, damage taken |
| **Charm** | trinkets, lanterns, feathers | draw, energy on turn 1, tokens, out-of-combat effects |

One item per slot, three at most. HUD: three small round slots next to the token slots (gold rim, icon from the kit's icon renderer, empty = dashed haze outline). Tooltip: name, slot, rules text.

Getting an item for a full slot: "Swap it for {new}? {old} will be left behind." Swapped-out items are gone.

**Bound** items (cursed or bargain items) cannot be swapped or dropped. Only the Keeper or Burn a curse at the Hearth can free the slot.

### 11.2 What items can do

- Fight start: Block, Strength, apply a debuff to the enemy, draw on turn 1, +1 energy on turn 1.
- Turn triggers: every turn, every Nth turn, first card each turn, when you play an attack/skill.
- Reactions: when you lose HP, when a curse is drawn.
- Stats: max HP ±, healing after a won fight, Spoils show one more card.
- Path: reveal the next page's offer kind, make the next station better (a path twist).

Never: permanent +1 energy per turn (unless rare with a real drawback), anything that touches other players, anything that loops.

---

## 12. Curses

- **Doubt** (MVP) stays the canonical curse: unplayable, lose 2 HP at end of turn if in hand.
- **Themed curses** (table in section 5) come from the shadow theme. Generated curses follow the same rules: unplayable (or a dead card that costs energy), one trigger, a small penalty, tick damage ≤ 2, value −4 to −10 PP.
- **Bound items** are curses in item form ("Ash-Choked Bell").
- Curses are always `doubt` violet, never upgradeable, never offered as gifts.
- At most 3 curse cards; past that, a curse becomes −4 max HP.
- **Removal**: Well (any card), Keeper offers, Hearth "Burn a curse" (2+ curses), some items and twists.
- **Broken Vow** (Oath): cannot be removed at stations. It goes away when you keep a promise you made in a moment (the promise is a path twist with a check, e.g. "Don't take the Shrine's deal" or "Win your next fight without losing more than 10 HP"). Shown on the card.

---

## 13. The final fight: Ash Warden v2

| | |
|---|---|
| **Base** | 120 HP for a 9-page book; **+8 / −8 per page** above / below (8 pages: 112, 10 pages: 128) |
| **Intents** | Cleave 14 · Brace 9 + Block 12 · Smother 7 + Weak · Ember Slam 23 (same cycle and tells as MVP; values ×~1.15) |
| **Aspect** | From the primary theme (section 5). Shown on the gate prompt. |
| **Twist** | From the shadow theme: replaces Smother with an equal-budget intent. |
| **Marks** | 0–2, earned by hostility in this book (attacking any NPC, being caught stealing). Each Mark: the Warden starts with +1 Strength. Shown: "The Warden carries your marks." |
| **Co-op** | 17.6 |

Why the Warden scales with the **path** and not with your deck: the same seed should be the same challenge for everyone, and a good read must feel strong. A better deck wins more; a reckless one pays through curses and Marks.

Targets (design sim with a careful bot; humans play 5–15 points worse):

| Deck at the gate | Sim win |
|---|---|
| Median read: 7 cards, 1 upgrade, 1 item, ~40 HP | 95–100% (humans ~75–85%) |
| Median read, 34 HP, no item | ~95% |
| Median read + 1 curse | ~60% |
| Median read + 2 curses | under 5% |
| Thin read: 5 cards, no upgrades | 0% |
| Strong read: 9 cards, 2 items | 100%, about 28 HP left |

These are the numbers to defend. Two curses at the gate is a loss; the game makes sure you always had a chance to remove them.

---

## 14. Winning: the Last Page and world changes

### 14.1 Flow

1. The Warden falls (MVP win body text).
2. **The last page**: "One choice is left: what will Ashbrook remember?" Three **proposals** (cards with a kind icon, a title, one line of what changes for everyone, and a preview: the card face, the NPC line in a speech panel, or the prop at its site).
   - AI on: the AI proposes from the book's story (its themes, its last offers taken, the free-text requests, how Marcus ended). Validated like minor changes plus the stricter global rules (14.4).
   - Offline: three **preset** world changes matching the book's themes, not yet in the world.
3. The player picks one, or **Keep this book to yourself** (no world change).
4. "Write it into the world" sends it. Status line under it (section 19). The player does not wait: "Chapter complete" shows at once; the status keeps updating while that screen is open and is also on the cover ledger later.
5. booksWritten +1, remembered line saved (MVP priority list, plus "Your mark is in Ashbrook now." if the change merged).

Behind it (design summary; Technical Director and Network own the build): the client (solo) or the room (co-op) sends the proposal to a **bot endpoint** on a Cloudflare Worker. The Worker validates it again, checks rate limits, and opens a pull request on `nircaf/ever` as a GitHub App. A GitHub Action runs tests, schema checks, the balance sim and a path allowlist, and **auto-merges** when all pass. Cloudflare Pages redeploys; the new edition reaches new books.

### 14.2 Kinds of major change

| # | Kind | Files | What players see later |
|---|---|---|---|
| 1 | **A card for every book**: a card made in this book joins the global pool | `world/cards/` | It can appear at Lecterns, in Spoils and in offline offers, with "Written in Book {n}" in small type |
| 2 | **A new line**: Marcus, a Keeper or a Wayfarer gains a line under a condition (theme, trust word, page, echo) | `world/lines/` | e.g. Marcus at Trusting in a Forge book says it |
| 3 | **A new face**: a new archetype instance (name, look params from the kit, opening lines per theme, offer bias) | `world/npcs/` | can replace the seeded Wayfarer or Keeper on some seeds |
| 4 | **A change to a place**: one prop from a closed list at one marked anchor | `world/places/` | a cairn, a lit lantern, a briar patch, a carved stone with a short inscription, a signpost arrow, a bench, wildflowers |
| 5 | **An item for every book** | `world/items/` | joins the item pool |
| 6 | **A path variant**: a new page title set or a new skirmish re-skin within budget | `world/paths/` | new Contents titles, new enemy flavors |
| 7 | **A new rule** (rare): one new building block as code | `world/blocks/` (sandboxed) | new kinds of offers start appearing |

Kind 7 rules: AI-only (offline presets never make code), proposed only when the book's AI moments asked for something no block could express (the validator logs these), one pure function over the provided API plus a budget formula plus tests, at most one merged per week, at most 120 lines. Anything else in the code fails the Action.

**Marked anchors** for kind 4 (world team places them): by the well, forge door, lectern tree, road fire, cart, keeper's bench, gate pillars (both), shrine path, south signpost, east meadow, west wood edge. One prop per anchor; a new prop at a full anchor replaces the oldest player prop there (only player props, never MVP scenery).

### 14.3 Examples of good major changes

1. **"Banked Hammer joins the stone."** A Forge book's card (Deal 6. Gain 2 Block. First time each fight: gain 1 Strength.) enters the global pool.
2. **Marcus remembers the hammer.** New line, condition: Trusting, after a Forge win in the world's history: "A reader brought Tobin's hammer back once. It hangs over the door."
3. **A cairn by the gate.** Prop at the gate pillar anchor, inscription "For the ones who went first."
4. **The Keeper learns a riddle.** New Keeper line for Crow books: "Birds on the gate. Count them. Never trust an even number."
5. **A new Wayfarer: Pell the Tinker.** Look: haze cloak, ember accent, a hammer instead of a lantern. Offer bias: Hand items. Opening (Forge): "Bent nails, straight nails. I sell both."
6. **Wildflowers at the well.** The well anchor gets moss-and-gold flowers; nothing mechanical.
7. **"Crow's Ledger" item for every book** (Charm, uncommon): "The first time each fight you apply Vulnerable, apply 1 Weak too."
8. **New Contents titles for Briar books**: "The Wood Leans In", "Roots Under the Road".

### 14.4 What is NOT allowed

- Deleting, renaming or weakening anything that exists (MVP content, other players' changes, other cards' numbers). The world only grows; props at a full anchor are the one exception (14.2).
- Changing Marcus's story: his secret, Tobin, the Warden's origin, his beats. New lines may add color, never contradict.
- Anything outside `world/` (data) and `world/blocks/` (code): engine, UI, server, CI, docs, dependencies, licenses.
- Rules text written by the AI. All rules text is rendered from data.
- Real people, real places, brands, URLs, handles, emails, numbers that look like contact details, politics, religion, slurs, sexual content, gore, self-harm. Player names never enter the world (no signatures except "Book {n}").
- Copying text from other works (lyrics, quotes).
- Exclamation marks, all caps, emoji (house tone).
- A global card that fails the stricter band (0 to +6 against the full-run reference), any 0-cost card with damage + draw, any card or item that changes energy per turn.
- More than 3 files, more than 8 KB of data, or more than 120 lines of code in one PR.
- More than one world change per win; any proposal identical (by content hash) to an existing world entry.
- Anything that changes books already in progress (pinning, section 16).

### 14.5 Offline presets

When the AI is off (hosted site, bridge offline), the Last Page offers three presets: **24 authored preset world changes** (3 per theme) live in `world/presets/`. Each says which themes it fits and what it adds. Presets used up (already merged) are skipped; when all for a theme are used, the panel offers the other themes' presets; when every preset is used, the Last Page offers only "Keep this book to yourself" and the line "Ashbrook has taken every mark it can for now."

### 14.6 The ledger

The cover shows "Ashbrook, edition {E}" and "What changed". The ledger panel lists the last 20 merged changes, newest first: kind icon, title, "Book {n}", date. The Keeper may mention the newest one.

### 14.7 Consent and license copy

The Last Page's fine print (must be shown before the first submission per browser): "Your choice becomes a public change to the game on GitHub. It is checked by tests before it goes live, and it is shared under the game's AGPL license. No account, name or email is attached." The player must press "Write it into the world" for each submission; nothing is sent automatically.

---

## 15. Death and the echo

The book closes (MVP screen). Nothing shared changes. The player's next book gets **one echo**:

- **Echo card**: the dead deck's best non-curse, non-keepsake card (highest PP; ties: most played) appears as a **4th choice at the first Lectern** of the next book, labeled "Echo". Base version, not upgraded. If the next path's Lectern is page 3, it still waits there.
- **Echo line**: the remembered line (MVP rules), plus the Keeper's or Marcus's first greeting acknowledges it ("You have ash on your boots already." / MVP "Have we met?").
- One echo at a time; a new death replaces it; a win clears it. Echoes never change the seed's content. Clean reads (setting) ignore echoes.

Death copy adds: "The next book will carry an echo: {card}."

---

## 16. Versions, saving and refresh (player-facing rules)

- Each book records the **engine version** and the **world edition** it started with. It is played to the end on those, even if the site redeploys in the middle.
- New books always start on the latest edition (or the edition in a shared code, if still kept).
- The in-progress book is saved after every page (localStorage). The cover shows "Continue Book {N} · page {i} of {L}". A reload mid-fight resumes at the start of that fight (fight state is not saved; HP is the HP you entered with).
- Old editions are kept for at least **14 days** after they stop being current. If a book's edition or engine is no longer available, the book closes as "unfinished" (counts as written, not as a death, no echo) with its copy (section 19).
- First load stays small: the world manifest the cover needs is the edition number and the ledger (a few KB); card/NPC/prop data for the book loads with the book. (Build details are the Technical Director's.)

---

## 17. Co-op

Each player still owns their own book (MVP 7.5). v2 adds:

### 17.1 One seed per room

The host picks the seed on the host screen (Random, typed, Today's page). The room's seed and edition are shown on the room chip ("Room ABCDE · Seed KQ7F-M2XB"). Every seat reads the same themes and path.

Keepsakes: seat 1 gets the seed's keepsake; seat 2 the primary theme's other keepsake; seats 3 and 4 the secondary theme's two keepsakes. Deterministic, so a seed still means the same party start.

### 17.2 Moving through pages together

- The party shares the **current page**. Everyone walks to it.
- A moment or station page is done when every connected living player has finished it (taken or declined an offer, used or skipped the station), or **90 s after more than half** have (countdown). Late players lose that page's pick.
- A fight page works like the MVP gate lobby (`GDD.md` 7.4) at the page's ring; party fight rules as MVP 7.3, enemy intents one per fighter.
- Spoils: each player picks from their own 3 cards (`spoils:<page>:<seat>`).

### 17.3 Per player vs shared

| Per player | Shared (room) |
|---|---|
| Deck, upgrades, items, curses, tokens, HP, Marks | Seed, edition, path, current page |
| Trust and flags with each NPC, their offers | NPC shared memory (any player's attack: everyone's trust −1, MVP rule, for every NPC) |
| Echo | Path twists (a twist one player earned changes that page for all, and only twists that help or are announced) |
| AI on or off (their own bridge) | The lit forge Hearth: if any player got Marcus to +2, the Hearth is at the forge for everyone; the double temper is only for players at +3 |
| | The final decision |

### 17.4 Who talks to the NPC

Everyone, privately, at the same time (MVP rule). Each player's AI calls come from their own client; players without AI get offline offers. The room re-validates every offer (9.5 step 8) with the same deterministic sim seed and refuses anything that fails (`not_allowed`), so a modified client cannot inject a stronger card. Bubble: "{name} is talking to {npc}".

**Gifts to a friend**: some offers from the Keeper and the Wayfarer are marked "For a friend". The taker picks an ally; the ally gets "{name} offers you {item}. Take it?" and may refuse. **Curses, costs and bound items can never be given to another player.**

### 17.5 Death and late joiners

A player who dies mid-book gets a new book in the same room, joining at the party's **current page** with a catch-up start: their keepsake + echo + one free pick (1 of 3 offline commons) for every two pages they missed, 35 of 50 HP, no items. A player who joins a room mid-book gets the same catch-up start ("You join on page {i}. Pick what you would have found.").

### 17.6 Party Warden and enemies

| Fighters | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| Warden v2 HP (9 pages) | 120 | 270 | 410 | 545 |
| Skirmish / elite HP | ×1 | ×2.2 | ×3.3 | ×4.4 |

The page adjustment (±8 per page) is multiplied by the same factors. Marks: the Warden carries every fighter's Marks, but the Strength from Marks applies only to that fighter's intent.

### 17.7 The final decision together

After a party win, everyone in the room sees the Last Page. Proposals come from the client of the player who landed the final blow if their AI is on, otherwise from presets (the room validates either way). Each connected player votes for one proposal or "Keep this book to ourselves". **Majority wins; a tie goes to the final blow's vote**; 60 s timer, non-voters don't count, no votes at all = keep it to ourselves. One world change per room win. The **room** sends it to the bot endpoint (server to server), which is what makes co-op wins trustworthy.

### 17.8 Limits (design numbers for the bot endpoint)

- Per room: one submission per win, at most 3 per room per day.
- Per IP: 3 submissions per day.
- Global: at most 30 PRs per day; at most 10 auto-merges per hour (others wait in line: status "Waiting in line").
- Solo wins must carry the seed, edition, engine version and the book's action log so the endpoint can replay the fights with the shared rules; a log that does not replay to a win is refused. (Technical Director decides the mechanism; this is the requirement.)

---

## 18. Example content

### 18.1 Ten AI-made cards (plain language)

Each shows where it came from, the rules text the game renders, why it fits the budget, and its icon spec.

| # | Card | From | Type · cost · rarity | Text | Budget note | Icon |
|---|---|---|---|---|---|---|
| 1 | **Banked Hammer** | Marcus, Forge book, player typed "can you make my hammer burn?" | Themed upgrade of Tobin's Hammer | Deal 6 damage. Gain 2 Block. The first time you play this each fight, gain 1 Strength. | upgrade +3 PP over the keepsake (Strength 5 PP for the fight, damage/Block trimmed) | hammer, ember head, coal accent |
| 2 | **Bucket Line** | Keeper, Well | skill · 1 · common | Gain 4 Block. Draw 1 card. | 4 + 3 = 7 | bucket (cylinder), ward |
| 3 | **Bramble Knot** | Lectern, Briar | skill · 1 · uncommon | Apply 4 Poison. | 4+3+2+1 = 10 × 0.8 = 8 ≤ 9 | thorn sprig in a knot, moss |
| 4 | **Tobin's Promise** | Marcus, Oath, trust +3 | attack · 1 · uncommon | Deal 6 damage. If you haven't lost HP this fight, deal 6 more. | 6 + 6 × 0.3 ≈ 8 ≤ 9 | sword over bell, slate |
| 5 | **Ash Offering** | Keeper, Ash | attack · 0 · uncommon | Lose 3 HP. Deal 9 damage. Exhaust. | 9 × 0.75 − 3 ≈ 4 ≤ 4 | ash cloud, ember crack |
| 6 | **Lamplighter's Round** | Wayfarer, Lantern | skill · 1 · rare | Gain 1 Energy. Draw 2 cards. Exhaust. | (5 + 6) × 0.75 ≈ 8 ≤ 11 | lantern, lit, gold |
| 7 | **Crow's Ledger** | Spoils, Crow | attack · 2 · rare | Deal 6 damage. Deal 4 more for each Weak and Vulnerable on the enemy (up to 3). | scaling capped at 3; sim-estimated ~16 ≤ 17 | feather + open book, ink |
| 8 | **Pawned Courage** | Wayfarer, Bargain (bargain offer) | skill · 0 · uncommon | Gain 2 Strength. Add a Doubt to your discard pile. Exhaust. | (10 × 0.75) − 6 + bargain allowance; sim band −5..+12 | coin + doubt crack, gold |
| 9 | **Green Apple** | Keeper, Briar (with a twist) | skill · 1 · common | Heal 3 HP. Ripens at the Hearth into **Red Apple**: Heal 6 HP. Gain 1 Strength. Exhaust. | 4.5 now; Red Apple checked as uncommon | apple (icos) + leaf, moss → ember |
| 10 | **Undertow** | Shadow Well, Cold Marcus | curse · – | Unplayable. When you draw this, discard 1 random card. | −6 | wave, doubt hatch |

### 18.2 Six items

| # | Item | Slot | From | Text | Budget note |
|---|---|---|---|---|---|
| 1 | **Tobin's Apron** | Body | Marcus, trust +3 (item offer) | Start each fight with 8 Block. | 8 per fight, common-uncommon |
| 2 | **Wayfarer's Lantern** | Charm | Wayfarer, Lantern | On your first turn of each fight, draw 2 more cards. | 6 per fight, common |
| 3 | **Briar Gloves** | Hand | Elite spoils, Briar | The first attack you play each turn also applies 1 Poison. | ~1 Poison × 6 turns, decaying ≈ 10, uncommon |
| 4 | **Crow's Eye** | Charm | Keeper, Crow | At the start of each fight, apply 2 Vulnerable to the enemy. | Whetstone forever: 6 + better damage ≈ 10, uncommon |
| 5 | **Anvil Chain** | Hand · **Bound** | Shrine-flavored bargain, Forge/Bargain | Your attacks deal 3 more damage. You draw 1 fewer card each turn. | +18 vs −12 per fight, rare bargain |
| 6 | **Ash-Choked Bell** | Charm · **Bound** (cursed item) | Cold Keeper, shadow Ash | At the start of each fight, shuffle a Doubt into your draw pile. When you burn a curse at the Hearth, this goes too. | −6, curse |

### 18.3 A sealed offer, a path twist, a promise (one each)

- **Sealed** (Wayfarer): "Something wrapped in cloth." Inside: Heavy Cleaver (attack · 2 · rare: Deal 18 damage) and a Slag curse. Net about +5 PP.
- **Path twist** (Keeper, trust +2): "When you reach the Margin Stone, it will show you four cards instead of three."
- **Promise** (Oath, Marcus): "Promise me you won't touch the crooked shrine." Accept: gain **Sworn Steel** (attack · 1 · uncommon: Deal 7. Gain 3 Block.) now. Breaking it (taking the Shrine's deal): gain Broken Vow.

---

## 19. UX copy for the new screens

Tone as MVP: plain, warm, short, sentence case, no exclamation marks except the one in the win screen.

### Cover (additions)
- "Continue Book {N}" (small under it: "Page {i} of {L} · Seed {CODE}")
- "Today's page"
- Edition line: "Ashbrook, edition {E}" · link "What changed"
- Ledger panel: title "What changed in Ashbrook" · rows "{title} · Book {n} · {date}" · empty "Nothing yet. Ashbrook is waiting for its first mark." · "Close"

### New book
- Title: "A new book"
- Label: "Seed" · placeholder "Leave empty for a random seed"
- Buttons: "Random" · "Today's page" · "Begin"
- Preview: "Your one card: {keepsake}" · "Themes: {primary} and {secondary}, with a shadow of {shadow}" · "{L} pages"
- Word seed: "'{text}' becomes {CODE}."
- Old edition in a shared code: "This seed was shared from edition {E}." · buttons "Read edition {E}" · "Use today's Ashbrook"
- Edition gone: "Edition {E} is no longer kept. This seed will use today's Ashbrook (edition {now})."
- Share: "Copy seed" · toast "Seed copied. Anyone who opens it reads the same path."
- Setting: "Clean reads (no echoes)"

### Chapter page
- "Book {N}"
- "{Primary} and {Secondary}"
- Setup line by primary theme, e.g. Forge: "In Ashbrook the forge has gone cold, and something waits at the north gate." Well: "The well in Ashbrook remembers everyone who looks in." Briar: "The wood has crept to Ashbrook's wall, and something waits at the north gate." Ash: "Ash lies on every step in Ashbrook. Someone is still grieving." Lantern: "One lantern is lit in Ashbrook tonight. Follow it." Crow: "Crows sit on the north gate and count the people who pass." Oath: "In Ashbrook, people still keep their word. Mostly." Bargain: "Everything in Ashbrook has a price tonight."
- (small) "Seed {CODE}" · "Click to turn the page"

### Contents
- Title: "Contents"
- Rows: "Page {i} · {title}" with states: done (a small tick) · "You are here" · ahead
- Page titles by type (offline tables, themed variants allowed): marcus "The Cold Forge"; lectern "The Margin Stone"; well "The Well"; grindstone "The Grindstone"; shrine "The Crooked Shrine"; hearth "The Road Fire" / "The Lit Forge"; skirmish "Ash on the Road" / "Teeth in the Meadow"; elite "The Iron Husk"; Wayfarer "A Cart on the Road"; Keeper "The Lamp-Keeper"; final "The Ash Gate"
- Footer: "{L} pages · about {m} minutes" · "Close"

### HUD (additions)
- Page pill: "Page {i}/{L}" · tooltip "Open the contents. Press C."
- Item slots: tooltip "{name} ({slot}): {rules text}" · empty "No {slot} item."
- Bound tooltip suffix: "Bound. It won't come off."
- Hint: "Next: {title}, {direction}." · not current page: "{npc} nods at you. Later." / "{station} is still. Not yet."
- Marks pill (only if > 0): "Marks {n}" · tooltip "The Warden will carry these."

### Moment and offer
- Prompt: "E  Talk to {name}"
- Option always shown from exchange 2: "What can you offer me?"
- Free text placeholder (v2): "e.g. Can you make my hammer burn?"
- Thinking: "{name} thinks it over..." · checking offers: "{name} weighs it in their hands..."
- Offer panel title: "{name} offers"
- Offer labels: "Gift" · "Bargain" · "Sealed" · "With a twist" · "For a friend"
- Cost line: "Costs: {cost}" (e.g. "lose 5 max HP", "your Ward token", "Strike from your deck")
- Sealed face: "Something wrapped in cloth. Sealed: may hold a curse."
- Buttons: "Take it" · "Take nothing"
- After: "{name}: {parting line}"
- Fallback (once per book): "Some offers were written by the local script."
- Toasts: "New card: {name}" · "Upgraded: {name}+" · "Item: {name} ({slot})" · "Token: {name}" · "Removed: {name}" · "{old} becomes {new}." · "A curse is written into your deck: {name}." · "Your deck can't hold more curses. You lose 4 max HP instead." · "The path changes: {twist}."
- Swap: "Your {slot} holds {old}. Swap it for {new}? {old} will be left behind." · "Swap" · "Keep {old}"
- Bound refusal: "{name} is bound to you. It won't come off."
- Keepsake refusal: "Not that one. It's the only thing you came with."

### Spoils
- Title: "Spoils"
- Text: "Take one, or leave them."
- Buttons: (3 cards) · "Leave them (heal 4 HP)"
- Elite: "The Husk drops something." · (2 items, or 3 cards via "Show cards instead")

### Hearth
- Title: "The Road Fire" / "The Lit Forge"
- Text: "Rest a while. One thing, then the road."
- Buttons: "Rest (heal {n} HP)" · "Temper a card" · "Burn a curse" (only with 2+ curses) · "Walk on"
- Lit forge, trust +3: Marcus: "One more. For Tobin." (Temper picks two)

### Fights
- Skirmish prompt: "Ash stirs on the road. Fight?" · "Fight" · "Not yet"
- Elite prompt: "An Iron Husk blocks the path. Fight?"
- Token choice line: "Spend tokens in this fight:" (checkboxes, default on)
- Gate prompt: "The Warden stirs. It carries {aspect}." second line if twist: "Something of {shadow} is in it too." if marks: "It carries your marks." · "Fight" · "Not yet"
- Combat log: aspect lines, e.g. "Heart-coal: the Warden grows stronger." · "Thorns: you take 2 damage." · item lines "{item}: {effect}."

### The last page (win)
- Heading: "The last page"
- Body: "The Warden falls apart into cooling ash. One choice is left: what will Ashbrook remember?"
- Proposal kinds: "A card for every book" · "A new line for {npc}" · "A new face in Ashbrook" · "A change by {place}" · "An item for every book" · "New page names" · "A new rule"
- Option: "Keep this book to yourself"
- Button: "Write it into the world"
- Fine print: "Your choice becomes a public change to the game on GitHub. It is checked by tests before it goes live, and it is shared under the game's AGPL license. No account, name or email is attached."
- Status: "Sending..." · "Sent. The world is checking it." · "Waiting in line." · "Ashbrook remembers. Edition {E} is out." · "The world did not take this mark. Your book is still complete." · "Too many marks today. Your book is still complete; try again tomorrow." · "Can't reach the world right now. Your book is still complete." · link "See the page being written"
- Offline note: "Without the AI, Ashbrook offers marks it has prepared."
- All used: "Ashbrook has taken every mark it can for now."
- Then: MVP "Chapter complete" screen; stat line v2: "Book {N} · {L} pages · {turns} turns · {hp} HP left · Seed {CODE} · {AI-voiced read|Fair read}"

### Death (additions)
- "The next book will carry an echo: {card}."
- Stat line v2: "Book {N} · fell on page {i} of {L} · Seed {CODE}"
- Button (new): "Read this seed again"

### Versions
- Continue on an older edition: "This book began in edition {E}. Ashbrook has changed since; you'll see the new Ashbrook in your next book."
- Unavailable: "This book's edition is no longer kept. It closes here, unfinished. It still counts as written."
- New edition while on the cover: "Ashbrook has changed. New books will see edition {E}."

### Co-op (additions)
- Host screen: "Seed" field + "Random" · "Today's page" (same as New book)
- Room chip: "Room {CODE} · Seed {SEED}"
- "{n}/{m} done here. The page turns when everyone is done." · "The page turns in {s}s."
- "{name} is talking to {npc}."
- Gift: "{name} offers you {thing}. Take it?" · "Take it" · "No thanks" · to giver: "{name} took it." / "{name} said no."
- Catch-up: "You join on page {i}. Pick what you would have found." · "{k} picks left"
- Final vote: "Choose together. {v}/{m} have chosen." · "{name} chose: {title}" · "Tie. {name} landed the last blow, so their choice stands." · "Nobody chose. This book stays with you."

---

## 20. Generated text: tone and safety

All model output is hostile data. On top of the MVP's reply sanitizing (`GDD.md` 2.5 step 3):

- **Names**: 2–24 characters, letters, spaces, apostrophe and hyphen only, at most 4 words, Title Case applied by the game, not equal to any card/item/NPC name in the book or the world.
- **Flavor**: ≤ 90 characters, one sentence, no `<>{}[]@#\`|`, no digits, no URLs, no exclamation marks; rendered with `textContent`.
- **Blocklist** check (slurs, sexual terms, real brands, a list of well-known real people and places) on names, flavor, replies and every world-change text. Failing text: offer replaced (minor), proposal dropped (major).
- **Rules text**: never from the model. Rendered by the game from blocks.
- **Inscriptions** (place props): ≤ 40 characters, same rules, and only from the AI's proposal, never typed by the player directly. Player free text never enters the world verbatim.
- **Icons**: the model picks from an enum of kit props and palette keys; anything else falls back to the theme default.

---

## 21. What is saved

| Key | Holds |
|---|---|
| `ever.v2.meta` | `{booksWritten, rememberedLine, echo: {cardData, fromBook} or null, cleanReads, lastSeed}`. On first v2 load, `ever.v1.meta` is migrated (booksWritten and rememberedLine kept). |
| `ever.v2.book` | The in-progress book: seed, edition, engine version, page, HP, deck (with generated card data inline), items, tokens, curses, Marks, NPC trust and flags, path twists, action log (for win replay). Target ≤ 8 KB. |
| `ever.v2.settings` | MVP settings + clean reads. |

---

## 22. Build split and asks

Suggested ownership for v2 (folders as in `TECH.md` section 2; new folders need the Technical Director's sign-off):

| Owner | v2 work |
|---|---|
| **Systems** (`core/`, `core/rules/`) | Seed codes and streams, path generator and constraints, book v2 state and save, moments flow (9th intent `request`), offer panel, spoils, hearth, items and curse rules, offline generator and lexicons, validation pipeline glue, Last Page UI, ledger, echo |
| **Combat** (`combat/`, `combat/rules/`) | Building-block interpreter for cards/items/curses/tokens on the engine, Thorns, new enemies, Warden v2 aspects and twists, the **balance simulator** (browser quick check + CI full check) |
| **World** (`world/`) | Anchor sites, fight rings and their combat shots, bookmark ribbon, Wayfarer cart and Keeper bench placement, world-change props at anchors |
| **Art** (`shared/`) | Wayfarer and Keeper builds, Motes/Hound/Husk, new icon props and `makeIconFromSpec`, item badge, ribbon, place props (cairn, flowers, carved stone, bench, arrow) |
| **Network** (`server/`, `net/`) | Room seed/edition, shared page progress, offer re-validation, gifts, final vote, room → bot endpoint call, bot Worker with GitHub App and rate limits |
| **Technical Director** | Schemas (`contracts.js`), `world/` manifest and editions, version pinning and asset caching, GitHub Action (tests, schema, sim, path allowlist, size caps, sandbox lint), setup docs |
| **Creative Director** | This doc, lexicons, preset world changes, opening lines, page titles, the reference decks for the sim |

---

## 23. Tuning notes

Numbers in sections 4, 7 and 13 come from a quick design sim (careful bot that sees the intent, plays the best affordable set of cards each turn, abstract cards on the budget in 8.2). Findings that shaped the design:

1. Thin decks are strong in this engine: with draw 5 and 3 energy, a 7-card deck plays its best cards almost every turn. The MVP's 82 HP Warden fell to a median v2 deck 100% of the time, so the Warden v2 has about 1.45 × HP and 1.15 × hits.
2. Curses scale with thinness: one Doubt in an 8-card deck cost about 35 points of win rate against the Warden v2; two cost about 90. Hence the 3-curse cap, guaranteed removal, Burn a curse, and the "no unearned pure-bad change" rule.
3. Skirmishes are a pacing beat, not a wall (careful bot always wins, losing 0–10 HP). Their job is to tax HP and hand out spoils. If human tests show them as boring, raise Cinder Hound to 36 HP before adding new intents.
4. The keepsake alone beats the Motes in 3 turns, losing about 4 HP. Keep every keepsake at ≥ 5 damage per play, or ≥ 3 damage plus Poison.

The Technical Director's simulator on the real engine replaces these numbers; the reference decks for each page (early, mid, late) are part of the content I deliver to `world/` once the schema exists.
