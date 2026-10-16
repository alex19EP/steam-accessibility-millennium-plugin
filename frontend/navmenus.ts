/**
 * Keyboard access to the dropdown menus of the Store/Library/Community/Profile tabs.
 *
 * Steam opens these menus only on mouse hover and tells them not to take focus. Following
 * the APG "disclosure navigation menu with top-level links" pattern, each tab keeps its own
 * action (go to the section) and gets a separate, visually hidden button after it that
 * opens Steam's own menu and moves focus into it.
 */
import { ownString, reactFiber, reactProps } from './a11y';

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

/** Add a menu button after every tab that has a dropdown menu. */
export function addMenuButtons(doc: Document) {
	for (const tab of doc.querySelectorAll<HTMLElement>('[data-a11y-fixed]')) {
		const wrapper = tab.parentElement;
		const component = wrapper && menuComponent(wrapper);
		if (!component || !hasMenu(component.memoizedProps)) continue;
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
}
