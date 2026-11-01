// EVER content-gen: public API (pure; importable by the browser and by server/).
//   generateMomentOffers / generateStationOffers / generateOffer / momentSlots: offline offers
//   generateDef: one validated def from a seed stream (themes, requests, budgets)
//   artRecipe: deterministic card-art recipe (icon.js renders it with the kit; browser only)
//   presetWorldChanges: offline Last Page proposals
// The Three.js icon builder is NOT exported here (keeps three out of the server bundle):
// import it from './icon.js' in browser code.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

export {
	CONTENT_GEN_VERSION, generateDef, generateOffer, generateMomentOffers, generateStationOffers, momentSlots, planMoment,
	rarityFor, sealInside, solveToBudget, offerNames,
} from './generate.js'
export {artRecipe, artKey, isValidRecipe, ART_RECIPE_VERSION} from './art.js'
export {makeName, makeFlavor, curseName} from './names.js'
export {THEME_WORDS, THEME_IDS, THEMED_CURSES, NPC_WORDS, REQUEST_KEYWORDS, readRequest} from './lexicon.js'
export {CARD_TEMPLATES, ITEM_TEMPLATES, TOKEN_TEMPLATES} from './templates.js'
export {WORLD_PRESETS, presetEntries, presetWorldChanges} from './presets.js'
