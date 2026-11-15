import './page.css';
import { mount } from './shared/mount';
import { GamesPage } from './GamesPage';

mount(<GamesPage />);

// Offline and «add to home screen»: the service worker saves the whole site (see vite.config.ts). Only in the
// built site; during `npm run dev` it would serve stale files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
	window.addEventListener('load', () => {
		navigator.serviceWorker.register('./sw.js').catch((error) => console.error('service worker not registered:', error));
	});
}
