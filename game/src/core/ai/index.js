// EVER AI: public API of core/ai. Import from here.
//   MVP:  createAiController (Connect AI, sign-in, 429 per book), proposeFreeText (Marcus free text)
//   v2:   createAiTransport (generic bridge call), runMoment (NPC reply + 1-3 offers),
//         createMomentSession (thinking state, 20 s deadline, prefetch while walking),
//         runWorldProposals / validateWorldProposal (Last Page -> bot endpoint; wire format and
//         base validator from platform/world-schema.js)
// Every model answer is hostile data: it goes through json.js, text.js and the mechanics
// validator + balance sim; on any failure the offline generator (content-gen) stands in.
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

export {createAiController, proposeFreeText} from './free-text.js'
export {createAiTransport, BRIDGE_LIMITS} from './bridge.js'
export {extractJsonObject, MAX_JSON_BYTES, MAX_MODEL_TEXT} from './json.js'
export {cleanReplyText, cleanWorldText, cleanTitle} from './text.js'
export {PROMPT_VERSION, momentInstructions, buildMomentInput, worldInstructions, buildWorldInput, libraryText} from './prompts.js'
export {runMoment, offlineMoment, parseMomentText, checkMomentOffer, MAX_AI_OFFERS} from './moment.js'
export {createMomentSession, momentKey} from './session.js'
export {WORLD_CHANGE_VERSION, WORLD_KINDS, validateWorldProposal, worldHash, runWorldProposals} from './world.js'
export {AI_LINES, FALLBACK_REPLIES, fallbackReply} from './lines.js'
