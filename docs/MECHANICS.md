# EVER mechanics engine (v2 building blocks)

Owner: Mechanics architect. Code: `game/src/mechanics/**`. Design source: `docs/GDD_V2.md` sections 8 to 12.
License: AGPL-3.0-or-later, like the rest of the repo.

The mechanics engine turns **data** (an AI proposal, an offline-generator offer, a co-op client's claim, a `world/` file) into cards, items, curses and tokens that play through the existing Slay the Web rules. It never runs code from the AI. Everything here is pure JavaScript: no DOM, no network, no storage, no timers, no `Math.random`. The browser and the room server (`server/`) import the same files.

```
untrusted JSON ──► validateContent ──► canonical def ──► addContent(run) ──► book.content
                    size, schema, text,                       │
                    caps, budget, fairness,                   ▼
                    balance sim (optional)          compileCard / items / tokens
                                                              │
                                     combat/rules hooks ◄─────┘  (solo and room server)
```

Contents: 1 Public API · 2 Content schema · 3 Block library · 4 Validator and budget · 5 Engine integration · 6 Balance simulator · 7 Code-block sandbox · 8 Seeds and the run registry · 9 Offline generator · 10 Safety · 11 Versions · 12 Files · 13 Known limits

---

## 1. Public API

Import from `game/src/mechanics/index.js` only.

| Call | What it does |
|---|---|
| `validateContent(raw, opts)` | The one gate. Returns `{ok, def, score, errors, warnings, sim}`. `opts`: `offer` (`gift` default, `bargain`, `curse`, `sealed`, `global`), `kind` (expected kind), `rarity` (the **game's** rarity for the slot, overrides the proposal), `authored` (world/ content: allows `keepsake` and `special`), `existingNames`, `blocklist` (Creative Director's word list), `content` (the run, for `addCard` references), `sim` (`false` default; `true` or `balanceCheck` options). |
| `normalizeContent(raw)` | Shape only: JSON to canonical def, drops unknown fields, clamps numbers. Never throws. |
| `rulesText(def, ctx?)` | Rules text rendered from data. Plain text: render with `textContent`. |
| `scoreContent(def)` / `checkBudget` / `checkCaps` | Power points (PP) and hard caps, used by the validator. |
| `upgradedCard(def)` | Deterministic upgraded variant (never stored). |
| `compileCard(def, {upgraded, genId, content})` | Canonical card or curse to an engine card object (plain JSON). |
| `compileDeckCard(deckCard, content)` | A book deck entry (`{uid, id: 'g:c-…', upgraded}` or `{uid, def}`) to an engine card, or `null` for engine names. `combat/rules.engineCard` calls it. |
| `balanceCheck(def, opts)` | Fast deterministic sim. Returns `{ok, deltaWin, deltaPower, perDeck, reasons, ms, fights, bands}`. |
| `simulateFight({cards, items, tokens, content, enemy, hp, seed})` | One headless fight with the bot. |
| `createRunContent({engine, world, seed})` | Empty per-book registry, pinned to an engine version and a world edition. |
| `addContent(rc, def, {offer, src, page})` | Pure: returns `{rc, id, added}` with a deterministic id. |
| `removeContent`, `getDef`, `contentId` | Registry helpers. |
| `serializeRunContent(rc)` / `parseRunContent(text, {blocklist})` | Compact canonical JSON; parsing **re-validates** every def and drops tampered ones. |
| `generateContent(seed, label, {kind, rarity, theme, offer, existingNames, sim})` | Offline procedural offer, always valid. |
| `rng(seed, label)`, `hash32`, `hashId`, `shuffle`, `pick`, `pickWeighted`, `randInt`, `canonicalJson` | Seeded PRNG (named streams) and stable hashing. |
| `describeLibrary()` | Compact block list for the AI prompt (`input.library`): ids and parameter ranges only, no costs. |
| `buildJsonSchema()` | JSON Schema (draft 2020-12) of a canonical def, for CI and non-JS tools. |
| `afterFight({deckDefs, itemDefs, won})` | Out-of-combat results for the book (`{heal}` from `fightWon` triggers). |
| `KEEPSAKES`, `REFERENCE_DECKS`, `REFERENCE_ITEMS`, `SIM_ENEMIES`, `wardenHpForPages` | Reference content for the sim and tests. |

Typical use at an NPC moment (Systems):

```js
import {validateContent, addContent, generateContent} from '../mechanics/index.js'

const v = validateContent(aiJson, {offer: 'gift', rarity: 'uncommon', existingNames, sim: {pages: book.path.length}})
const def = v.ok ? v.def : generateContent(book.seed, `offer:${page}:${slot}`, {kind: 'card', rarity: 'uncommon', sim: true})
// …player takes it…
const {rc, id} = addContent(book.content, def, {offer: 'gift', src: v.ok ? 'ai' : 'offline', page})
book.content = rc
book.deck.push({uid: `c${book.nextUid++}`, id, upgraded: false})
```

Items: `book.items = [id, …]`. Generated tokens: put the id in `book.tokens` next to `ember`/`ward`/`whetstone`.

---

## 2. Content schema (v1)

`MECH_SCHEMA_VERSION = 1`. Every canonical def carries `v: 1`. Input may be the flat form below or the GDD_V2 10.5 nested form (`{kind: 'card', name, card: {...}, art}`); both normalize to the same def. Unknown fields are dropped everywhere; any PP, description or rules text in the input is ignored.

```jsonc
// card
{"v": 1, "kind": "card", "name": "Quenched Edge", "flavor": "Still warm from a forge that went cold.",
 "theme": "forge", "type": "attack", "rarity": "uncommon", "energy": 1, "target": "enemy",
 "exhaust": false, "retain": false,
 "effects": [{"do": "damage", "n": 6, "hits": 1, "target": "enemy"},
             {"do": "block", "n": 3, "if": {"is": "enemyIntendsAttack"}}],
 "triggers": [],                         // power cards only
 "upgrade": {"effects": [...]},          // optional; else the game derives it
 "art": {"prop": "hammer", "tint": "ember", "accent": "gold"}}

// item (equipment, passive for the rest of the book)
{"kind": "item", "name": "Tobin's Apron", "slot": "body", "rarity": "common", "bound": false,
 "triggers": [{"on": "fightStart", "effects": [{"do": "block", "n": 8}]}], "stats": {"maxHp": 0}}

// curse (energy null = unplayable)
{"kind": "curse", "name": "Slag", "energy": null, "exhaust": false, "effects": [],
 "triggers": [{"on": "turnEnd", "effects": [{"do": "loseHp", "n": 1}]}]}

// token (one shot, next fight)
{"kind": "token", "name": "Lucky Coal", "effects": [{"do": "block", "n": 6}]}
```

**Effect**: `{do, ...params, if?, scale?, when?}`.
- `if`: one condition (section 3). Shorthands accepted: `"enemyIntendsAttack"`, `{hpBelow: 40}`, `{firstTimeThisFight: true}`.
- `scale`: `{per, each 1–5, cap 1–5}`, amount = `n + each × min(count, cap)`. Only on `damage`, `block`, `heal` (and code blocks that opt in).
- `when`: `"now"` (default) or `"nextTurn"` (delayed one turn).

**Trigger**: `{on, ...params, if?, effects: [1..4]}`. Aliases accepted: `combatStart` → `fightStart`, `onDamageTaken`/`onDamaged` → `onHpLoss`, `onPlayType` → `onPlay`.

**Durations**: instant (default); this turn (energy, Block); next turn (`when: "nextTurn"`); n turns (a power with n stacks decays by 1 per round); rest of the fight (`power` with `fight: true`); next fight (tokens); rest of the book (items, curses, `stats.maxHp`).

**Ids**: a generated thing lives in the run registry under `g:<kind letter>-<6 base-36 chars>` (`c` card, `i` item, `u` curse, `t` token), the hash of its canonical JSON. Same def, same id, on every machine.

`buildJsonSchema()` emits the structural schema; `node game/src/mechanics/tools/emit-schema.mjs > mechanics-content.v1.json` writes it (add `--library` for the AI-facing description).

---

## 3. Block library (`library.js`)

PP = power points, the game's price of one resolution. Conditions multiply by their likelihood, `nextTurn` by 0.8, exhaust multiplies the positive part by 0.75, retain adds 1.

**Effects**

| `do` | Params | PP | Notes |
|---|---|---|---|
| `damage` | n 0–30, hits 1–3, target enemy/allEnemies | n × hits + (hits − 1) | First plain hit of an attack goes through the engine's own damage (Strength, Weak, Vulnerable). n 0 needs a `scale`. |
| `block` | n 0–25 | n | |
| `draw` | n 1–3 | 3n | Engine draw semantics (reshuffle when short). |
| `energy` | n 1–2 | 5n | This turn. |
| `loseEnergy` | n 1–2 | −4n | |
| `heal` | n 0–15 | 1.5n | In fight, capped at max HP. |
| `loseHp` | n 1–10 | −n | Ignores Block, like the Doubt tick. |
| `power` | kind, n 1–5, target enemy/allEnemies/self, fight bool | see below | Good on the right side, negative on the wrong side. |
| `removePower` | kind or `debuffs`/`buffs`, target self/enemy | +3 good / −2 bad | Cleanse. |
| `exhaust` | n 1–2, pick random/curse | −n random, +2n curse | From hand. |
| `discard` | n 1–2 | −1.5n | Random from hand. |
| `addCard` | card ref, pile hand/draw/discard, n 1–2 | n × value of that card | Refs: `Strike` 6, `Defend` 5, `Doubt` −6, or a `g:` id in the run. |
| `healNow` | n 1–15 | 0.5n | Out of combat, only in a `fightWon` trigger (book HP). |
| *code blocks* | declared by the block | `block.pp(p)` | Section 7. Shipped: `damageFromBlock` (n 25–100 %). |

**Powers** (`POWERS`): `vulnerable` 3/stack (6 for the fight), `weak` 3 (5), `strength` 3 (5), `regen` and `poison` n(n+1)/2 × 0.8 (at least 4.8n for the fight), `thorns` 2 (5). Vulnerable, Weak and Strength are the engine's own. **Regen, Poison and Thorns tick in the mechanics hooks** (the party combat never calls the engine's `endTurn`): Poison on a fighter at their turn start, on the Warden at its turn start; Regen heals at turn end (fighter) or Warden turn start; Thorns hits back when hit by an intent with damage (fighter) or damages a fighter who plays an attack (enemy).

**Conditions** (`if`): `hpBelow(pct 10–90)`, `handSizeAtLeast(n)`, `handSizeAtMost(n)`, `enemyIntendsAttack`, `enemyHas(kind)`, `handHasCurse`, `cardsPlayedAtLeast(n)`, `turnAtLeast(n)`, `turnIs(n)`, `energyLeftAtLeast(n)`, `noAttackThisTurn`, `notDamagedThisFight`, `firstTimeThisFight`, `deckSizeAtMost(n)`.

**Scaling** (`scale.per`): `cardInHand`, `curseInDeck`, `turn`, `cardPlayedThisTurn`, `missingHp10`, `enemyDebuff`, `item`. Cap ≤ 5 always.

**Triggers** (items, curses, power cards; expected firings per 6-turn fight in brackets): `fightStart` [1], `turnStart` [6], `turnEnd` [6; on a card only while in hand], `onPlay(type attack/skill/power/any)` [9/6/1/16], `firstCardEachTurn` [5.4], `onDraw` [4; curses: when this card is drawn], `onHpLoss` [4], `everyNthTurn(n 2–4)` [6/n], `onKill` [0.5], `fightWon` [1; out of combat, `healNow` only].

**Budgets** (GDD_V2 8.2): card common 6e+1 (0-cost 2), uncommon 6e+3 (4), rare 6e+5 (6), keepsake 12 (authored only); upgrade +3 PP or energy −1; item per fight common 8, uncommon 12, rare 16; token 4–10; curse −3 to −10 per fight; bargain good part up to 1.5 × band and the cost must take back at least half of the excess. 0.5 PP rounding slack everywhere.

**Hard caps** (before budget, no exceptions): per card ≤ 30 damage (at max scaling), ≤ 25 Block, ≤ 3 draw, ≤ 2 energy, ≤ 3 stacks of a power (5 for Poison/Regen); energy plus draw must exhaust; an attack needs a plain damage effect; a non-attack that targets the enemy must do something to it; no `draw` or add-to-hand on `onPlay`/`onDraw`/`firstCardEachTurn`; no `loseHp` on `onHpLoss`; `onKill` only heals, blocks or applies powers; curse tick ≤ 2 HP per trigger; item energy every turn only on a rare item with a drawback; max HP ±10 per item; ≤ 6 effects per list, ≤ 3 triggers, ≤ 4 effects per trigger.

---

## 4. Validator and budget (`validate.js`, `budget.js`, `text.js`)

Order: **size** (raw JSON ≤ 8 KB, before parsing) → **shape** (schema) → **text** → **hard caps** → **budget** → **fairness** → **canonical size** (≤ 2 KB) → **balance sim** (optional). Errors are `{code, path, msg}`; `msg` is written for a designer, e.g. `9 PP is over the common budget of 7`, `effects[0].do: unknown block "nuke"`, `a card that gives Energy and draw must exhaust`, `win rate moves +14 points (band -4 to 5)`.

| Code | Meaning |
|---|---|
| `size`, `not_object`, `version`, `kind` | Input rejected before or at shape. |
| `effect`, `param`, `enum`, `condition`, `scale`, `trigger`, `ref`, `field`, `too_many`, `too_few` | Shape errors, with a JSON path. |
| `text` | Name or flavor rejected (reason in `msg`). |
| `cap` | Hard cap. |
| `budget` | PP band. |
| `unearned`, `rarity` | Fairness: bad changes must be a bargain, a curse offer or a sealed offer; curses are never gifts; `keepsake`/`special` are authored only. |
| `sim` | Balance check failed. |

Warnings (`clamped`, `rarity`) never block.

**Text** (GDD_V2 20): names 2–24 characters, letters, spaces, apostrophes, hyphens, at most 4 words, Title Case applied by the game, not a reserved or existing name, not on the blocklist. Flavor ≤ 90 characters, one sentence, no digits, no `!`, no `<>{}[]@#\`|\`, no links; control, zero-width and bidi characters are stripped. Prompt-injection words (`ignore`, `instructions`, `prompt`, `system`…) are on the base blocklist. **Rules text is always rendered from data** (`rulesText`).

---

## 5. Engine integration (`compile.js`, `engine.js`, `runtime.js`)

The vendored engine (`vendor/slaytheweb`) is not edited. There are exactly two extension points:

1. **One engine action, `everOps`.** `installEngineExtensions()` adds it to the engine's action table (idempotent; `combat/rules.ensureEngine()` calls it). A compiled card carries `actions: [{type: 'everOps', parameter: {ops}}]`; the engine's own `playCard → useCardActions` runs it, and `runtime.resolveEffects` interprets the ops on the fighter's state. An attack's first plain hit is the engine card's `damage` field, so Strength, Weak and Vulnerable apply exactly as for upstream cards.
2. **Combat hooks**, called by `game/src/combat/rules/index.js` at fixed points of a party fight. Each mutates the already-cloned `PartyCombat` and returns display events `{k: 'mech', seat, text}`:

| Hook | Called from rules | Does |
|---|---|---|
| `mechSetup(pc, f, {content, items, tokens, seed})` | `createPartyCombat`, per fighter | Builds `f.s.mech` (items, tokens, `addCard` templates), fires `fightStart`, resolves generated tokens. |
| `mechTurnStart(pc, f, intent)` | after `setIntents` (round 1) and in `newRound` | Poison tick, delayed effects, `turnStart`, `everyNthTurn`, `onDraw` for the new hand. |
| `mechAfterPlay(pc, f, card)` | after `actions.playCard` | Registers power-card triggers, enemy Thorns, `onPlay`, `firstCardEachTurn`. |
| `mechOnKill(pc, f)` | when the Warden drops to 0 | `onKill`. |
| `mechTurnEnd(pc, f)` | `endFighter` (real end only), before the Doubt tick | `turnEnd`, Regen. |
| `mechDiscardHand(s, discardHand)` | replaces `actions.discardHand` | Keeps Retain cards. |
| `mechEnemyTurnStart(pc)` | start of `wardenTurn` | Warden Poison / Regen. |
| `mechAfterEnemyHit(pc, f, before, intent)` | after each intent | `onHpLoss`, fighter Thorns. |
| `mechRoundEnd(pc)` | after power decay | Restores "rest of the fight" stacks. |

The rules also: pass `content` into `engineCard` / `createFighterState`, keep `mech` in the slim fighter state (`ENGINE_KEYS`), check death after a play (Lose HP, Thorns), finish the fight when Poison or Thorns kill the Warden, and add `gen`, `art`, `rarity` to `viewFor` hand entries of generated cards. `createPartyCombat` reads `fighter.content ?? book.content` and `fighter.items ?? book.items`; generated token ids (`g:t-…`) in `tokens` resolve through the registry.

Per-fight mechanics state `f.s.mech` is plain JSON (stored with the `PartyCombat`), versioned `MECH_STATE_VERSION = 1`, and carries its own PRNG state (`r`), so random picks (discard, exhaust, `addCard` to the draw pile) are deterministic and identical on the client and the room. Runaway protection: trigger depth ≤ 3, ≤ 24 firings per event, ≤ 8 drain passes.

**Art**: compiled cards carry `everArt: {prop, tint, accent?}` from the `ART_PROPS` / `ART_TINTS` enums (the kit palette keys and the icon renderer's props, GDD_V2 18). The UI passes it to the kit's icon renderer (`makeIconFromSpec`, Art owns it). Curses are always tinted `doubt`.

---

## 6. Balance simulator (`sim.js`)

Why a separate sim: a real-engine fight costs milliseconds (immer + clones per step); the quick check needs about 100 fights in well under 200 ms. `sim.js` replays the engine's arithmetic on mutable plain objects (`playCard`, `removeHealth`, `takeMonsterTurn`, draw, power decay) and reuses **the same interpreter and the same hooks** as the real fight. `sim.test.js` plays every probe card (and 7 engine cards) through both `combatStep` and `simPlay` from identical states and requires identical results.

The bot: each turn it tries every playable card on a copy of the state and keeps the best by a value function (enemy HP, useful Block, own HP, statuses, what the rest of the turn can still play), until no play improves the position.

`balanceCheck(def, opts)`: adds the candidate to each of three reference decks (cards and curses into the deck, items equipped, tokens for the fight), runs `fights` seeded fights with and without it, and compares.
- Default target: **the run's final enemy**: Warden v2 with HP for `pages` (120 at 9 pages, ±8 per page), the three **late** reference decks (8 cards + 1 item) at 40 HP. `enemy` overrides (`'husk'` or `{name, hp, intents}`), `stage: 'early'|'mid'|'late'` uses GDD_V2 8.3 per-page decks, `decks` takes the Creative Director's reference decks.
- Metrics: `deltaWin` (points of win rate) and `deltaPower` (100 × mean margin: HP left / 50 on a win, minus the enemy's HP share left on a loss; keeps moving when win rate saturates).
- Bands (`SIM_BANDS`, win / power): common −4..5 / −15..10, uncommon −4..8 / −15..14, rare −4..12 / −15..18, item and token 0..12 / −15..18, bargain −5..12 / −20..18, curse −20..−3 / −40..−2, global 0..6 / −12..8. Win bands get ±8 points of noise slack (`SIM_NOISE`). Gift floors are −4 instead of GDD 0: in 8-card decks even a fair common dilutes slightly (measured −5 to −8 for "Deal 7 damage").
- Always: the late deck must not kill a ≥ 100 HP enemy in one turn; fights must average ≥ 3 turns.
- Deterministic: keyed shuffles (each card id lands in the same place with or without the candidate) and seeded streams; same inputs give the same report. Baselines are memoized per deck.
- Speed: `QUICK_FIGHTS = 16` per deck and arm; median about 15 ms per check warm in Node (test asserts median < 100 ms, max < 200 ms). The full CI check can pass `fights: 200`.

The room server calls `validateContent(..., {sim: {seed: <room seed>}})` with the same seed, so it reaches the same verdict as the client.

---

## 7. Code-block sandbox (`blocks/`, `sandbox/`)

New mechanics can arrive as **code** only through a reviewed world-change pull request (GDD_V2 14.2 kind 7), and only in `game/src/mechanics/blocks/`. A code block is a pure function over a provided API.

```js
// game/src/mechanics/blocks/damage-from-block.js
import {clamp, pct} from '../sandbox/lib.js'

export const block = {
	id: 'damageFromBlock',          // camelCase, 3–24 chars, unique
	version: 1,
	enemy: true,                    // acts on the enemy (target checks)
	params: {n: {t: 'int', min: 25, max: 100, def: 50}},  // int (≤ 100), enum, bool only
	pp: (p) => Math.round(((8 * p.n) / 100) * 10) / 10,     // planning price
	text: (p) => 'Deal damage equal to ' + p.n + '% of your Block',
}

export function run(api, p) {
	api.damage(clamp(pct(api.currentBlock(), p.n), 0, 30))
}
```

Register it in `blocks/index.js` (fixed format: `import * as x from './x.js'` lines and one `export const CODE_BLOCKS = [x, …]`). It then appears in the library, schema, budget, rules text and `describeLibrary()` like a built-in.

**The API** (frozen; numbers clamped; at most 40 calls per run, then the block fizzles with an event and the fight continues): `damage(n, hits)`, `block(n)`, `draw(n)`, `energy(n)`, `heal(n)`, `loseHp(n)`, `power(kind, n, target)`, `count(per)`, `test(is, params)`, `hp()`, `currentBlock()`, `maxHp()`, `enemyHp()`, `enemyMaxHp()`, `energyLeft()`, `handSize()`, `turn()`, `random()` (seeded), `repeat(n ≤ 10, fn)`. Blocks never see the state objects.

**Static rules** (`sandbox/check.js`, enforced; `sandbox/eslint.sandbox.js` carries the same rules as an ESLint flat config for editors):
- imports: only named imports from `../sandbox/lib.js` (outside `blocks/`, so a PR cannot change it);
- exports: exactly `export const block` and `export function run`;
- no globals except `Math` (not `Math.random`), `Number`, `Boolean`, `isFinite`, `isNaN`, `parseInt`, `parseFloat`; every other identifier must be declared in the file;
- banned anywhere: `eval`, `Function`, `globalThis`, `window`, `self`, `document`, `navigator`, `location`, `fetch`, `XMLHttpRequest`, `WebSocket`, storage, `indexedDB`, `caches`, `crypto`, all timers, `require`, `process`, `Worker`, `WebAssembly`, `Proxy`, `Reflect`, `Symbol`, `Object`, `Array`, `String`, `Promise`, `Date`, `JSON`, `console`, `constructor`, `prototype`, `__proto__`, `arguments`, `bind`, `call`, `apply`, `toString`, `valueOf`;
- no `this`, `new`, `class`, `async`/`await`, generators, `with`, `debugger`, `delete`, `void`, `in`, `instanceof`, loops (use `api.repeat`), template literals, regex literals, dynamic `import()`, `import.meta`, computed member access except a number literal (use `lib.at`);
- ≤ 120 lines and 4 KB per file.

Checks: `node game/src/mechanics/tools/check-blocks.mjs` (all files; or pass file paths) exits non-zero on any violation. `sandbox.test.js` runs it on every shipped block, loads every block (`CODE_BLOCK_ERRORS` must stay empty) and keeps a list of 30 escape attempts that must fail.

**For the GitHub Action (Technical Director)**: run `npm test` (includes the sandbox test), `node game/src/mechanics/tools/check-blocks.mjs`, validate every `world/` content file with `validateContent(file, {authored: true, offer: 'global', sim: {fights: 200}})`, and allow code only under `game/src/mechanics/blocks/` (≤ 120 lines).

---

## 8. Seeds and the run registry (`prng.js`, `registry.js`)

- `rng(seed, label)`: mulberry32 over FNV-1a of `"<seed>|<label>"`. Every decision uses its own **named stream** (`path`, `themes`, `offer:3:1`…), so adding a decision never shifts another (GDD_V2 3.2). `stepState` lets plain-JSON state carry its own stream (`f.s.mech.r`).
- `RunContent` (one per book, saved with it, kept by the room in co-op):

```jsonc
{"v": 1, "schema": 1, "engine": "0.3.0", "world": 14, "seed": "KQ7FM2XB",
 "defs": {"g:c-1k3x9a": {…canonical def…}},
 "meta": {"g:c-1k3x9a": {"offer": "gift", "src": "ai", "page": 3}},
 "order": ["g:c-1k3x9a"]}
```

`engine` and `world` pin the book (GDD_V2 16): a redeploy never changes a book in progress. Limits: ≤ 40 defs and ≤ 6 KB serialized (a typical book with 8–11 changes is 2–4 KB). `serializeRunContent` is canonical (sorted keys), so equal content gives equal bytes. `parseRunContent` re-validates every def (schema, text, caps, budget, fairness for its recorded offer kind), checks that each id still matches its content, and drops anything else with a reason: a saved book or a co-op peer cannot smuggle an edited card.

---

## 9. Offline generator (`generate.js`)

`generateContent(seed, label, {kind, rarity, theme, offer, existingNames, sim})` picks a template from a seeded stream, fills numbers to the rarity's budget, names it from the theme lexicon, and returns a **validated** def (falling back to a plain template that always passes). Same seed and label give the same def, so offline books are fully reproducible. With `sim: true` each attempt must also pass the balance check. Templates and lexicons here are the floor; Systems' themed generator can replace them as long as it returns `validateContent(...).def`.

---

## 10. Safety summary

- Model output is hostile data: one JSON object, size-checked before parsing, unknown fields dropped, numbers clamped, enums checked, prototype keys ignored.
- No executable output: compiled cards are data; the interpreter looks blocks up by id.
- The game prices content (PP) and renders rules text; the model supplies only a name and a flavor line, both sanitized.
- Bad changes require a bargain, curse or sealed offer (fairness).
- Code blocks only via reviewed PRs, statically checked, API-only, op-budgeted, deterministic.

---

## 11. Versions

| Constant | Where | Bump when |
|---|---|---|
| `MECHANICS_VERSION` (`1.0.0`) | `index.js` | API changes |
| `MECH_SCHEMA_VERSION` (1) | `schema.js` | canonical def shape changes incompatibly (old books keep theirs) |
| `RUN_CONTENT_VERSION` (1) | `registry.js` | registry shape changes |
| `MECH_STATE_VERSION` (1) | `runtime.js` | `f.s.mech` shape changes |
| `SIM_VERSION` (1) | `sim.js` | sim results change (bands, bot, decks) |
| `SANDBOX_VERSION` (1) | `sandbox/check.js` | sandbox rules change |
| block `version` (1) | each code block | the block's contract changes |

---

## 12. Files

```
game/src/mechanics/
  index.js            public API
  library.js          enums, blocks, conditions, scalings, triggers, budgets, caps, describeLibrary
  blocks-registry.js  built-in + code blocks lookup
  schema.js           normalizeContent, JSON Schema, ids
  validate.js         validateContent
  budget.js           PP scoring, budget bands, hard caps
  text.js             name/flavor sanitizing, rules text
  upgrade.js          deterministic upgrades
  compile.js          defs -> engine cards, items, tokens
  engine.js           everOps engine action + combat hooks
  runtime.js          the block interpreter (shared by engine and sim)
  sim.js              balance simulator
  reference.js        keepsakes, sim enemies, reference decks and items
  prng.js             seeded streams, hashing, canonical JSON
  registry.js         run content registry
  generate.js         offline generator
  blocks/             sandboxed code blocks (+ index.js registry)
  sandbox/            check.js (static checker), lib.js (block helpers), eslint.sandbox.js
  tools/              check-blocks.mjs (CI), emit-schema.mjs (Node only)
  *.test.js           validate, engine, sim, sandbox, registry
```

---

## 13. Known limits and hand-offs

- Reference decks, enemies and Warden v2 numbers in `reference.js` are design placeholders until Combat and the Creative Director deliver the real ones; pass them in via `balanceCheck({decks, enemy})`.
- `ally` and `party` targets (co-op) are not in v1; items cannot affect other players (GDD_V2 8.2).
- Out-of-combat effects other than `healNow` (upgrade, remove, transform, gainCard, ripen, pathTwist, maxHp changes to the book) are book operations owned by Systems; items carry `stats.maxHp` as data for Systems to apply.
- The 3-curse cap per player and the 30 HP per book healing cap are book rules (Systems).
- The sim's bot is greedy; human tests should confirm the bands. Thin decks plus curses are cliff-edged (GDD_V2 open risk).
