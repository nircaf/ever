# 02-art-director report

I wrote the art bible and a shared art kit (style.js and style.css) that both modes use. I checked it two ways. A Node smoke test with three@0.170.0 built every factory and showed that the same seed always gives the same shape. I also rendered it in the browser using a temporary preview page in the scratchpad, with the exploration scene and the combat stage at 1280x760 and at phone size (375x812). Fixes from those renders are already in: the paper base layer showed through the grass, and in combat a gate pillar hid the Warden and the players overlapped.

Look: "Ashbrook at dusk, as a pop-up book." The world is cool: slate sky, teal-green pines, moss grass, slate-blue roofs (never terracotta). Warm colors appear only where they mean something: the low sun, lit windows, the lantern, embers and the Warden's cracks. Faces, hands, cards and panels all share the same paper color, so the world and the UI read as one material. Every mesh gets a small seeded wobble so edges look hand-folded but stay the same on every load and for every player in a room. There are no textures, outlines or tone mapping. This avoids the purple-gradient, beige-and-terracotta and neon-on-black looks.

Palette: the 9 hex values from GDD 5.1 are unchanged, plus one new color, `haze` #8E9DB3, for fog and the horizon. Card band colors are attack=ember, skill=slate, power=moss, curse=doubt, token=gold. Seat colors are ember, slate, moss and gold. Fonts are Young Serif for titles and Figtree for UI text, both with offline fallbacks.

ART_BIBLE.md covers mood, the palette with roles, supporting 3D-only shades, lighting (one warm key light, a cool hemisphere light and haze fog), cameras, silhouettes, polygon budgets, how models are built, UI rules, motion rules (including reduced motion) and a do/don't table.
- **Exploration camera:** a 32-degree follow cam at a fixed three-quarter angle.
- **Combat camera:** the same scene and lights, framed from the south-west. The Warden is left-center, the party stands in a row on the right, and the actors sit in the top 60% of the screen above the cards.
- **UI:** 2px ink borders, a hard 3px shadow with no blur, 10px corners on panels and cards, and primary buttons in ink with an ember bottom edge.

style.js (an ES module that imports only 'three'):
- **Setup:** `PALETTE`, `WORLD`, `COLORS`, `CARD_TYPE_COLORS`, `SEAT_COLORS`/`SEAT_KEYS`, `FONTS`, `MOTION`, `REDUCED_MOTION`, `CSS_TOKENS` and `applyCssTokens()`.
- **Helpers:** `rng`, `jitter`, `seedFromPos`, `makeMaterial(colorKey, opts)` (cached flat-shaded Lambert material, with an optional glow) and `color()`.
- **Renderer, light and camera:** `pickQuality`, `configureRenderer`, `makeLightRig(scene)` returning {key, hemi, follow}, `makeFog(scene, mode)`, `makeSky()`, `CAMERA`, `COMBAT_STAGE` (Warden and seat 1-4 positions), `makeCamera`, `followCamera`, `frameCombat` and `easeInOut`.
- **Draw-call and budget helpers:** `bakeStatic` merges static props into one mesh per material, and `countTriangles` checks budgets.
- **Nature:** `makeTree` (pine or round), `makeRock`, `makeTerrain` (64x64, road, pads and ash circle painted per triangle, on a paper base layer), `makeGroundTile`, and merged `makePineRing`, `makeStoneWall` and `makeRockScatter`.
- **Props:** `makeHouse`, `makeLantern` (setLit), `makeCampfire`, `makeSignpost`, `makeHammer`, `makeSword`, `makeShield`, `makeBook` (setOpen) and `makeTable`.
- **Tokens and card art:** `makeToken('ember'|'ward'|'whetstone')` matches GDD 3.4. `makeCardIcon(name)` covers every card in the MVP pool plus Doubt. `createIconRenderer()` turns any model into a transparent PNG data URL for card art.
- **Characters:** `makeCharacter({body, accent, hat, scale, beard, apron, holding, seed, broad})` has `.update(t, dt)` for the idle bob and walk, `.setWalking` and `.faceTowards`. `makeIdleBob` works on any object. Presets: `CHARACTERS.player(seat)` and `CHARACTERS.marcus()`, which follows the GDD look and has the lift-but-never-strike hammer loop.
- **Enemy:** `makeEnemy('ashWarden')` has `setPose` (dormant, idle, cleave, brace, smother, slam, hit, dead), `setIntentPose(1..4)` mapped to the GDD intent cycle, `flash`, `lunge` and `update`.
- **Stations:** `makeStation(type)` builds well, lectern, grindstone, forge (with anvil, cold hearth and lantern), anvil, shrine, gate (with the r=3 combat circle and ember sparks) and signpost. Each one has `userData.radius` set to the GDD interact radius, plus `setUsed()` and `update()`. Extras are `forge.setLanternLit` and `setHearthLit`, and `gate.setOpen(0..1)`. Generic names map to the GDD stations through `STATION_ALIASES`, for example upgrade=forge, remove=well, curse=shrine, gain=lectern, token=grindstone.
- **Whole village:** `ASHBROOK` holds the GDD coordinates. `buildAshbrook()` builds all the scenery and stations in place.

Measured size: player 236 triangles, Marcus 296, Warden 496, gate 700, and the full village about 12,000 triangles in 145 meshes (budget is 60,000 per frame).

style.css: the same tokens as CSS custom properties, plus base components that both modes use:
- **Layout:** stage and UI layer.
- **Panels, buttons and inputs:** panel and modal, buttons (primary, secondary, quiet, doubt, block, with key hints), text input and room-code input.
- **HUD:** pills for HP, deck, energy and trust, an HP bar, three token slots, the hint strip, the "E" interact prompt, room chip and party list with seat dots, and name tags.
- **Dialogue and toasts:** toasts, and a dialogue box with the speaker tab, trust pill, options and the free-text row.
- **Cards:** type band, cost circle, name, art window, text, and the upgraded, unplayable, curse-hatch, playable and denied states, plus hand and deck-grid layouts.
- **Combat:** energy orb, intent chips, banner, floating numbers and status chips.
- **Book pages:** cover, chapter, win and death pages.
- **Phone and reduced motion:** phone breakpoints with a 16px gutter and 44px tap targets, and a reduced-motion version.

I did not create package.json or build config, did not run git, and did not edit anyone else's files.

## Files
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/docs/ART_BIBLE.md
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/game/src/shared/style.js
- /Users/eleanorbleiberg/Desktop/nir/ever-inkwell/game/src/shared/style.css

## Open issues
- Technical Director: style.js imports bare 'three' and was tested with three@0.170.0, using MeshLambertMaterial with flatShading, which needs r151 or later. Please pin three to 0.170.x or newer in package.json and make sure the bundler resolves it. The kit uses no three/addons.
- Technical Director: style.css expects the Google Fonts link (Figtree 400/600/800 and Young Serif) in the page head, without blocking load. The hosted site must work offline, so the fallbacks Georgia and system-ui take over when fonts.googleapis.com can't be reached. If you would rather self-host the fonts (both are OFL), put them under game/ and tell Art so the @font-face rules can move into style.css.
- Creative Director: I added a 10th palette token, haze #8E9DB3, for fog and the sky horizon. Fog in exactly the dusk color would wash the scene beige-orange, which the brief rules out. The 9 GDD hexes are unchanged. Power cards are moss and tokens are gold; the GDD named neither. Please update GDD 5.1 to match, or tell Art if you disagree.
- Creative Director: in combat the Ash Gate bars are raised (gate.setOpen(1)) and the Warden stands in front of the gate at COMBAT_STAGE.warden (-1.2,-23.6) instead of behind it, so it isn't hidden. Its dormant spot in exploration stays at (0,-27). GDD 5 says 'Warden left-center, players right'; this staging keeps that.
- Combat engineer: build card art with createIconRenderer().render(makeCardIcon(name, type)) once at load and cache the data URLs. It uses one extra WebGL context; call dispose() when done. Card markup uses .ever-card[data-type] with .ever-card__band, __cost, __name, __art, __text, plus .is-upgraded and .is-unplayable, and the upgraded '+' is added in CSS. In co-op, put Warden intent poses on the Warden with setIntentPose(step).
- World engineer: give each prop a seed from seedFromPos so every client in a room builds identical geometry. buildAshbrook() already does this and lays out the GDD section 5 coordinates. Call rig.follow(x, z) as the player moves so the shadow box stays centered, and copy the camera position into sky.position every frame.
- Draw calls: the Warden is 32 meshes and the gate station 28 (budgets raised to 36 and 30 in the bible). The full village is 145 meshes before characters. If phones struggle, run bakeStatic() on the static stations (houses, gate pillars) and use quality 'low', which drops shadows and some trees.
- UI: on phones the hint strip moves to the bottom and is hidden with body:has(.ever-dialogue, .ever-modal). Browsers without :has() will show it overlapping, so the game should also hide the hint while dialogue is open.
- The preview/gallery page I used for checking is only in the scratchpad (.../scratchpad/artkit/index.html, served with a local three install). If the team wants an art-kit gallery page in the repo, the Technical Director should add one once the bundler is set up.
