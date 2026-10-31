// EVER copy: every on-screen string owned by core/ (GDD section 6). Plain data, no DOM,
// so rules and the room server can share it. Tone: plain, warm, short, sentence case.
// OWNER: systems engineer.
// Copyright (C) 2026 the EVER contributors. SPDX-License-Identifier: AGPL-3.0-or-later

export const COPY = Object.freeze({
	title: 'EVER',
	book: (n) => `Book ${n}`,
	begin: 'Begin a new book',
	host: 'Host a game',
	join: 'Join a game',
	creditsLink: 'Credits',
	footer: 'Card combat built on Slay the Web by Oskar Rough and contributors. AGPL-3.0-or-later.',
	aiOn: (email) => `AI: on (${email})`,
	aiConnect: 'Connect ChatGPT',
	aiConnecting: 'Waiting for sign-in...',
	aiOffNote: 'Marcus is voiced by a local script.',
	aiOnNote: "AI voices Marcus. The game's rules decide what happens.",

	chapter: {
		kicker: 'Chapter One',
		name: 'The Ash Gate',
		line: 'In Ashbrook the forge has gone cold, and something waits at the north gate.',
		turn: 'Click to turn the page',
	},

	hud: {
		hp: (cur, max) => `HP ${cur}/${max}`,
		deck: (n) => `Deck ${n}`,
		deckTip: 'Your deck. Press Tab to look.',
		doubts: (n) => `Doubt ${n}`,
		doubtTip: 'Curses in your deck. Each Doubt in hand at the end of your turn costs 2 HP.',
		tokens: 'Tokens',
		tokenTip: {
			ember: 'Ember: +1 Energy on your first turn.',
			ward: 'Ward: start the fight with 8 Block.',
			whetstone: 'Whetstone: the Warden starts Vulnerable.',
		},
		tokenName: {ember: 'Ember', ward: 'Ward', whetstone: 'Whetstone'},
		room: (code) => `Room ${code}`,
		roomCopied: 'Room code copied.',
		partyRow: (name, hp, max) => `${name} · HP ${hp}/${max}`,
	},

	prompts: {
		well: 'Look into the well',
		lectern: 'Read the stone',
		grindstone: 'Use the grindstone',
		shrine: 'Touch the shrine',
		marcus: 'Talk to Marcus',
	},

	stations: {
		well: {
			title: 'The Well',
			text: 'Cold water, very deep. It will take one thing from you, or give you one.',
			drop: 'Drop a card in',
			ward: 'Draw up the Ward',
			leave: 'Leave',
			done: 'The well is still.',
			pick: 'Choose a card to drop in the well.',
		},
		lectern: {
			title: 'The Margin Stone',
			text: 'Three cards are written in the margin. One can be yours.',
			leave: 'Leave them',
			done: 'The margin is blank now.',
		},
		grindstone: {
			title: 'The Grindstone',
			text: 'A worn wheel. Good for one sharp edge.',
			take: 'Sharpen (take Whetstone)',
			leave: 'Leave',
			done: 'The wheel has stopped.',
		},
		anvil: {title: 'The Anvil', text: 'Choose a card to upgrade.', notNow: 'Not now'},
		shrine: {
			title: 'The Crooked Shrine',
			text: 'Power, freely given. Almost.',
			small: 'Gain Bludgeon. Two Doubts are written into your deck.',
			take: 'Take the Bludgeon',
			leave: 'Walk away',
			done: 'The shrine is dark.',
		},
		marcus: {title: 'Marcus Hale'},
		gate: {text: 'The Warden stirs. Begin the fight?', fight: 'Fight', notYet: 'Not yet'},
	},

	toasts: {
		cardGained: (name) => `Card gained: ${name}`,
		cardRemoved: (name) => `Card removed: ${name}`,
		upgraded: (name) => `Upgraded: ${name}+`,
		tokenGained: (name) => `Token gained: ${name}`,
		doubt: 'A Doubt is written into your deck.',
		tokensFull: 'Tokens are full.',
		shrine: 'Bludgeon added. Two Doubts are written into your deck.',
		anvilOpen: 'The anvil is open.',
		trustUp: 'Marcus trusts you more.',
		trustDown: 'Marcus trusts you less.',
		aiUnavailable: 'AI unavailable, using the local script.',
		aiLimit: 'AI usage limit reached. Using the local script.',
	},

	free: {
		placeholder: 'e.g. I help him sweep the cold ash',
		go: 'Do it',
		open: 'Try something else',
		back: 'Back',
		leave: 'Leave',
		thinking: 'Marcus thinks it over',
	},

	errors: {generic: 'Something went wrong. Please try again.'},

	deck: {title: 'Your deck', close: 'Close', empty: 'The deck is empty.'},

	combat: {
		intro: 'The Warden stirs. Begin the fight?',
	},

	win: {
		heading: 'Chapter complete',
		body: 'The Warden falls apart into cooling ash. In the cinders you find a small hammer.',
		second: 'The rest of this book is still unwritten. That is a story for another day!',
		stat: (n, turns, hp) => `Book ${n} · ${turns} turns · ${hp} HP left`,
		begin: 'Begin a new book',
		stay: 'Stay in Ashbrook',
		votes: (v, m) => `${v}/${m} ready for a new book`,
		waiting: 'Waiting for your friends...',
	},

	death: {
		heading: 'The book closes',
		body: 'The ash settles. This story ends here, but you can always begin another.',
		stat: (n, t) => `Book ${n} · fell on turn ${t}`,
		remember: 'The next book will remember:',
		begin: 'Begin a new book',
		coop: 'Your friends read on. You start again at page one.',
		partyLost: 'The Warden stands. Every book at the gate is closed.',
	},

	mp: {
		hostTitle: 'Your room code',
		hostShare: 'Share it with up to 3 friends.',
		copy: 'Copy code',
		copied: 'Room code copied.',
		enter: 'Enter Ashbrook',
		joinTitle: 'Join a game',
		code: 'Room code',
		name: 'Your name',
		joinGo: 'Join',
		back: 'Back',
		hostName: 'Your name',
		creating: 'Opening a room...',
		joining: 'Joining...',
		leave: 'Leave room',
		errors: {
			no_room: 'No room with that code.',
			full: 'That room is full.',
			version: 'That room runs a different version of EVER. Refresh the page.',
			network: "Can't reach the room server. Check your connection.",
			name: "Name can't be empty.",
			code: 'Room codes are 5 characters.',
		},
		joined: (n) => `${n} joined.`,
		left: (n) => `${n} left.`,
		dropped: (n) => `${n} lost connection. Keeping their seat.`,
		back2: (n) => `${n} is back.`,
		reconnecting: 'Reconnecting...',
		restored: "You're back in the room.",
		lobby: (n, m) => `${n}/${m} ready at the gate`,
		ready: 'Ready',
		notReady: 'Cancel ready',
		waiting: (n, m) => `Waiting for friends... ${n}/${m} ready`,
		startsIn: (s) => `The fight starts in ${s}s.`,
		locked: (n) => `Your party is fighting the Warden. Round ${n}.`,
		youAre: 'You',
	},

	credits: {
		title: 'Credits',
		lines: [
			'EVER: Evolving Virtual Experiences & Reincarnation.',
			'Card combat is built on Slay the Web by Oskar Rough and contributors (github.com/oskarrough/slaytheweb), commit a108c3e, AGPL-3.0-or-later.',
			'All art is generated by code: low-poly shapes from Three.js. No downloaded art.',
			'EVER is free software under the GNU Affero General Public License, version 3 or later. The source is available from the same place you found this page.',
		],
		close: 'Close',
	},

	hints: {
		walk: 'Walk into the village. Forge west, stone east, gate north.',
		forge: 'Someone is standing in the forge, to the west.',
		/** @param {('lectern'|'grindstone')[]} left places not yet visited */
		look: (left) =>
			`Still to see: ${left.map((k) => ({lectern: 'the stone by the tree (east)', grindstone: 'the grindstone (west)'})[k]).join(' and ')}.`,
		gate: 'The Ash Gate is north.',
	},

	rememberedLines: {
		trust3: "Come back to the forge. I'll keep it warm.",
		wonCold: 'The gate is quiet. Tobin can rest.',
		struck: "You drew steel in a grieving man's forge.",
		died: "The Warden's ash settles on an unfinished page.",
	},
})
