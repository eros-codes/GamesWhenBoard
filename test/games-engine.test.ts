import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Card, Deck } from '../src/games/data.js';
import { clockLeft, pauseClock, resumeClock, startClock } from '../src/games/kit/clock.js';
import { cardPool, drawCard, nextSeen, pickCards } from '../src/games/kit/deck.js';
import { finalNames, joinNames } from '../src/games/kit/names.js';
import type { Rng } from '../src/games/kit/random.js';
import {
	SPY_CANDIDATES,
	accuse,
	declareGuess,
	defaultMinutes,
	guessPlace,
	maxSpies,
	newRound,
	nextSpyRound,
	startQuestions,
	startSpyGame,
	type SpySettings,
	type SpyState,
} from '../src/games/spy/engine.js';
import {
	answer,
	endsTurn,
	currentRound,
	currentSide,
	finishTurn,
	leaders,
	playAgain,
	startTurn,
	startWordGame,
	timeUp,
	toggleResult,
	turnPoints,
	type WordSettings,
	type WordState,
} from '../src/games/words/engine.js';
import { HOLD_MS, faceUp, initialTilt, tiltStep, type TiltState } from '../src/games/words/tilt.js';
import { readFileSync } from 'node:fs';
import { readGamesFile, textId, type GameKey, type GamesFile } from '../src/games/data.js';

// Unit tests of the games page: the card text format, when a game can be shown, and the engines of
// «جاسوس», the word games and the forehead tilt (all pure functions).

/** A repeatable random source (mulberry32). */
function seeded(seed: number): Rng {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const cards = (texts: string[], from = 1): Card[] => texts.map((text, i) => ({ id: from + i, text }));
const PLACES = cards(['فرودگاه', 'بیمارستان', 'مدرسه', 'سینما', 'بانک', 'کافه', 'پارک', 'موزه', 'استخر', 'هتل', 'ساحل', 'مزرعه', 'قطار', 'هواپیما', 'کتابخانه', 'باغ وحش', 'بازار', 'نانوایی', 'سیرک', 'دانشگاه', 'آرایشگاه', 'کویر', 'جنگل', 'کشتی', 'رستوران']);

describe('the word lists (public/data/games.json)', () => {
	const file = JSON.parse(readFileSync(new URL('../public/data/games.json', import.meta.url), 'utf8')) as GamesFile;
	const data = readGamesFile(file);

	test('every listed game has enough cards to be shown, in the order of the file', () => {
		assert.ok(data.enabled);
		if (!data.enabled) return;
		assert.deepEqual(data.games, file.games, 'all games of the list are playable');
		assert.equal(data.games.length, 12);
	});

	test('each word gets one id, whatever deck it is in; decks get their own', () => {
		if (!data.enabled) return;
		const byId = new Map<number, string>();
		for (const deck of data.decks) {
			for (const card of deck.cards) {
				const other = byId.get(card.id);
				assert.ok(other === undefined || other === card.text, `${card.text} and ${other} share an id`);
				byId.set(card.id, card.text);
			}
		}
		assert.equal(new Set(data.decks.map((d) => d.id)).size, data.decks.length);
	});

	test('«کلمات ممنوعه» has its forbidden words', () => {
		if (!data.enabled) return;
		const taboo = data.decks.filter((d) => d.games.includes('taboo')).flatMap((d) => d.cards);
		assert.ok(taboo.length >= 20);
		assert.ok(taboo.every((card) => card.forbidden && card.forbidden.length > 0));
	});
});

describe('reading games.json', () => {
	const many = (n: number, prefix = 'w') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

	test('a card is a word or {text, forbidden}; spellings are made the same and repeats left out', () => {
		const data = readGamesFile({
			games: ['taboo', 'spy'],
			decks: [
				{ name: 'الف', games: ['spy'], cards: ['كافه', 'کافه', '  ', ...many(10)] },
				{ name: 'ب', games: ['taboo'], cards: [{ text: 'قهوه', forbidden: ['فنجان', 'فنجان', ' تلخ '] }, ...many(25).map((t) => ({ text: t, forbidden: ['x'] }))] },
			],
		});
		assert.ok(data.enabled);
		if (!data.enabled) return;
		const spy = data.decks.find((d) => d.name === 'الف')!;
		assert.deepEqual(spy.cards.slice(0, 2).map((c) => c.text), ['کافه', 'w0']);
		const coffee = data.decks.find((d) => d.name === 'ب')!.cards[0];
		assert.deepEqual(coffee, { id: textId('قهوه'), text: 'قهوه', forbidden: ['فنجان', 'تلخ'] });
		assert.deepEqual(data.games, ['taboo', 'spy'], 'in the order of the file');
	});

	test('a word game without enough cards is not shown; unknown games are ignored', () => {
		const data = readGamesFile({
			games: ['spy', 'heads_up', 'taboo', 'chess', 'poker'],
			decks: [
				{ name: 'کم', games: ['spy', 'heads_up'], cards: many(12) },
				{ name: 'بی‌ممنوعه', games: ['taboo'], cards: many(40) },
			],
		});
		if (!data.enabled) return assert.fail();
		assert.deepEqual(data.games, ['spy', 'chess'] as GameKey[], 'heads_up needs 30, taboo needs forbidden words, poker is no game');
		assert.deepEqual(data.decks.map((d) => d.games), [['spy']]);
	});

	test('ids come from the text: the same after words are added or moved', () => {
		const a = readGamesFile({ games: ['spy'], decks: [{ name: 'د', games: ['spy'], cards: many(12) }] });
		const b = readGamesFile({ games: ['spy'], decks: [{ name: 'د', games: ['spy'], cards: ['تازه', ...many(12).reverse()] }] });
		if (!a.enabled || !b.enabled) return assert.fail();
		const idOf = (d: typeof a, text: string) => d.decks[0].cards.find((c) => c.text === text)?.id;
		assert.equal(idOf(a, 'w3'), idOf(b, 'w3'));
		assert.equal(a.decks[0].id, b.decks[0].id);
	});
});

describe('drawing cards', () => {
	const decks: Deck[] = [
		{ id: 1, name: 'a', games: ['heads_up'], cards: cards(['سیب', 'موز', 'انار']) },
		{ id: 2, name: 'b', games: ['heads_up', 'charades'], cards: [...cards(['موز'], 10), ...cards(['هلو'], 11)] },
		{ id: 3, name: 'c', games: ['taboo'], cards: [{ id: 20, text: 'قهوه', forbidden: ['فنجان'] }, { id: 21, text: 'چای' }] },
	];

	test('the pool: the chosen decks of the game (all when none chosen), one card per text', () => {
		assert.deepEqual(
			cardPool(decks, 'heads_up', []).map((c) => c.text),
			['سیب', 'موز', 'انار', 'هلو'],
		);
		assert.deepEqual(
			cardPool(decks, 'heads_up', [2]).map((c) => c.text),
			['موز', 'هلو'],
		);
		assert.deepEqual(
			cardPool(decks, 'taboo', [], (c) => Boolean(c.forbidden?.length)).map((c) => c.text),
			['قهوه'],
		);
	});

	test('fresh cards first; the avoided ones only when nothing else is left', () => {
		const pool = cards(['a', 'b', 'c', 'd']);
		const avoid = new Set([1, 2, 3]);
		assert.deepEqual(
			pickCards(pool, 1, avoid, seeded(1)).map((c) => c.id),
			[4],
		);
		const two = pickCards(pool, 2, avoid, seeded(2));
		assert.equal(two[0].id, 4);
		assert.equal(two.length, 2);
		assert.equal(new Set(pickCards(pool, 4, new Set(), seeded(3)).map((c) => c.id)).size, 4, 'never the same card twice');
	});

	test('a game never draws a card twice while others are left, even when those were all seen lately', () => {
		const pool = cards(['a', 'b', 'c', 'd', 'e', 'f']);
		// a, b, c played in this game; the phone also saw d, e, f in an earlier game
		const used = [1, 2, 3];
		const seen = [4, 5, 6, 1, 2, 3];
		for (let seed = 1; seed <= 200; seed++) {
			const card = drawCard(pool, used, seen, seeded(seed));
			assert.ok(card && !used.includes(card.id), `seed ${seed}: ${card?.text}`);
		}
		// unseen first among the unused
		assert.equal(drawCard(pool, used, [4, 5], seeded(7))?.id, 6);
		// every card used: only then one comes again
		assert.ok(drawCard(pool, [1, 2, 3, 4, 5, 6], seen, seeded(8)));
		assert.equal(drawCard([], [], [], seeded(9)), null);
	});

	test('the phone remembers at most 70% of a pool, newest last', () => {
		assert.deepEqual(nextSeen([1, 2, 3], [4], 5), [2, 3, 4]);
		assert.deepEqual(nextSeen([1, 2], [1], 10), [2, 1], 'seen again moves to the end');
		assert.deepEqual(nextSeen([1], [2], 1), []);
	});
});

describe('clock and names', () => {
	test('a paused clock keeps its time; resumed, it counts down again', () => {
		const clock = startClock(60_000, 1_000);
		assert.equal(clockLeft(clock, 11_000), 50_000);
		const paused = pauseClock(clock, 11_000);
		assert.equal(clockLeft(paused, 99_000), 50_000);
		const resumed = resumeClock(paused, 100_000);
		assert.equal(clockLeft(resumed, 110_000), 40_000);
		assert.equal(clockLeft(resumed, 999_000), 0);
	});

	test('empty names become «بازیکن n»; repeated names get a number', () => {
		const placeholder = (i: number) => `بازیکن ${i + 1}`;
		assert.deepEqual(finalNames(['سارا', '  ', 'سارا', ' علی  رضا '], placeholder), ['سارا', 'بازیکن 2', 'سارا ۲', 'علی رضا']);
		assert.equal(joinNames(['سارا', 'علی', 'رضا']), 'سارا، علی و رضا');
	});
});

describe('«جاسوس»', () => {
	const players = ['سارا', 'علی', 'رضا', 'مینا', 'نیما', 'لیلا', 'آرش'];
	const settings: SpySettings = { players, spies: 1, minutes: 6, deckIds: [] };

	test('a round: one real place, a sorted list of candidates with it, spies among the players', () => {
		const round = newRound(settings, PLACES, new Set(), seeded(7));
		assert.equal(round.candidates.length, SPY_CANDIDATES);
		assert.ok(round.candidates.includes(round.place));
		assert.deepEqual(round.candidates, [...round.candidates].sort((a, b) => a.localeCompare(b, 'fa')));
		assert.equal(round.spies.length, 1);
		assert.ok(round.starter >= 0 && round.starter < players.length);
	});

	test('two spies only from six players up', () => {
		assert.equal(maxSpies(5), 1);
		assert.equal(maxSpies(6), 2);
		assert.equal(newRound({ ...settings, spies: 2 }, PLACES, new Set(), seeded(3)).spies.length, 2);
		assert.equal(newRound({ ...settings, players: players.slice(0, 4), spies: 2 }, PLACES, new Set(), seeded(3)).spies.length, 1);
		assert.equal(defaultMinutes(3), 5);
		assert.equal(defaultMinutes(12), 8);
	});

	test('with topics, the list holds words of the word’s own topic only, and the round knows the topic', () => {
		const animals = Array.from({ length: 30 }, (_, i) => ({ id: 1000 + i, text: `حیوان ${i}` }));
		const topics = [
			{ name: 'مکان‌ها', cards: PLACES },
			{ name: 'حیوانات', cards: animals },
		];
		for (let seed = 1; seed <= 20; seed++) {
			const round = newRound(settings, [...PLACES, ...animals], new Set(), seeded(seed), topics);
			const topic = topics.find((t) => t.cards.some((c) => c.text === round.place))!;
			assert.equal(round.topic, topic.name);
			for (const word of round.candidates) assert.ok(topic.cards.some((c) => c.text === word), `${word} is not in «${topic.name}»`);
		}
		// without topics (a saved game from before): the whole pool, no topic
		assert.equal(newRound(settings, PLACES, new Set(), seeded(2)).topic, undefined);
	});

	test('a place seen lately is avoided while others are left', () => {
		const avoid = new Set(PLACES.slice(1).map((c) => c.id));
		assert.equal(newRound(settings, PLACES, avoid, seeded(5)).place, PLACES[0].text);
	});

	const started = (): SpyState => startQuestions(startSpyGame(settings, PLACES, new Set(), seeded(11)), 0);
	const citizen = (state: SpyState) => players.findIndex((_, i) => !state.round!.spies.includes(i));

	test('accusing a citizen: the spies win, +2 for each spy', () => {
		const state = started();
		const result = accuse(state, citizen(state));
		assert.equal(result.phase.kind, 'result');
		assert.equal(result.phase.kind === 'result' && result.phase.outcome.how, 'wrong');
		assert.equal(result.scores[state.round!.spies[0]], 2);
		assert.equal(result.scores.reduce((a, b) => a + b, 0), 2);
	});

	test('catching the spy: the spy still gets one guess at the place', () => {
		const state = started();
		const spy = state.round!.spies[0];
		const caught = accuse(state, spy);
		assert.deepEqual(caught.phase, { kind: 'guess', accused: spy, by: null });
		const wrongPlace = state.round!.candidates.find((p) => p !== state.round!.place)!;
		const lost = guessPlace(caught, wrongPlace);
		assert.equal(lost.phase.kind === 'result' && lost.phase.outcome.winner, 'citizens');
		assert.equal(lost.scores[spy], 0);
		assert.equal(lost.scores.reduce((a, b) => a + b, 0), players.length - 1, '+1 for every citizen');
		const escaped = guessPlace(caught, state.round!.place);
		assert.equal(escaped.phase.kind === 'result' && escaped.phase.outcome.how, 'escaped');
	});

	test('a spy who stops the game: right place wins, wrong place loses', () => {
		const begun = started();
		const spy = begun.round!.spies[0];
		const state = declareGuess(begun, spy);
		assert.deepEqual(state.phase, { kind: 'guess', accused: null, by: spy });
		const right = guessPlace(state, state.round!.place);
		assert.equal(right.phase.kind === 'result' && right.phase.outcome.how, 'guessed');
		assert.equal(right.phase.kind === 'result' && right.phase.outcome.how === 'guessed' && right.phase.outcome.by, spy);
		const wrong = guessPlace(state, state.round!.candidates.find((p) => p !== state.round!.place)!);
		assert.equal(wrong.phase.kind === 'result' && wrong.phase.outcome.how, 'missed');
	});

	test('only a spy can stop the game to guess: a citizen knows the place and would win it for the spies', () => {
		const begun = started();
		const citizen = begun.settings.players.findIndex((_, i) => !begun.round!.spies.includes(i));
		assert.equal(declareGuess(begun, citizen), begun);
	});

	test('the next round keeps the scores and deals again from the first player', () => {
		const done = accuse(started(), 0);
		const next = nextSpyRound(done, PLACES, new Set(), seeded(99));
		assert.equal(next.roundNo, 2);
		assert.deepEqual(next.scores, done.scores);
		assert.deepEqual(next.phase, { kind: 'deal', index: 0, showing: false });
		assert.equal(next.clock, null);
	});
});

describe('word games', () => {
	const words = cards(['سیب', 'موز', 'انار', 'هلو', 'گیلاس']);
	const base: WordSettings = { mode: 'charades', sides: ['تیم ۱', 'تیم ۲'], seconds: 60, rounds: 2, deckIds: [], oneWord: false };
	const playing = (settings: Partial<WordSettings> = {}): WordState => startTurn(startWordGame({ ...base, ...settings }), words[0], 0);

	test('a turn: guessed, passed, then the clock runs out on the card on screen', () => {
		let state = playing();
		state = answer(state, 'correct', words[1]);
		state = answer(state, 'pass', words[2]);
		state = timeUp(state);
		assert.equal(state.phase.kind, 'review');
		const results = state.phase.kind === 'review' ? state.phase.results : [];
		assert.deepEqual(
			results.map((r) => [r.text, r.outcome]),
			[
				['سیب', 'correct'],
				['موز', 'pass'],
				['انار', 'pass'],
			],
		);
		assert.deepEqual(state.used, [1, 2, 3]);
		assert.equal(turnPoints(results), 1);
	});

	test('«پانتومیم» one word per turn: the first guess ends the turn', () => {
		assert.equal(endsTurn(playing({ oneWord: true }), 'correct'), true, 'no next card is drawn for nothing');
		assert.equal(endsTurn(playing({ oneWord: true }), 'pass'), false);
		assert.equal(endsTurn(playing({ oneWord: false }), 'correct'), false);
		const state = answer(playing({ oneWord: true }), 'correct', words[1]);
		assert.equal(state.phase.kind, 'review');
	});

	test('a forbidden word only exists in «کلمات ممنوعه» and costs a point', () => {
		const charades = playing();
		assert.equal(answer(charades, 'buzz', words[1]), charades, 'no buzz in charades');
		let taboo = playing({ mode: 'taboo' });
		taboo = answer(taboo, 'buzz', words[1]);
		taboo = answer(taboo, 'correct', null);
		assert.equal(taboo.phase.kind, 'review', 'no card left: the turn ends');
		assert.equal(taboo.phase.kind === 'review' && turnPoints(taboo.phase.results), 0);
	});

	test('fixing the list after a turn cycles the outcome (taboo has three)', () => {
		let taboo = timeUp(playing({ mode: 'taboo' }));
		taboo = toggleResult(taboo, 0);
		assert.equal(taboo.phase.kind === 'review' && taboo.phase.results[0].outcome, 'buzz');
		taboo = toggleResult(taboo, 0);
		assert.equal(taboo.phase.kind === 'review' && taboo.phase.results[0].outcome, 'correct');
		let heads = timeUp(playing({ mode: 'heads_up', sides: ['a', 'b'] }));
		heads = toggleResult(toggleResult(heads, 0), 0);
		assert.equal(heads.phase.kind === 'review' && heads.phase.results[0].outcome, 'pass', 'two outcomes only');
	});

	test('turns go round the sides; after the last round the game is over', () => {
		let state = startWordGame(base);
		const play = (points: number) => {
			state = startTurn(state, words[0], 0);
			for (let i = 0; i < points; i++) state = answer(state, 'correct', words[i + 1] ?? words[0]);
			state = finishTurn(timeUp(state));
		};
		assert.equal(currentSide(state), 0);
		play(2);
		assert.equal(currentSide(state), 1);
		assert.equal(currentRound(state), 1);
		play(1);
		assert.equal(currentRound(state), 2);
		play(0);
		assert.equal(state.phase.kind, 'ready');
		play(3);
		assert.equal(state.phase.kind, 'over');
		assert.deepEqual(state.scores, [2, 4]);
		assert.deepEqual(leaders(state.scores), [1]);
		assert.deepEqual(leaders([3, 3, 1]), [0, 1], 'a tie');
		const again = playAgain(state);
		assert.deepEqual(again.scores, [0, 0]);
		assert.equal(again.phase.kind, 'ready');
	});
});

describe('forehead tilt', () => {
	test('screen up = 1, upright (portrait or landscape) = 0, face down = −1', () => {
		assert.equal(Math.round(faceUp(0, 0) * 100) / 100, 1);
		assert.ok(Math.abs(faceUp(90, 0)) < 1e-9);
		assert.ok(Math.abs(faceUp(0, 90)) < 1e-9);
		assert.ok(Math.abs(faceUp(0, -90)) < 1e-9);
		assert.equal(Math.round(faceUp(180, 0)), -1);
		// landscape past upright: the browser flips beta by 180 and gamma changes sign, the value stays continuous
		assert.ok(faceUp(180, 60) < -0.4);
		assert.ok(faceUp(0, 60) > 0.4);
	});

	const run = (readings: [number, number][]) => {
		let state: TiltState = initialTilt();
		const events: string[] = [];
		for (const [value, at] of readings) {
			const step = tiltStep(state, value, at);
			state = step.state;
			if (step.event) events.push(step.event);
		}
		return events;
	};

	test('nothing counts until the phone stood upright once', () => {
		assert.deepEqual(
			run([
				[-0.9, 0],
				[-0.9, 500],
			]),
			[],
		);
	});

	test('down = correct, up = pass, each tilt counted once until the phone is upright again', () => {
		assert.deepEqual(
			run([
				[0, 0],
				[-0.8, 100],
				[-0.8, 100 + HOLD_MS],
				[-0.9, 400],
				[0.1, 600],
				[0.8, 700],
				[0.8, 700 + HOLD_MS],
			]),
			['correct', 'pass'],
		);
	});

	test('a quick shake is not an answer', () => {
		assert.deepEqual(
			run([
				[0, 0],
				[-0.8, 100],
				[0.1, 120],
				[0.7, 140],
				[0, 160],
			]),
			[],
		);
	});
});
