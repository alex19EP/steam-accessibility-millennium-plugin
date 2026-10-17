/**
 * Experimental, off by default: open the in-game overlay's windows as real windows so NVDA
 * can read them.
 *
 * Steam creates every popup with `window.open('about:blank?createflags=...&pid=...&browser=...')`.
 * Overlay windows name the overlay's browser (`pid` = gameoverlayui64.exe, `browser` = its
 * slot) and no browser type, so they are rendered off-screen and drawn into the game, where
 * NVDA cannot read them. Adding `browserType=4` (a borderless real window, like the main Steam
 * window) makes Steam open them as ordinary windows on top of the game.
 *
 * That includes the full-screen transparent base window (`desktopoverlay_*`), which holds most
 * of the overlay (clock, "Exit game", the game's page, the bottom bar), and the windows it
 * opens (friends list, game overview, browser, invite dialog). Toasts stay drawn into the game:
 * they are spoken (toasts.ts) and must not take focus.
 *
 * An off-screen window is only drawn while the overlay is open, so Steam shows its windows
 * whenever it likes. A real window would stay on screen over the game, and it also ignores the
 * Hidden creation flag. So a window is only on screen while the overlay is open and Steam wants
 * it: the base window always, the others per Steam's record of overlay windows
 * (`DesktopOverlay.m_mapPopupForWindow` / `m_mapWindowVisibilityState`).
 *
 * Keys in the overlay's windows: the overlay key (Steam's setting) and Alt+F4 return to the
 * game; F6 moves to the next window, or into a window's page (the browser) first; F6 in that
 * page moves on to the next window (see leaveOverlayPage); Shift+F6 moves to the previous one.
 */
const UNCHANGED = /^notificationtoasts/;
const MAIN = /^desktopoverlay/;
const REAL_WINDOW = '4';
/**
 * EPopupCreationFlags Minimized | NoTaskbarIcon. A real window ignores Hidden and takes focus
 * when it appears, which NVDA announces; a minimized one does not. BringToFront restores it,
 * but only if it was never hidden while minimized, so it stays minimized until first shown.
 */
const CREATE_QUIETLY = 1 | 8;
const REMEMBER_WAIT_MS = 100;
/** EWindowVisibility in Steam's overlay record. */
const VISIBLE = 1;

// Steam's shell exposes these globals in the SharedJSContext the frontend runs in.
const w = window as any;

interface OverlayWindow {
	name: string;
	pid: string;
	win: Window;
	/** The full-screen base window, wanted whenever the overlay is open. */
	main: boolean;
	/** Whether it is on screen. */
	shown: boolean;
	/** Shown at least once, so no longer minimized (see CREATE_QUIETLY). */
	restored: boolean;
	/** Show and bring to the front (which also restores it from minimized). */
	show: () => void;
	hide: () => void;
	/** Bring to the front with keyboard focus; Windows only focuses the topmost window. */
	focus: () => void;
}

let enabled = false;
const patched = new WeakSet<Window>();
/** Popup name -> overlay pid, for windows opened as real windows. */
const pending = new Map<string, string>();
const windows = new Set<OverlayWindow>();
const adopted = new WeakMap<Window, OverlayWindow>();
/** The window whose page got focus through F6. */
let pageWindow: OverlayWindow | undefined;
let listening = false;
const events: string[] = [];

export function setAccessibleOverlay(on: boolean) {
	enabled = on;
}

function note(event: string) {
	events.push(`${new Date().toISOString().slice(11, 23)} ${event}`);
	if (events.length > 100) events.shift();
}

// For checking from DevTools (`steamA11yOverlay()` in SharedJSContext) while this is
// experimental.
w.steamA11yOverlay = () => ({
	enabled,
	pending: [...pending.keys()],
	windows: [...windows].map((x) => ({ name: x.name, pid: x.pid, wanted: wanted(x), shown: x.shown })),
	events,
});

function overlayInstance(pid: string): any {
	return w.SteamUIStore?.WindowStore?.SteamUIWindows?.find(
		(x: any) => x.IsDesktopOverlayWindow?.() && String(x.params?.browserInfo?.m_unPID) === pid,
	);
}

function overlayActive(pid: string): boolean {
	return !!overlayInstance(pid)?.DesktopOverlay?.m_bIsOverlayActive;
}

/** Whether Steam wants this window open in its overlay. */
function wanted(ow: OverlayWindow): boolean {
	if (ow.main) return true;
	const overlay = overlayInstance(ow.pid)?.DesktopOverlay;
	for (const [type, win] of overlay?.m_mapPopupForWindow ?? []) {
		if (win === ow.win) return overlay.m_mapWindowVisibilityState?.get(type) === VISIBLE;
	}
	// Not a window type Steam keeps a record for (a dialog): it is open while it exists.
	return true;
}

/** Close the overlay and return to the game, like the overlay's "Return to game" button. */
function closeOverlay(pid: string) {
	const gameid = overlayInstance(pid)?.params?.gameid;
	note(`close overlay ${pid} (game ${gameid})`);
	// 0 = EOverlayState Hidden.
	if (gameid) w.SteamClient?.Overlay?.SetOverlayState?.(gameid, 0);
}

/** The overlay key from Steam's settings (Shift+Tab by default; key codes as in KeyboardEvent.keyCode). */
function isOverlayKey(e: KeyboardEvent): boolean {
	const key = w.settingsStore?.m_ClientSettings?.overlay_key;
	if (!key) return e.key === 'Tab' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey;
	return (
		e.keyCode === key.key_code &&
		e.altKey === !!key.alt_key &&
		e.shiftKey === !!key.shift_key &&
		e.ctrlKey === !!key.ctrl_key &&
		e.metaKey === !!key.meta_key
	);
}

function backendCall(what: string, call: () => Promise<unknown>) {
	Promise.resolve()
		.then(call)
		.then((result) => note(`${what}: ${result}`))
		.catch((e) => note(`${what} failed: ${String(e)}`));
}

/** Hiding the focused overlay window leaves Win32 focus on it; hand it back to the game. */
function focusGame() {
	backendCall('restore foreground', () => backend.restoreForeground());
}

/** The rewritten creation URL, or the same one when it is not an overlay window. */
function rewrite(url: string, name: string): string {
	const prefix = 'about:blank?';
	if (!enabled || !url.startsWith(prefix) || UNCHANGED.test(name)) return url;
	// Split by hand: URLSearchParams would re-encode values such as the user agent.
	const params = url.slice(prefix.length).split('&');
	const pid = params.find((p) => p.startsWith('pid='))?.slice(4);
	if (!pid || pid === '0') return url;
	const set = (key: string, value: string) => {
		const i = params.findIndex((p) => p.startsWith(key + '='));
		if (i >= 0) params[i] = `${key}=${value}`;
		else params.push(`${key}=${value}`);
	};
	set('browserType', REAL_WINDOW);
	const flags = Number(params.find((p) => p.startsWith('createflags='))?.slice(12) ?? 0);
	set('createflags', String(flags | CREATE_QUIETLY));
	pending.set(name, pid);
	return prefix + params.join('&');
}

/** Route this window's popups through `rewrite`. Steam opens a popup from its owner window. */
export function patchWindowOpen(win: Window) {
	if (patched.has(win)) return;
	patched.add(win);
	const open = win.open;
	win.open = function (url?: string | URL, target?: string, features?: string) {
		if (typeof url === 'string' && typeof target === 'string') url = rewrite(url, target);
		const opened = open.call(this, url, target, features);
		// Take over ShowWindow before Steam's code continues and shows the new window.
		const pid = typeof target === 'string' ? pending.get(target) : undefined;
		if (opened && pid && (opened as any).SteamClient?.Window) {
			pending.delete(target!);
			adopt(target!, pid, opened);
		}
		return opened;
	} as typeof win.open;
}

function shownWindows(pid: string): OverlayWindow[] {
	return [...windows].filter((x) => x.pid === pid && x.shown && !x.win.closed);
}

function mainWindow(pid: string): OverlayWindow | undefined {
	return shownWindows(pid).find((x) => x.main);
}

/**
 * Show the windows Steam wants while their overlay is open and hide the rest. With `opened`
 * (the overlay was just opened) focus goes to the base window, and windows already marked
 * shown are shown again in case Alt+F4 hid them (hide on close).
 */
function sync(opened = false) {
	const closed = new Set<string>();
	for (const ow of windows) {
		if (ow.win.closed) {
			windows.delete(ow);
			continue;
		}
		const visible = overlayActive(ow.pid) && wanted(ow);
		if (visible && (!ow.shown || opened)) {
			ow.shown = true;
			ow.show();
			note(`show ${ow.name}`);
		} else if (!visible && ow.shown) {
			ow.shown = false;
			ow.hide();
			note(`hide ${ow.name}`);
			if (!overlayActive(ow.pid)) closed.add(ow.pid);
		}
	}
	if (pageWindow && !pageWindow.shown) pageWindow = undefined;
	if (opened) for (const ow of windows) if (ow.main && ow.shown) ow.focus();
	if (closed.size) focusGame();
}

function listen() {
	if (listening) return;
	listening = true;
	w.SteamClient?.Overlay?.RegisterForOverlayActivated?.((...args: unknown[]) => {
		note(`overlay activated ${JSON.stringify(args)}`);
		// Steam's own handler sets m_bIsOverlayActive from the same event; read it after that.
		setTimeout(() => {
			const opening = [...windows].some((x) => overlayActive(x.pid) && !shownWindows(x.pid).length);
			if (!opening) return sync(true);
			// The game is still in front; remember it before an overlay window takes focus. The
			// backend can be busy (it once took 40 s), so do not wait long for it.
			const remembered = Promise.resolve()
				.then(() => backend.rememberForeground())
				.then((result) => note(`remember foreground: ${result}`))
				.catch((e) => note(`remember foreground failed: ${String(e)}`));
			Promise.race([remembered, new Promise((r) => setTimeout(r, REMEMBER_WAIT_MS))]).then(() => sync(true));
		}, 0);
	});
}

function steamPopup(win: Window): any {
	for (const p of w.g_PopupManager?.GetPopups() ?? []) if (p.window === win) return p;
	return undefined;
}

/** The page (browser view) inside an overlay window, such as the overlay's web browser. */
function pageView(ow: OverlayWindow): any {
	return steamPopup(ow.win)?.m_rgChildBrowserViews?.[0];
}

function focusNext(from: OverlayWindow, backwards: boolean) {
	const list = shownWindows(from.pid);
	if (list.length < 2) return;
	const i = list.indexOf(from);
	list[(i + (backwards ? list.length - 1 : 1)) % list.length].focus();
}

/**
 * F6 in a page: if the page is one F6 entered in an overlay window, move on to the next
 * overlay window and return true; otherwise leave it to the main window's handling.
 */
export function leaveOverlayPage(): boolean {
	const from = pageWindow;
	pageWindow = undefined;
	note(`F6 in page of ${from?.name ?? 'no overlay window'}`);
	if (!from || !from.shown || from.win.closed) return false;
	pageView(from)?.SetFocus(false);
	if (shownWindows(from.pid).length < 2) from.focus();
	else focusNext(from, false);
	return true;
}

function onKeyDown(ow: OverlayWindow, e: KeyboardEvent) {
	// The game only sees the overlay key while it has focus, so handle it here too. Alt+F4
	// would close the window and with it the overlay; return to the game instead.
	if (isOverlayKey(e) || (e.key === 'F4' && e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey)) {
		e.preventDefault();
		e.stopImmediatePropagation();
		closeOverlay(ow.pid);
		return;
	}
	if (e.key !== 'F6' || e.ctrlKey || e.altKey || e.metaKey) return;
	e.preventDefault();
	e.stopImmediatePropagation();
	const view = !e.shiftKey && pageView(ow);
	note(`${e.shiftKey ? 'Shift+' : ''}F6 in ${ow.name}${view ? ', into its page' : ''}`);
	if (view) {
		pageWindow = ow;
		view.SetFocus(true);
		return;
	}
	focusNext(ow, e.shiftKey);
}

/** Take over showing and hiding of a window that `rewrite` opened as a real window. */
function adopt(name: string, pid: string, win: Window): OverlayWindow {
	const sw = (win as any).SteamClient.Window;
	const showWindow = sw.ShowWindow.bind(sw);
	const hideWindow = sw.HideWindow.bind(sw);
	const ow: OverlayWindow = {
		name,
		pid,
		win,
		main: MAIN.test(name),
		shown: false,
		restored: false,
		show: () => {
			showWindow();
			sw.BringToFront();
			ow.restored = true;
		},
		// Hidden while minimized, it could not be restored again; leave it minimized.
		hide: () => ow.restored && hideWindow(),
		focus: () => sw.BringToFront(),
	};
	// Steam's own show/hide calls: check its record instead, after it has been updated.
	sw.ShowWindow = () => {
		note(`steam show ${name}`);
		setTimeout(sync, 0);
	};
	sw.HideWindow = () => {
		note(`steam hide ${name}`);
		ow.shown = false;
		ow.hide();
		// Keep focus in the overlay rather than letting it fall back to the game.
		if (overlayActive(pid)) mainWindow(pid)?.focus();
	};
	// Steam turns this off itself before it closes a popup.
	sw.SetHideOnClose?.(true);
	note(`adopt ${name}, overlay active: ${overlayActive(pid)}`);
	windows.add(ow);
	adopted.set(win, ow);
	listen();
	return ow;
}

/**
 * Called once Steam reports the popup as created and has written its document (which drops
 * earlier listeners): watch its visibility and keys.
 */
export function trackOverlayWindow(name: string, win: Window) {
	let found = adopted.get(win);
	if (!found) {
		// SteamClient was not there yet when window.open returned.
		const pid = pending.get(name);
		if (!pid || !(win as any).SteamClient?.Window) return;
		pending.delete(name);
		found = adopt(name, pid, win);
	}
	const ow = found;
	// The window shows itself when it loads, whatever the creation flags say. Keep it if the
	// overlay is open and Steam wants it (focus moves to it, as to any new window); otherwise put
	// it away and give focus back.
	const settle = () => {
		if (ow.shown || win.document.visibilityState !== 'visible') return;
		if (overlayActive(ow.pid) && wanted(ow)) {
			ow.shown = true;
			note(`keep ${name}`);
			ow.focus();
			return;
		}
		note(`put away ${name}`);
		// Visible, so not minimized: safe to hide.
		ow.restored = true;
		ow.hide();
		if (overlayActive(ow.pid)) mainWindow(ow.pid)?.focus();
		else focusGame();
	};
	win.document.addEventListener('visibilitychange', settle);
	win.addEventListener('keydown', (e) => onKeyDown(ow, e), true);
	note(`track ${name}, visible: ${win.document.visibilityState}`);
	sync();
	settle();
}
