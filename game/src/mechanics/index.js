// EVER mechanics: public API. Import from here, not from the inner files.
//   import {validateContent, compileCard, balanceCheck, createRunContent, ...} from '../mechanics/index.js'
// Everything is PURE (no DOM, no timers, no network) and importable by the browser and
// by server/. Docs: docs/MECHANICS.md.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

export const MECHANICS_VERSION = '1.0.0'

// Library (enums, blocks, budgets, caps) and the AI-facing description of it.
export {
	ART_PROPS, ART_TINTS, CARD_BUDGET, CARD_RARITIES, CARD_TARGETS, CARD_TYPES, CONDITIONS, CONDITION_IDS, CONTENT_KINDS, CURSE_BUDGET,
	EFFECTS, EFFECT_IDS, ENGINE_CARD_REFS, HARD_CAPS, ITEM_BUDGET, ITEM_SLOTS, POWERS, POWER_KINDS, RARITIES, SCALINGS, SCALING_IDS,
	SIZE_LIMITS, THEMES, TOKEN_BUDGET, TRIGGERS, TRIGGER_IDS, UPGRADE_BUDGET, describeLibrary,
} from './library.js'
export {effectSpec, allEffectIds, codeBlockIds, isCodeBlock, CODE_BLOCK_ERRORS} from './blocks-registry.js'

// Schema and validation.
export {MECH_SCHEMA_VERSION, GEN_PREFIX, isGeneratedId, isValidGenId, normalizeContent, buildJsonSchema} from './schema.js'
export {validateContent, OFFER_KINDS, RAW_MAX_BYTES} from './validate.js'
export {scoreContent, checkBudget, checkCaps, effectPP, cardBudget} from './budget.js'
export {cleanName, cleanFlavor, rulesText, effectText, triggerText, BASE_BLOCKLIST} from './text.js'
export {upgradedCard} from './upgrade.js'

// Compiler and engine integration (combat/rules calls the hooks; others rarely need them).
export {compileCard, compileDeckCard, compileItem, compileToken, cardTemplate, EVER_OPS} from './compile.js'
export {installEngineExtensions, afterFight} from './engine.js'

// Balance simulator.
export {balanceCheck, simulateFight, deckCards, SIM_BANDS, SIM_NOISE, QUICK_FIGHTS, SIM_VERSION} from './sim.js'
export {KEEPSAKES, SIM_ENEMIES, REFERENCE_DECKS, REFERENCE_ITEMS, wardenHpForPages, stageOf} from './reference.js'

// Seeds, run content registry, offline generator.
export {rng, hash32, hashId, canonicalJson, shuffle, pick, pickWeighted, randInt} from './prng.js'
export {createRunContent, addContent, removeContent, getDef, contentId, serializeRunContent, parseRunContent, RUN_CONTENT_VERSION} from './registry.js'
export {generateContent, LEXICON} from './generate.js'
