import { definePlugin, Field } from 'millennium';
import {
	applyFix,
	findCandidates,
	hideCollapsed,
	hideDecorativeImages,
	installActivation,
	nameUnlabeledControls,
	refreshDisabled,
	updateCollapsed,
} from './a11y';
import { fixNavTabs, updateCurrentTab } from './navmenus';
import { watchToasts } from './toasts';

// Steam's shell exposes these globals in the SharedJSContext the frontend runs in.
const w = window as any;

function log(msg: string) {
	console.log('[steam-a11y]', msg);
}

/** The native browser view that shows Store/Community/Profile pages in the main window. */
function getPageView(): any {
	return w.MainWindowBrowserManager?.m_browser;
}

function popupName(p: any): string {
	return p?.GetName?.() ?? p?.m_strName ?? '';
}

function getMainPopup(): any {
	for (const p of w.g_PopupManager?.GetPopups() ?? []) {
		const name = popupName(p);
		if (name === 'SP Desktop' || name.startsWith('SP Desktop_')) return p;
	}
	return undefined;
}

function currentRoute(): string {
	return w.MainWindowBrowserManager?.m_history?.location?.pathname ?? '';
}

function isPageShown(): boolean {
	return currentRoute().startsWith('/browser');
}

function focusPage() {
	const view = getPageView();
	if (!view || !isPageShown()) return;
	view.SetFocus(true);
}

/** @ffi */
export function focusShell(): void {
	getPageView()?.SetFocus(false);
	// Steam's JS can't move Win32 focus out of a browser view in desktop mode,
	// so the backend focuses the shell browser natively.
	Promise.resolve()
		.then(() => backend.focusShellWindow())
		.then((result) => log(`focusShellWindow: ${result}`))
		.catch((e) => log(`focusShellWindow failed: ${String(e)}`));
}

function onKeyDown(e: KeyboardEvent) {
	if (e.key !== 'F6' || e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
	e.preventDefault();
	e.stopImmediatePropagation();
	focusPage();
}

function repair(name: string, doc: Document) {
	const role = name.startsWith('contextmenu') ? 'menuitem' : 'button';
	for (const c of findCandidates(doc)) applyFix(c, role);
	fixNavTabs(doc);
	nameUnlabeledControls(doc);
	hideDecorativeImages(doc);
	hideCollapsed(doc);
	refreshDisabled(doc);
}

function attachPopup(popup: any) {
	const win: Window | undefined = popup?.window;
	if (!win || (win as any).__steamA11y) return;
	(win as any).__steamA11y = true;
	const name = popupName(popup);
	const doc = win.document;
	installActivation(doc);
	watchToasts(doc, name);

	let pending = 0;
	const schedule = () => {
		if (pending) return;
		pending = win.setTimeout(() => {
			pending = 0;
			repair(name, doc);
		}, 250);
	};
	new MutationObserver(schedule).observe(doc, { childList: true, subtree: true });
	// Panels open and collapse by changing only their inline style, and the active tab only
	// changes its class; handle both right away.
	new MutationObserver((records) => {
		for (const r of records) {
			const el = r.target as HTMLElement;
			if (r.attributeName === 'style') updateCollapsed(el);
			else updateCurrentTab(el);
		}
	}).observe(doc, { attributes: true, attributeFilter: ['style', 'class'], subtree: true });
	schedule();
}

function attachMain(popup: any) {
	popup.window.addEventListener('keydown', onKeyDown, true);
	// Switching to Store/Community/Profile moves focus into the page.
	w.MainWindowBrowserManager.m_history.listen((location: any) => {
		if (location?.pathname?.startsWith('/browser')) setTimeout(focusPage, 300);
	});
}

function init() {
	let mainAttached = false;
	const tryMain = () => {
		const popup = getMainPopup();
		if (!mainAttached && popup?.window && w.MainWindowBrowserManager?.m_history) {
			mainAttached = true;
			attachMain(popup);
		}
		return mainAttached;
	};
	if (!tryMain()) {
		const timer = setInterval(() => tryMain() && clearInterval(timer), 500);
	}
	for (const p of w.g_PopupManager?.GetPopups() ?? []) attachPopup(p);
	w.g_PopupManager?.AddPopupCreatedCallback((p: any) => {
		attachPopup(p);
		tryMain();
	});
}

export default definePlugin(() => {
	init();
	return {
		title: 'Steam Accessibility',
		icon: <span />,
		content: <Field label="F6 moves focus between the Steam window and the web page it shows." />,
	};
});
