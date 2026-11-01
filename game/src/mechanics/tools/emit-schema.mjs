#!/usr/bin/env node
// EVER mechanics: print the generated-content JSON Schema (draft 2020-12) and the AI-facing
// library description, for tools that are not JavaScript (CI, world/ editors).
//   node game/src/mechanics/tools/emit-schema.mjs            -> JSON Schema
//   node game/src/mechanics/tools/emit-schema.mjs --library  -> describeLibrary()
//
// Copyright (C) 2026 the EVER contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

import {buildJsonSchema, describeLibrary} from '../index.js'

const out = process.argv.includes('--library') ? describeLibrary() : buildJsonSchema()
process.stdout.write(`${JSON.stringify(out, null, '\t')}\n`)
