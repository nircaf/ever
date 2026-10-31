// EVER world scenery: Ashbrook built from the art kit for the follow camera.
// OWNER: world engineer. Same pieces, seeds and GDD coordinates as style.js
// buildAshbrook(); the only difference is the pine ring, which leaves the south strip
// open (nav.js RING_GAPS) so no tree ever stands between the camera and the player.
// Every client in a room builds identical geometry (all seeds are fixed).
//
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

import * as THREE from 'three'
import {ASHBROOK, makeHouse, makePineRing, makeRockScatter, makeStation, makeStoneWall, makeTerrain, makeTree, pickQuality} from '../shared/style.js'
import {LAYOUT, RING_GAPS} from './nav.js'

/**
 * @returns {{root: THREE.Group, stations: Record<'well'|'forge'|'grindstone'|'lectern'|'shrine'|'gate'|'signpost', any>, houses: THREE.Object3D[], occluders: THREE.Object3D[]}}
 */
export function buildVillage({quality = pickQuality()} = {}) {
	const root = new THREE.Group()
	root.name = 'ever:ashbrook'
	root.add(makeTerrain())
	root.add(makePineRing({count: quality === 'low' ? 60 : 92, gaps: RING_GAPS}))
	root.add(makeStoneWall({gaps: [[0, 31.2, 2.5]]}))
	root.add(makeRockScatter({count: 18, area: 50}))
	const S = ASHBROOK
	const place = (o, [x, z], ry = 0) => {
		o.position.set(x, 0, z)
		o.rotation.y = ry
		root.add(o)
		return o
	}
	const stations = {
		well: place(makeStation('well'), S.well, 0.2),
		forge: place(makeStation('forge'), S.forge, LAYOUT.forge.rot),
		grindstone: place(makeStation('grindstone'), S.grindstone, 0.4),
		lectern: place(makeStation('lectern'), S.lectern, -Math.PI / 2 + 0.3),
		shrine: place(makeStation('shrine'), S.shrine, -0.6),
		gate: place(makeStation('gate'), S.gateCircle),
		signpost: place(makeStation('signpost'), S.spawn, 0),
	}
	const trees = [place(makeTree({kind: 'round', seed: 31, scale: 1.1}), S.bigTree)]
	S.shrinePines.forEach((p, i) => trees.push(place(makeTree({seed: 200 + i, scale: 1.1}), p)))
	const houses = S.houses.map((p, i) => place(makeHouse({seed: 300 + i}), p, Math.atan2(-p[0], -p[1])))
	// Scenery the world fades out when it comes between the camera and what you look at.
	return {root, stations, houses, occluders: [...houses, ...trees]}
}
