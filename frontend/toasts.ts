/**
 * Speak Steam's notification toasts.
 *
 * In Big Picture Steam renders each toast as `<div role="alert">`, which the screen reader
 * announces because the window has focus. On the desktop every toast opens its own
 * non-focusable popup (`notificationtoasts_<id>_desktop`) with no alert role, so it is never
 * read. Their text goes to the backend instead, which speaks it through the screen reader with
 * Prism.
 */
import { reactFiber } from './a11y';

const TOAST_POPUP = /^notificationtoasts/;
const MAX_REMEMBERED = 200;
const spoken = new Set<unknown>();
const watched = new WeakSet<Document>();

function log(msg: string) {
	console.log('[steam-a11y]', msg);
}

/** The toast component's props carry the notification: `{ notification: { notificationID, eType, ... } }`. */
function toastNotification(alert: Element): any {
	let fiber = reactFiber(alert);
	for (let i = 0; fiber && i < 4; i++, fiber = fiber.return) {
		const n = fiber.memoizedProps?.notification;
		if (n && typeof n === 'object' && 'notificationID' in n) return n;
	}
	return undefined;
}

function say(text: string) {
	Promise.resolve()
		.then(() => backend.speak(text))
		.then((result) => log(`toast: ${result}`))
		.catch((e) => log(`toast speech failed: ${String(e)}`));
}

function speakToasts(doc: Document, toastPopup: boolean) {
	// In a toast popup, the first element carrying the notification (in document order, so
	// the outermost) holds the whole toast.
	const selector = toastPopup ? 'body *' : '[role="alert"]';
	for (const alert of doc.querySelectorAll<HTMLElement>(selector)) {
		const notification = toastNotification(alert);
		if (!notification) continue;
		const id = notification.notificationID;
		if (spoken.has(id)) continue;
		const text = (alert.innerText || alert.textContent || '').replace(/\s+/g, ' ').trim();
		// Not rendered yet; the next mutation brings the text.
		if (!text) continue;
		spoken.add(id);
		if (spoken.size > MAX_REMEMBERED) spoken.delete(spoken.values().next().value);
		// In a focused window (Big Picture) the screen reader announces the alert itself.
		if (doc.hasFocus()) continue;
		say(text);
	}
}

/** Speak toasts that appear in this popup's document from now on. */
export function watchToasts(doc: Document, popupName: string) {
	if (watched.has(doc)) return;
	watched.add(doc);
	const win = doc.defaultView!;
	const toastPopup = TOAST_POPUP.test(popupName);
	let pending = 0;
	new MutationObserver(() => {
		if (pending) return;
		// Let the toast finish rendering its text before reading it.
		pending = win.setTimeout(() => {
			pending = 0;
			speakToasts(doc, toastPopup);
		}, 200);
	}).observe(doc, { childList: true, subtree: true, characterData: true });
	speakToasts(doc, toastPopup);
}
