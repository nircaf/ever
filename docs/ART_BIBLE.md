# EVER: Art Bible (MVP)

Owner: Art Director. Applies to every pixel in both modes: exploration (Ashbrook, Three.js) and card combat (Slay the Web rules, our UI).
Source of truth in code: `game/src/shared/style.js` (3D kit + palette) and `game/src/shared/style.css` (UI tokens + components). If this doc and the code disagree, the code wins and this doc gets fixed. Gameplay facts (positions, names, copy) come from `docs/GDD.md`.

---

## 1. The idea in one line

**Ashbrook at dusk, as a pop-up book.** The world is a folded-paper diorama: chunky low-poly shapes with slightly irregular, hand-folded edges, flat colors, a cool slate sky with one warm band of dusk at the horizon. The UI is the page the diorama stands on: paper panels, ink text, hard "page-stack" shadows.

Three rules make it ours and not generic:

1. **Cool world, warm accents.** The scene is mostly slate, teal-pine and moss under a slate-blue sky. Warmth appears only where it means something: the low sun, lit windows, the lantern, embers, the Warden's cracks. (Not beige-and-terracotta, not purple gradients, not neon-on-black.)
2. **Paper faces.** Every character's face and hands are `paper` colored, like cut-out figures. Cards, panels and book pages are the same `paper`. The world and the UI literally share a material.
3. **Folded, not modeled.** Every mesh gets a seeded vertex jitter (2 to 6% of its size) so edges look hand-folded, but stays identical every load. No smooth shading, no textures, no outlines, no ink lines.

## 2. Mood

Quiet, a little sad, warm at the edges. A village where the forge went cold. Calm framing, slow motion, a lot of sky. The only loud thing in the world is the Ash Warden.

Reference words: dusk, cold ash, folded card, lantern, iron, moss. Avoid: cozy-cottage beige, neon, grime, gore, glossy plastic.

## 3. Palette

Ten named colors. These hexes are the contract (the first nine are the GDD 5.1 tokens unchanged; `haze` is added for fog and sky horizon). In JS: `PALETTE.<name>`; in CSS: `var(--ever-<name>)`.

| Name | Hex | Roles |
|---|---|---|
| `paper` | `#F2E8D5` | UI panels, card faces, book pages, character faces and hands |
| `ink` | `#2B2A33` | all text, UI borders, Warden body, iron bars |
| `ember` | `#E4572E` | **attack cards**, damage numbers, Warden cracks and coal, sparks, Ember token |
| `slate` | `#4F6D8A` | **skill cards**, block numbers, sky zenith, roofs, seat 2 cloak |
| `moss` | `#6A994E` | **power cards**, grass, heal, success toasts, seat 3 cloak |
| `dusk` | `#F6C28B` | the low sun and key light tint, horizon glow band, focus rings |
| `gold` | `#E9B44C` | **token** rims and pickups, upgraded card rim, energy orb, seat 4 cloak |
| `doubt` | `#7D6B91` | **curse cards** (Doubt), Crooked Shrine glow. Never used for anything good |
| `ward` | `#A9CCE3` | Ward token, block shield icon, well water glow, hemisphere sky light |
| `haze` | `#8E9DB3` | fog color, sky at the horizon, disabled UI, distant silhouettes |

**Card type colors** (`CARD_TYPE_COLORS`): attack `ember`, skill `slate`, power `moss`, curse `doubt`, token `gold`. Status (engine "status" cards, none in MVP) falls back to `haze`.

**Seat colors** (cloaks, party list chips, name tags): seat 1 `ember`, seat 2 `slate`, seat 3 `moss`, seat 4 `gold`. Solo player uses seat 1.

### 3.1 World shades (supporting, derived)

Only for 3D materials, never as new UI colors. All are mixes of the palette above, so they sit in the same family.

| Name | Hex | Use |
|---|---|---|
| `pine` | `#2F5D57` | pine needles (teal-green; the signature tree color) |
| `pineDark` | `#24474A` | lower pine tier, hedges |
| `grass` | `#6A994E` (= moss) with `grassLight #7FAA5E`, `grassDark #57834A` | terrain faces, chosen per triangle |
| `path` | `#B9AD95` | village road, dirt pads |
| `ash` | `#6E6B74` | Ash Gate ground, cold hearth, Warden smoke |
| `stone` | `#8C93A0` | well, wall, pillars, rocks, lectern |
| `stoneDark` | `#666D7A` | stone undersides and accent blocks |
| `wood` | `#6B5242` | posts, beams, bucket, signpost |
| `roof` | `#3E5872` | roofs (slate-blue, never terracotta) |
| `window` | `#F2B84B` | lit windows, lit lantern (GDD lantern color) |
| `apron` | `#3A3A44` | Marcus's apron |
| `rust` | `#B5523B` | Marcus's sleeves (GDD) |
| `beard` | `#9DA0A8` | grey beard, hair |
| `iron` | `#3B3C46` | anvil, hammer heads, gate bars |

## 4. Lighting

One rig for both modes, built by `makeLightRig(scene)`. No other lights in the scene, ever. Glow is emissive material, not extra lights.

- **Key light**: one `DirectionalLight`, warm `#FFE2BF` (dusk lifted toward white), intensity 1.15, low in the west-south-west (direction from target: `(-0.75, 0.55, 0.35)`), so long shadows fall east and every object has a lit west face and a cool east face. Casts the only shadow map (1024, 2048 on "high"); shadows are off on low quality (phones).
- **Hemisphere light**: sky `ward #A9CCE3`, ground `pineDark #24474A`, intensity 0.85. This is what makes the shadow side cool instead of black.
- **Fog**: linear `Fog`, color `haze`, near 30, far 78 in exploration (the map edge melts into the sky); combat uses near 24, far 70.
- **Sky**: a vertex-colored dome (`makeSky`): `slate` at the zenith, `haze` at the horizon, a `dusk` glow band only in the sun's direction. No gradients anywhere else.
- **Renderer**: sRGB output, **no tone mapping** (flat colors must read as their hex), pixel ratio capped at 2. `configureRenderer(renderer)` does this.
- **Emissive**: lit windows, lantern, well water, shrine crystal, Warden cracks and coal. Emissive intensity 0.6 to 1.2, no bloom post-processing in the MVP.

## 5. Camera

- **Exploration**: perspective follow cam, narrow FOV **32 degrees**, fixed three-quarter angle from the south (offset `(0, 14, 15)` from the player, looking at the player plus `(0, 1, -2)`). It never rotates. It follows with exponential smoothing (`followCamera`, about 0.25 s lag). On portrait screens (aspect < 1) the distance grows by 60% so the village still reads. No camera shake in exploration.
- **Combat**: the **same scene and lights**, the camera eases (1.2 s, ease-in-out) to the fixed gate arena shot `CAMERA.combat`: from the south-west looking north-east at the gate (bars raised, the Warden has stepped into the circle), Warden on the left-center of the frame, the party in a row on the right, pines and wall behind. Portrait screens use a higher, more top-down position (`portraitPosition`/`portraitTarget`). The actors sit in the **top 60%** of the frame; the bottom 40% belongs to the hand of cards. `frameCombat(camera, aspect)` applies it; `COMBAT_STAGE` holds the Warden and the four seat positions.
- **Book cover**: 3D closed book on a table (`makeBook`, `makeTable`), camera 40 degrees down, same rig.

## 6. Silhouettes

Every object must be readable as a flat black shape at 64 px tall.

- **Player**: tall narrow hooded cone (cloak) with a paper face. The hood point is the signature. Seat color decides the cloak.
- **Marcus**: 1.2x player, wide shoulders, bald dome, beard wedge pointing down, apron rectangle. Square where the player is pointed.
- **Ash Warden**: 3 m, wide top, tiny head sunk between huge shoulder blocks, long arms reaching the knees. Top-heavy triangle. One small hammer sticking out of the left shoulder breaks the symmetry.
- **Trees**: pines are stacked 3-tier cones (tall, narrow); the one big Lectern tree is a round faceted crown (wide). Never mix the two outlines.
- **Stations**: each has one unique vertical: well = little gable roof, lectern = tilted open book, grindstone = upright wheel, forge = chimney, shrine = leaning obelisk, gate = two pillars with bars.

## 7. Polygon budget

| Thing | Triangles | Draw calls |
|---|---|---|
| Character (player, Marcus) | <= 500 | <= 12 |
| Ash Warden | <= 1,200 | <= 36 |
| Station (incl. its building) | <= 900 | <= 30 |
| Tree | <= 150 | 2 |
| Rock | <= 40 | 1 |
| House | <= 250 | <= 8 |
| Terrain | <= 4,000 | 1 |
| **Whole frame** | **<= 60,000** | **<= 200** (bake static props with `bakeStatic`) |

Measured (node smoke test of the kit): player 236 tris, Marcus 296, Warden 496, gate station 700, forge 256, full `buildAshbrook()` scenery about 12,000 tris in 145 meshes.

Geometry rules: icosahedron detail 0 or 1, cylinders and cones 5 to 8 radial segments, boxes 1 segment. Rings of trees, the stone wall and rocks are merged per material (`makePineRing`, `makeStoneWall`, `makeRockScatter`).

## 8. How things are built

Only Three.js primitives, built at runtime. No downloaded models or textures; this keeps the art license-clean under the project's AGPL.

- **Primitives**: Box, Cylinder (5 to 8 sides), Cone, Icosahedron (detail 0/1), Octahedron, Dodecahedron, Torus (low segments). Everything with `MeshLambertMaterial({flatShading: true})` from `makeMaterial(key)`, cached per color.
- **Jitter**: `jitter(geometry, amount, seed)` offsets each vertex by a hash of its position and the seed, so shared vertices move together (no cracks) and the same seed always gives the same shape. Bottoms stay flat so objects sit on the ground.
- **Seeds**: every factory takes `seed`. Place things with a seed derived from their map position so the village is identical for every player in a room (this matters in co-op).
- **Characters**: `makeCharacter({body, accent, hat, scale, beard, apron, holding, seed})`: hexagonal cloak (cone-cylinder), icosahedron head in `paper`, box arms on shoulder pivots, optional hood/cap/bald, beard wedge, apron plate, hand-held prop (hammer, lantern). `makeIdleBob(obj)` returns an `update(t)` for the breathing bob. Presets in `CHARACTERS`: `player(seat)`, `marcus`.
- **Enemy**: `makeEnemy('ashWarden')` returns the Warden with `setPose(name)` for each intent tell (`dormant`, `idle`, `cleave`, `brace`, `smother`, `slam`, `hit`, `dead`) and `update(t, dt)`.
- **Stations**: `makeStation(type)` for `well`, `lectern`, `grindstone`, `forge` (with anvil, hearth, lantern), `anvil`, `shrine`, `gate`, `signpost`. Each returns a group with `userData.station`, `userData.radius` (GDD interact radius) and `setUsed(bool)`; forge has `setLanternLit(bool)`, grindstone `update(t, dt)` spins while used, gate `setOpen(0..1)`.
- **Tokens**: `makeToken('ember' | 'ward' | 'whetstone')`: octahedron, disc, wedge. Same meshes as the HUD icons.
- **Card icons**: `makeCardIcon(cardName)` builds a tiny prop (sword, shield, hammer, fist, bolt, wave, mask, crack) and `createIconRenderer()` renders any object to a transparent PNG data URL, so card art comes from the same kit as the world.

## 9. UI language (cards, HUD, dialogue)

Implemented in `style.css`. Every UI piece is a flat paper panel sitting on the 3D scene.

- **Fonts** (Google Fonts, with offline fallbacks): display **Young Serif** for titles, card names, the speaker name, big numbers. UI **Figtree** (400/600/800) for everything else. Fallbacks: `Georgia, serif` and `system-ui, sans-serif`; the game must look fine if Google Fonts is unreachable.
- **Shape**: corner radius 10 px on panels and cards, 999 px on pills and chips, 6 px on buttons and inputs. Border 2 px `ink`.
- **Shadow**: the hard "page stack": `0 3px 0 rgba(43,42,51,.85)`, no blur, no glow. Pressed buttons drop to `0 1px 0` and move 2 px down.
- **Panels**: `paper` background, `ink` 2 px border, 16 px padding, 1 px inner rule at 6 px inset (`--ever-rule`) that reads like a printed page border.
- **Buttons**: primary = `ink` fill with `paper` text and a 3 px `ember` bottom edge (the book spine). Secondary = `paper` fill with `ink` text. Quiet = text only, underlined on hover. Danger is not a color: dangerous choices (the Shrine) use secondary styling plus `doubt` text.
- **Cards**: 5:7 ratio, `paper` face, top band in the card type color with the type in small caps, cost in a 2 px ink circle top-left (`ink` fill, `paper` number), name in Young Serif, icon square is a small window of Ashbrook sky (`ward` 45% on `paper`; the type color lives only in the band), description in Figtree. Upgraded: 3 px `gold` rim and "+" after the name. Unplayable: 55% saturation and the cost circle shows a dash. Curses: `doubt` band and a faint diagonal doubt hatch on the icon square.
- **HUD**: pills (`.ever-pill`) in the top-left: HP (ember dot), Deck (ink), three token slots (empty = dashed `haze` outline). Hint line top-center in a small paper strip. Room chip top-right with the party list under it, each with a seat-color dot.
- **Dialogue**: bottom panel, max width 720 px, speaker name in Young Serif on a small `ink` tab sticking out of the top edge, trust label as a pill to the right of the name. Options are full-width secondary buttons numbered 1 to 4 (keyboard shortcut). "Try something else" opens a single-line input with a primary "Do it".
- **Combat numbers**: damage `ember`, block `slate`, heal `moss`, Doubt tick `doubt`. Young Serif, 28 px, with the hard shadow.
- **Sizes**: base UI font 16 px (15 px on phones), minimum tap target 44 px, 16 px screen gutter on phones.

## 10. Motion

Slow world, snappy UI. Everything eases (cubic in-out); nothing bounces more than 5%.

- **Idle bob**: characters 0.03 units at 1.6 rad/s with a seeded phase so a party never bobs in sync. Warden breathes by scaling the coal 1.0 to 1.08 at 0.8 rad/s.
- **Walking**: 6 u/s (GDD). Body leans 6 degrees forward, bob doubles to 0.06 at step rate. Turn to face direction in 0.12 s.
- **Station feedback**: when used, the glow fades out over 0.6 s; the grindstone wheel spins down over 1.5 s.
- **Cards**: draw = slide from the draw pile 180 ms with 40 ms stagger; hover = lift 12 px + scale 1.06 in 120 ms; play = fly to target 220 ms then fade; discard 160 ms. Invalid play: horizontal shake 3 px x2, 160 ms.
- **Combat**: camera move 1.2 s. Warden tells: pose eases in 400 ms when the intent is shown; the attack lands with a 120 ms lunge. Hit flash: ember emissive pulse 150 ms. Damage number rises 24 px and fades over 700 ms. Camera shake only on Ember Slam: 0.15 units, 250 ms.
- **Screens**: page turn (book cover to chapter) 600 ms; toasts slide 8 px and fade, stay 2.4 s.
- **Reduced motion** (`prefers-reduced-motion`): no camera shake, no bob, card animations become 80 ms fades. `style.css` and `REDUCED_MOTION` in `style.js` expose it.

## 11. Do and don't

| Do | Don't |
|---|---|
| Flat colors from the palette, lit by the one rig | Textures, gradients on UI, outlines, ink lines, hand-drawn strokes |
| Seeded jitter on every mesh | Perfectly regular primitives (look like placeholders) or random-per-load shapes |
| Slate/teal world, warm only where it means something | Beige-and-terracotta, purple gradients, neon-on-black, glossy PBR |
| Paper faces and paper UI | Skin-tone faces, glass/blur UI panels |
| Hard page-stack shadows | Soft drop shadows and glows in the UI |
| One key light + hemisphere + fog | Extra point lights for "mood" |

## 12. Credits

All art is generated procedurally by our code. Combat rules come from Slay the Web by Oskar Rough and contributors (AGPL-3.0-or-later); none of its art or CSS is used.
