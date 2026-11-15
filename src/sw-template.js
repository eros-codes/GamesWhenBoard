/* Board's service worker. The build fills in the version and the file list below; see vite.config.ts.
 *
 * - Install: saves every file of the site, so it opens and plays with no internet after the first visit.
 * - The page (index.html) and data/games.json: from the network when there is one (so an update, or an edited
 *   word list, arrives at the next visit), else from the saved copy.
 * - Everything else (code, styles, fonts, icons): from the saved copy; their names change with every build.
 * - Activate: the copies of older builds are removed.
 */
const VERSION = '__VERSION__';
const CACHE = `board-${VERSION}`;
const FILES = __FILES__;

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: 'reload' }))))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key.startsWith('board-') && key !== CACHE).map((key) => caches.delete(key))))
			.then(() => self.clients.claim()),
	);
});

const fresh = (url) => url.pathname.endsWith('/') || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/data/games.json');

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	if (request.mode === 'navigate' || fresh(url)) {
		// network first; the saved copy when offline (a game's address like ./#chess is the same page)
		event.respondWith(
			fetch(request)
				.then((response) => {
					if (response.ok) {
						const copy = response.clone();
						caches.open(CACHE).then((cache) => cache.put(request.mode === 'navigate' ? './' : request, copy));
					}
					return response;
				})
				.catch(async () => (await caches.match(request.mode === 'navigate' ? './' : request, { ignoreSearch: true })) || (await caches.match('./')) || Response.error()),
		);
		return;
	}

	event.respondWith(caches.match(request, { ignoreSearch: true }).then((saved) => saved || fetch(request)));
});
