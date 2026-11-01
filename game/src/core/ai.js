// Moved: the AI code lives in core/ai/ now (free-text.js for the MVP Marcus pipeline,
// moment.js / world.js / session.js for v2). This shim keeps old imports working; new code
// imports from './ai/index.js'.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later
export {createAiController, proposeFreeText} from './ai/free-text.js'
