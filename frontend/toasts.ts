/**
 * Speak Steam's notification toasts.
 *
 * Steam renders each toast as `<div role="alert">`, which screen readers announce only in the
 * focused window. That is why Big Picture reads them. On the desktop the toasts are drawn in
 * their own non-focusable window (a browser view named "notificationtoasts"), so they are never
 * read. Their text goes to the backend instead, which speaks it through the screen reader with
 * Prism.
 */
import { reactFiber } from './a11y';

const TOAST_VIEW = /^notificationtoasts/;
const MAX_REMEMBERED = 200;
const spoken = new Set<unknown>();
const watched = new WeakSet<Document>();
let toastWindow: Window | undefined;

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

function speakToasts(doc: Document) {
	for (const alert of doc.querySelectorAll<HTMLElement>('[role="alert"]')) {
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

/** Speak toasts that appear in this document from now on. */
export function watchToasts(doc: Document) {
	if (watched.has(doc)) return;
	watched.add(doc);
	const win = doc.defaultView!;
	let pending = 0;
	new MutationObserver(() => {
		if (pending) return;
		// Let the toast finish rendering its text before reading it.
		pending = win.setTimeout(() => {
			pending = 0;
			speakToasts(doc);
		}, 200);
	}).observe(doc, { childList: true, subtree: true, characterData: true });
	speakToasts(doc);
}

/**
 * Steam opens the desktop toast window with a plain window.open, so it is not one of the
 * popups we attach to. The component hosting it renders a browser view placeholder
 * (`{ browser, visible, ... }`) in the main window and keeps the view object, which has
 * GetViewWindow(), in a state hook. Find it from the placeholder.
 */
export function findToastWindow(doc: Document) {
	if (toastWindow && !toastWindow.closed) return;
	for (const el of doc.body?.querySelectorAll('*') ?? []) {
		const view = reactFiber(el)?.return;
		const props = view?.memoizedProps;
		if (!props || typeof props !== 'object' || !('browser' in props) || !('visible' in props)) continue;
		for (let f = view.return, i = 0; f && i < 4; f = f.return, i++) {
			for (let hook = f.memoizedState; hook && typeof hook === 'object' && 'next' in hook; hook = hook.next) {
				const value = hook.memoizedState;
				if (!value || typeof value.GetViewWindow !== 'function') continue;
				const win: Window | undefined = value.GetViewWindow();
				if (!win || win.closed || !TOAST_VIEW.test(win.name) || !win.document) continue;
				toastWindow = win;
				log(`watching toast window ${win.name}`);
				watchToasts(win.document);
				return;
			}
		}
	}
}
