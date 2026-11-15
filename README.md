# Board

Party games on one phone, around one table: the games of the Avel café, as a site of their own. Same games,
same rules, same look; no server at all. The site is plain static files, and it works offline: after the first
visit everything is saved on the phone, and it can be added to the home screen like an app.

Games (12): جاسوس، گوشی رو پیشونی، پانتومیم، کلمات ممنوعه، دوز، چهار در یک ردیف، نقطه‌بازی، مافیا، منچ،
شطرنج، تخته نرد، چکرز.

## Run, build, publish

```bash
npm install
npm run dev        # http://localhost:5173 (no offline mode while developing)
npm run build      # → dist/ (type-checks first)
npm run preview    # the built site, with its offline mode
npm test           # the rules of every game, and the word lists
```

`dist/` is the whole site. Copy it to any static host: your own server (nginx), Netlify, Cloudflare Pages,
GitHub Pages… It works from the root of a domain or from any sub-folder (`example.com/board/`), since every path
is relative. Offline mode and «add to home screen» need HTTPS (or `localhost`).

## The words: `public/data/games.json`

All the data of the site is this one file, read by the browser. It was converted from Avel's
`prisma/seed-data/games.json` (42 decks, 3,574 cards).

```json
{
	"games": ["spy", "heads_up", "charades", "taboo", "tic_tac_toe", "connect_four", "dots", "mafia", "ludo", "chess", "backgammon", "checkers"],
	"decks": [
		{ "name": "حیوانات", "games": ["heads_up", "charades", "spy"], "cards": ["شیر", "ببر", "زرافه"] },
		{ "name": "کلمات ممنوعه: کافه", "games": ["taboo"], "cards": [{ "text": "قهوه", "forbidden": ["کافئین", "فنجان", "اسپرسو", "تلخ", "دانه"] }] }
	]
}
```

- **`games`**: the games on the list, in this order. Leave one out to hide it.
- **`decks`**: a name, the games that draw from it (`spy`, `heads_up`, `charades`, `taboo`) and its cards. A card
  is a word, or, for «کلمات ممنوعه», `{ "text", "forbidden": [...] }`. The prefix «کلمات ممنوعه: » of a deck name
  is not shown to the players.
- Spellings are made the same when read (Arabic «ي» «ك» → Persian «ی» «ک»), and a word repeated in a deck counts
  once.
- A word game is only shown when it has enough cards: جاسوس 10، گوشی رو پیشونی 30، پانتومیم 20، کلمات ممنوعه 20
  (cards with forbidden words).
- Every card's id comes from its text, so adding, removing or moving words never mixes up what a phone remembers
  (cards it showed lately, decks it chose).

After editing it, run `npm test` (it checks the file can be read and every listed game has enough cards). The
file is served as it is: on a server, changing `dist/data/games.json` is enough, no new build needed.

## Updates and offline mode

`npm run build` writes `dist/sw.js`, a service worker that saves every file of the build on the phone at the first
visit. The page and `games.json` are always asked from the network first (so a new version or new words arrive at
the next visit), and come from the saved copy only when there is no connection. Code, styles and fonts come from
the saved copy; their file names change with every build. Each build has its own saved copy; the old one is
removed once the new one is in place.

What the phone keeps (in `localStorage`, all prefixed `board.`): the game in progress, the names typed last, the
decks chosen, the cards shown lately, and whether the sound is off.

## Structure

```
index.html              the page
src/main.tsx            starts the page and the service worker
src/GamesPage.tsx       the list of games and the game being played (the address gets #chess, #spy, …)
src/games/              the games, unchanged from Avel: one folder per game, kit/ for what they share
src/games/data.ts       reads games.json
src/styles/             the site's footer, colours, fonts and motion (no header)
src/fonts/              Lora and Baloo Bhaijaan 2 (variable fonts, SIL Open Font License)
src/sw-template.js      the service worker (the build fills in its file list)
public/data/games.json  the words
public/icons/, public/manifest.webmanifest   the app icon and the «add to home screen» details
test/                   tests of every game's rules and of the word lists
```

Colours (dark "game night"): background `#14161F`, cards `#1F2330`, text `#ECE8E1`, amber `#F2B544`, teal `#3FB6A8`, red `#E5604D` — all in `src/styles/tokens.css`. Player colours `--player-1…8` are mirrored in `SIDE_COLORS` (`src/games/kit/ui.tsx`) because SVG attributes can't read CSS variables.
