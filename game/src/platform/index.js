// EVER platform: world data (major changes), editions, versions. Public API.
//   import {createWorldLoader, checkPin, createVersionWatcher, ...} from '../platform/index.js'
// Docs: docs/PLATFORM.md. Pure modules except where noted (the loader and the watcher use
// fetch/localStorage only when called).
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

export {
	WORLD_SCHEMA_VERSION, WORLD_TYPES, PROPOSAL_KINDS, ANCHORS, ANCHOR_LABELS, PLACE_PROPS, PLACE_LABELS, LINE_NPCS, ARCHETYPES, TRUST_WORDS, OFFER_BIAS, LIMITS,
	cleanLine, validateWorldEntry, validateProposal, validateRun, serializeEntry, entryKey, entryName, entryTitle, entrySummary, entryPath, sha256Hex,
	addBlockToIndex, blockImportName,
} from './world-schema.js'
export {MANIFEST_VERSION, LEDGER_MAX, fileHash, emptyManifest, checkManifest, filesForEdition, hasKey, addToManifest, serializeManifest} from './world-manifest.js'
export {createWorldLoader, resolveWorld, linesFor, presetsFor, proposalFromPreset, WORLD_SNAPSHOT_KEY} from './world-loader.js'
export {ENGINE_VERSION, ENGINE_BOOK_COMPAT, EDITION_KEEP_DAYS, VERSION_COPY, fillCopy, engineMajor, pinFor, checkPin, createVersionWatcher, installChunkErrorGuard, prefetchChunks} from './version.js'
export {createWorldBotClient, BOT_STATUS_COPY} from './bot-client.js'
