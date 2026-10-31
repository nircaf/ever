# Slay the Web (vendored)

- Source: https://github.com/oskarrough/slaytheweb
- Commit: `a108c3e` ("Merge pull request #283 from oskarrough/fix/run-stats-invalid-run")
- Copyright (C) Oskar Rough and contributors
- License: GNU Affero General Public License v3.0 or later (`LICENSE` in this folder, unchanged).
  EVER as a whole is therefore AGPL-3.0-or-later.

## What is here

Copied byte-for-byte from the upstream tree, same relative layout so no import path
needed changing:

| Here | Upstream |
|---|---|
| `src/game/**` (all 11 files) | `src/game/**` |
| `src/utils.js` | `src/utils.js` (imported by the engine as `../utils.js`) |
| `src/content/cards.js`, `src/content/cards/*.js` (all 22) | same |
| `src/content/decks.js`, `dungeons.js`, `monster-rooms.js` | same (imported by the engine) |
| `LICENSE` | `LICENSE` |

Not copied: the Astro/Preact UI (`src/ui`, `src/components`, pages), images, tests, tooling.

## Modifications

**None.** Every file above is identical to upstream `a108c3e`
(check: `diff -r /tmp/stw/src/game vendor/slaytheweb/src/game`).

EVER's engine changes (the Doubt curse, the `unplayable` condition, the end-of-turn
Doubt tick, death at HP < 1, 50 max HP, the one-node Ash Warden dungeon, tokens and
co-op) are made at runtime by `game/src/combat/rules/` (AGPL-3.0-or-later, EVER
contributors), which registers into the engine's exported `cards`, `cardUpgrades`
and `allConditions` tables and wraps its actions. If you ever must edit a file in
this folder, list the file and the change here with a date.

## Notes for EVER engineers

- `src/content/cards.js` uses **top-level await** with dynamic `import()`. Vite builds
  with `target: 'es2022'` (see `vite.config.js`); wrangler/workerd handles it as is.
- `src/game/backend.js` posts runs to `https://api.slaytheweb.cards`. EVER must
  **never import it** (the hosted game makes no third-party calls).
- `src/game/dungeon.js` `Dungeon(options)` does `Object.assign(defaultOptions, options)`,
  mutating its module defaults. Always pass every option you rely on.
- `createCard(name, true)` appends `+` to the name of upgraded cards
  (`Strike` -> `Strike+`); books store base ids plus `upgraded: true`.
- Card instance ids come from `Math.random()` (`uuid()`), so the room server, not the
  client, owns the ids it hands out in co-op.
