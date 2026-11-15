import { safeStorage } from '../shared/storage.js';

// The games and the cards of the word games, from public/data/games.json: a plain file shipped with the site
// (there is no server). It is edited by hand; see the README for its format. The site works offline (the
// service worker keeps a copy), and a copy of the last data is also kept on the phone, as a second fallback.

export type GameKey = 'spy' | 'heads_up' | 'charades' | 'taboo' | 'tic_tac_toe' | 'connect_four' | 'dots' | 'mafia' | 'ludo' | 'chess' | 'backgammon' | 'checkers';

export interface Card {
	id: number;
	text: string;
	/** «کلمات ممنوعه» only. */
	forbidden?: string[];
}

export interface Deck {
	id: number;
	name: string;
	games: GameKey[];
	cards: Card[];
}

export type GamesData = { enabled: false } | { enabled: true; games: GameKey[]; decks: Deck[] };

// ─── The file ─────────────────────────────────────────────────────────────────

/** games.json as written by hand: a card is a word, or a word with its forbidden words. */
export interface GamesFile {
	/** The games on the list, in their order (leave one out to hide it). */
	games: string[];
	decks: { name: string; games: string[]; cards: (string | { text: string; forbidden?: string[] })[] }[];
}

const GAME_KEYS: readonly GameKey[] = ['spy', 'heads_up', 'charades', 'taboo', 'tic_tac_toe', 'connect_four', 'dots', 'mafia', 'ludo', 'chess', 'backgammon', 'checkers'];
const isGameKey = (value: unknown): value is GameKey => typeof value === 'string' && (GAME_KEYS as readonly string[]).includes(value);

/**
 * How many cards a word game needs before it is shown (کلمات ممنوعه: cards with forbidden words). The same
 * rule the café's server applied.
 */
const CARDS_NEEDED: Partial<Record<GameKey, { min: number; needsForbidden: boolean }>> = {
	spy: { min: 10, needsForbidden: false },
	heads_up: { min: 30, needsForbidden: false },
	charades: { min: 20, needsForbidden: false },
	taboo: { min: 20, needsForbidden: true },
};

/**
 * The same spelling whatever keyboard typed it: Arabic «ي» and «ك» become Persian «ی» and «ک», the kashida and
 * repeated spaces go (as in the café's deck editor).
 */
const normalize = (value: string) =>
	value
		.replace(/ي/g, 'ی')
		.replace(/ك/g, 'ک')
		.replace(/ـ/g, '')
		.replace(/[\t  ]+/g, ' ')
		.trim();

/**
 * A stable number from a text (FNV-1a). Cards and decks get their id from their text, not their place in the
 * file: adding, removing or reordering words in games.json keeps every other id, so what the phone remembers
 * (cards already seen, decks chosen) stays right.
 */
export function textId(text: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 1) || 1;
}

/** games.json → the data the games use. Unknown games, empty words and repeated words are left out. */
export function readGamesFile(file: GamesFile): GamesData {
	const decks: Deck[] = [];
	for (const raw of file.decks ?? []) {
		const name = normalize(String(raw?.name ?? ''));
		const games = (raw?.games ?? []).filter(isGameKey);
		if (!name || !games.length) continue;
		const seen = new Set<string>();
		const cards: Card[] = [];
		for (const entry of raw.cards ?? []) {
			const text = normalize(typeof entry === 'string' ? entry : String(entry?.text ?? ''));
			if (!text || seen.has(text)) continue;
			seen.add(text);
			const forbidden = typeof entry === 'string' ? [] : [...new Set((entry.forbidden ?? []).map((w) => normalize(String(w))).filter(Boolean))];
			cards.push(forbidden.length ? { id: textId(text), text, forbidden } : { id: textId(text), text });
		}
		if (cards.length) decks.push({ id: textId(`deck:${name}`), name, games, cards });
	}

	const listed = [...new Set((file.games ?? []).filter(isGameKey))];
	const games = listed.filter((game) => {
		const need = CARDS_NEEDED[game];
		if (!need) return true;
		const texts = new Set<string>();
		for (const deck of decks) {
			if (!deck.games.includes(game)) continue;
			for (const card of deck.cards) if (!need.needsForbidden || card.forbidden?.length) texts.add(card.text);
		}
		return texts.size >= need.min;
	});

	return {
		enabled: true,
		games,
		decks: decks.map((deck) => ({ ...deck, games: deck.games.filter((g) => games.includes(g)) })).filter((deck) => deck.games.length > 0),
	};
}

// ─── Loading ──────────────────────────────────────────────────────────────────

const CACHE_KEY = 'board.data';
/** Next to the page (the site works from any folder). Read when needed: import.meta.env only exists under Vite. */
const dataUrl = () => `${import.meta.env?.BASE_URL ?? './'}data/games.json`;

function readCache(): GamesData | null {
	try {
		const value = JSON.parse(safeStorage.get(CACHE_KEY) || 'null') as { data?: GamesData } | null;
		return value?.data && typeof value.data === 'object' ? value.data : null;
	} catch {
		return null;
	}
}

/**
 * The games and their cards. Offline the service worker answers from its copy; if even that fails, the last
 * copy on the phone is used (`offline`). Only when there is none either does it fail.
 */
export async function loadGames(): Promise<{ data: GamesData; offline: boolean }> {
	try {
		const response = await fetch(dataUrl(), { cache: 'no-cache' });
		if (!response.ok) throw new Error(`games.json: ${response.status}`);
		const data = readGamesFile((await response.json()) as GamesFile);
		safeStorage.set(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
		return { data, offline: false };
	} catch (error) {
		const cached = readCache();
		if (cached) return { data: cached, offline: true };
		throw new Error('بازی‌ها بارگذاری نشد.', { cause: error });
	}
}

/** The decks that serve a game. */
export const decksFor = (decks: readonly Deck[], game: GameKey) => decks.filter((deck) => deck.games.includes(game) && deck.cards.length > 0);
