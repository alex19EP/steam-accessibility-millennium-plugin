/**
 * The Store/Library/Community/Profile tabs at the top of the main window.
 *
 * - The active tab gets `aria-current="page"`; Steam shows it only with a CSS class.
 * - Steam opens the tabs' dropdown menus only on mouse hover and tells them not to take
 *   focus. Following the APG "disclosure navigation menu with top-level links" pattern,
 *   each tab keeps its own action (go to the section) and gets a separate, visually hidden
 *   button after it that opens Steam's own menu and moves focus into it.
 */
import { ownString, reactFiber, reactProps } from './a11y';

const TAB_WRAPPER = 'data-a11y-tab';
const MENU_BUTTON = 'data-a11y-menu-button';
const VISUALLY_HIDDEN =
	'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;' +
	'overflow:hidden;clip-path:inset(50%);white-space:nowrap;';

/** The tab's menu component, `{ title, menuItems, bSuperNavBehavior, onClick, ... }`, around its wrapper div. */
function menuComponent(wrapper: Element): any {
	const fiber = reactFiber(wrapper)?.return;
	return fiber?.memoizedProps?.bSuperNavBehavior ? fiber : undefined;
}

/** Same condition Steam uses before showing the menu; the Console tab has none. */
function hasMenu(props: any): boolean {
	const items = (props.menuItems ?? []).filter((i: any) => i && i.visible !== false);
	return items.length > 1 || !!props.menuContent;
}

/**
 * Steam's own rule: a tab is selected when the route is under its `rootRoute`, and for the
 * Store/Community/Profile tabs (which share the `/browser` route) when it is also the
 * browser's last active tab (`tab` prop: 'store', 'community' or 'me').
 */
function isCurrentTab(component: any): boolean {
	const manager = (window as any).MainWindowBrowserManager;
	const route: string = manager?.m_history?.location?.pathname ?? '';
	let rootRoute: string | undefined;
	let tab: string | undefined;
	for (let f = component.return, i = 0; f && i < 4; f = f.return, i++) {
		const p = f.memoizedProps;
		if (!p || typeof p !== 'object') continue;
		if (rootRoute === undefined && typeof p.rootRoute === 'string') rootRoute = p.rootRoute;
		if (tab === undefined && typeof p.tab === 'string') tab = p.tab;
	}
	if (!rootRoute || !route.startsWith(rootRoute)) return false;
	return tab === undefined || manager?.GetLastActiveTab?.() === tab;
}

/** Steam keeps the menu in a ref of the component: the object with Show/Hide/TakeFocus. */
function menuInstance(component: any): any {
	for (let hook = component?.memoizedState; hook; hook = hook.next) {
		const value = hook.memoizedState?.current;
		if (value && typeof value.TakeFocus === 'function' && typeof value.Show === 'function') return value;
	}
	return undefined;
}

function updateExpanded(wrapper: Element, button: HTMLElement) {
	const menu = menuInstance(menuComponent(wrapper));
	button.setAttribute('aria-expanded', String(!!menu?.visible));
}

function openMenu(wrapper: HTMLElement, button: HTMLElement) {
	const component = menuComponent(wrapper);
	const onMouseEnter = reactProps(wrapper)?.onMouseEnter;
	if (!component || typeof onMouseEnter !== 'function') return;
	// What hovering the tab does: show the menu, without focus.
	onMouseEnter({ currentTarget: wrapper });
	// Then what Steam's other menus do when shown: take focus, forcing the OS to switch to it.
	// The menu window is created asynchronously, so retry until it has focus.
	let tries = 0;
	const focus = () => {
		const menu = menuInstance(component);
		if (menu?.visible) {
			menu.TakeFocus();
			if (menu.BHasFocus?.()) return updateExpanded(wrapper, button);
		}
		if (++tries < 20) setTimeout(focus, 50);
		else updateExpanded(wrapper, button);
	};
	setTimeout(focus, 50);
}

function addMenuButton(doc: Document, wrapper: HTMLElement, tab: HTMLElement) {
	let button = wrapper.querySelector<HTMLButtonElement>(`:scope > [${MENU_BUTTON}]`);
	if (!button) {
		const b = doc.createElement('button');
		b.type = 'button';
		b.setAttribute(MENU_BUTTON, '');
		b.setAttribute('data-a11y-named', '');
		b.setAttribute('aria-haspopup', 'menu');
		b.style.cssText = VISUALLY_HIDDEN;
		b.addEventListener('click', (e) => {
			e.stopPropagation();
			openMenu(wrapper, b);
		});
		b.addEventListener('focus', () => updateExpanded(wrapper, b));
		wrapper.appendChild(b);
		button = b;
	}
	// The profile tab gets the display name once it has loaded.
	const name = (tab.textContent ?? '').replace(/\s+/g, ' ').trim();
	button.setAttribute('aria-label', name ? `${ownString('menu')}: ${name}` : ownString('menu'));
	updateExpanded(wrapper, button);
}

/** Re-check which tab is current. Called for the tab wrapper whenever Steam changes its class. */
export function updateCurrentTab(wrapper: Element) {
	if (!wrapper.hasAttribute(TAB_WRAPPER)) return;
	const tab = wrapper.querySelector(':scope > [data-a11y-fixed]');
	const component = menuComponent(wrapper);
	if (!tab || !component) return;
	if (isCurrentTab(component)) tab.setAttribute('aria-current', 'page');
	else tab.removeAttribute('aria-current');
}

export function fixNavTabs(doc: Document) {
	for (const tab of doc.querySelectorAll<HTMLElement>('[data-a11y-fixed]')) {
		const wrapper = tab.parentElement;
		const component = wrapper && menuComponent(wrapper);
		if (!component) continue;
		wrapper.setAttribute(TAB_WRAPPER, '');
		updateCurrentTab(wrapper);
		if (hasMenu(component.memoizedProps)) addMenuButton(doc, wrapper, tab);
	}
}
