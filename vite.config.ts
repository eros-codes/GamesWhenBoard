import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Writes dist/sw.js, the service worker that makes Board work offline. It lists every file of the build (the
 * page, the code of every game, the styles, the fonts, the icons and data/games.json), so the whole site is
 * saved on the phone at the first visit. Its cache is named after a hash of all of them: a new build is a new
 * cache, and the old one is dropped once the new one is in place. The worker's code is src/sw-template.js.
 */
function serviceWorker(): Plugin {
	return {
		name: 'board-service-worker',
		apply: 'build',
		generateBundle(_options, bundle) {
			const files = new Set<string>(Object.keys(bundle));
			const publicDir = path.resolve(__dirname, 'public');
			const walk = (dir: string) => {
				for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
					const full = path.join(dir, entry.name);
					if (entry.isDirectory()) walk(full);
					else files.add(path.relative(publicDir, full).split(path.sep).join('/'));
				}
			};
			walk(publicDir);

			const hash = createHash('sha256');
			for (const name of [...files].sort()) {
				hash.update(name);
				const item = bundle[name];
				if (item) hash.update(item.type === 'chunk' ? item.code : typeof item.source === 'string' ? item.source : Buffer.from(item.source));
				else hash.update(fs.readFileSync(path.join(publicDir, name)));
			}
			const version = hash.digest('hex').slice(0, 12);
			const list = ['./', ...[...files].filter((f) => !f.endsWith('.map') && f !== 'sw.js').sort().map((f) => `./${f}`)];

			const template = fs.readFileSync(path.resolve(__dirname, 'src/sw-template.js'), 'utf8');
			this.emitFile({
				type: 'asset',
				fileName: 'sw.js',
				source: template.replaceAll('__VERSION__', version).replaceAll('__FILES__', JSON.stringify(list, null, '\t')),
			});
		},
	};
}

export default defineConfig({
	// relative paths: the built site works from any folder of any host (a domain, a sub-folder, GitHub Pages…)
	base: './',
	plugins: [react(), serviceWorker()],
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		target: 'es2020',
	},
});
