/**
 * Generic accessibility repair for Steam's desktop shell.
 *
 * Steam renders clickable <div>s with React handlers and no role, tabindex or
 * name. Class names are generated and change every update, so instead of
 * selectors we look at the React props attached to each DOM node: anything with
 * a click-like handler and no native semantics becomes a button.
 */

const FIXED = 'data-a11y-fixed';
// Elements that already have semantics of their own.
const SEMANTIC = 'a[href],button,input,select,textarea,[role],[contenteditable]';
// Real HTML controls; their clicks are never redirected.
const NATIVE_CONTROLS = 'a[href],button,input,select,textarea,[contenteditable]';
// Controls whose presence inside a candidate means the candidate is just a container.
const CONTROLS =
	NATIVE_CONTROLS + ',[data-a11y-fixed],' +
	'[role="button"],[role="link"],[role="menuitem"],[role="tab"],[role="checkbox"],[role="option"]';
// Tooltips are what Steam shows sighted users and are localized, so they win over
// internal titles like "Notifications Menu" even when the title is closer.
const TOOLTIP_PROPS = ['toolTipContent', 'strToolTip', 'tooltip'];
const LABEL_PROPS = ['aria-label', 'label', 'title', 'strTitle', 'strName'];
const MAX_FIBER_DEPTH = 12;

type Kind = 'click' | 'down' | 'up';

export interface Candidate {
	el: HTMLElement;
	kind: Kind;
	name: string;
	fromTooltip: boolean;
}

function reactKey(el: Element, prefix: string): string | undefined {
	return Object.keys(el).find((k) => k.startsWith(prefix));
}

function reactProps(el: Element): any {
	const k = reactKey(el, '__reactProps$');
	return k ? (el as any)[k] : undefined;
}

function reactFiber(el: Element): any {
	const k = reactKey(el, '__reactFiber$');
	return k ? (el as any)[k] : undefined;
}

function handlerKind(props: any): Kind | undefined {
	if (!props) return undefined;
	if (typeof props.onClick === 'function') return 'click';
	if (typeof props.onMouseDown === 'function' || typeof props.onPointerDown === 'function') return 'down';
	if (typeof props.onMouseUp === 'function' || typeof props.onPointerUp === 'function') return 'up';
	return undefined;
}

function isDisabled(el: Element): boolean {
	const props = reactProps(el);
	return !!props && 'onClick' in props && typeof props.onClick !== 'function';
}

/** The back/forward arrows: `cr({ direction: 'left' | 'right', onClick, disabled })`. */
function navArrowName(el: Element): string {
	let fiber = reactFiber(el);
	for (let i = 0; fiber && i < 3; i++, fiber = fiber.return) {
		const p = fiber.memoizedProps;
		if (p && typeof p === 'object' && 'direction' in p && 'disabled' in p && 'onClick' in p) {
			if (p.direction === 'left') return localize('#BrowserContextMenu_GoBack');
			if (p.direction === 'right') return localize('#BrowserContextMenu_GoForward');
		}
	}
	return '';
}

/** Flatten a string or simple React element tree to text. */
function textOf(node: any, depth = 0): string {
	if (node == null || typeof node === 'boolean' || depth > 6) return '';
	if (typeof node === 'string' || typeof node === 'number') return String(node);
	if (Array.isArray(node)) return node.map((n) => textOf(n, depth + 1)).join(' ');
	if (typeof node === 'object' && node.props) return textOf(node.props.children, depth + 1);
	return '';
}

/** Steam passes many labels as localization tokens such as "#ViewAnnouncements". */
function localize(text: string): string {
	if (!text.startsWith('#')) return text;
	const lm = (window as any).LocalizationManager;
	return lm?.LocalizeIfToken?.(text) || text;
}

/** Steam has no localized strings for minimize/maximize, so carry our own. */
const OWN_STRINGS: Record<string, { ru: string; en: string }> = {
	minimize: { ru: 'Свернуть окно', en: 'Minimize' },
	maximize: { ru: 'Развернуть окно', en: 'Maximize' },
	restore: { ru: 'Восстановить окно', en: 'Restore' },
	scrollLeft: { ru: 'Прокрутить влево', en: 'Scroll left' },
	scrollRight: { ru: 'Прокрутить вправо', en: 'Scroll right' },
};

function ownString(key: keyof typeof OWN_STRINGS): string {
	const locales: string[] = (window as any).LocalizationManager?.GetPreferredLocales?.() ?? [];
	return locales[0]?.startsWith('ru') ? OWN_STRINGS[key].ru : OWN_STRINGS[key].en;
}

/** Controls with stable, human-readable class names but no label. */
const CLASS_NAMES: [string, () => string][] = [
	['closeButton', () => localize('#Generic_Close')],
	['minimizeButton', () => ownString('minimize')],
	['maximizeButton', () => ownString('maximize')],
	['restoreButton', () => ownString('restore')],
];

function className(el: Element): string {
	for (const [cls, name] of CLASS_NAMES) if (el.classList.contains(cls)) return name();
	return '';
}

/**
 * Name a control by which named callback of a parent component its click handler is,
 * e.g. a shelf header passes `fnLeftClicked` straight through as the arrow's onClick.
 */
const HANDLER_NAMES: Record<string, (props: any) => string> = {
	fnLeftClicked: () => ownString('scrollLeft'),
	fnRightClicked: () => ownString('scrollRight'),
	fnOnCloseButtonClicked: () => localize('#Generic_Close'),
	onToggleCollapse: (p) => localize(p.collapsed ? '#CollectionAction_Expand' : '#CollectionAction_Collapse'),
};

function handlerName(el: Element): string {
	const fn = reactProps(el)?.onClick;
	if (typeof fn !== 'function') return '';
	let fiber = reactFiber(el)?.return;
	for (let i = 0; fiber && i < MAX_FIBER_DEPTH; i++, fiber = fiber.return) {
		const props = fiber.memoizedProps;
		if (!props || typeof props !== 'object') continue;
		for (const key in HANDLER_NAMES) if (props[key] === fn) return HANDLER_NAMES[key](props);
	}
	return '';
}

/** Look for a tooltip/label prop on this node's component and its ancestors. */
function tooltipName(el: Element): string {
	for (const names of [TOOLTIP_PROPS, LABEL_PROPS]) {
		let fiber = reactFiber(el);
		for (let i = 0; fiber && i < MAX_FIBER_DEPTH; i++, fiber = fiber.return) {
			const props = fiber.memoizedProps;
			if (!props || typeof props !== 'object') continue;
			for (const p of names) {
				const t = textOf(props[p]).replace(/\s+/g, ' ').trim();
				if (t) return localize(t);
			}
		}
	}
	return '';
}

function visibleText(el: HTMLElement): string {
	return ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Find click targets that have no accessible semantics, innermost first. */
export function findCandidates(doc: Document): Candidate[] {
	const view = doc.defaultView!;
	const maxArea = (view.innerWidth * view.innerHeight) / 4;
	const out: Candidate[] = [];
	const all = doc.body ? doc.body.querySelectorAll<HTMLElement>('*') : [];
	for (const el of all) {
		if (el.hasAttribute(FIXED)) continue;
		if (el.matches(SEMANTIC) || el.closest('a[href],button,[role="button"],[role="link"],[role="menuitem"],[role="tab"]')) continue;
		// A clickable <svg> icon is a candidate; its inner shapes are not.
		const svg = el.closest('svg');
		if (svg && svg !== el) continue;
		// The back/forward arrows drop onClick entirely while disabled, so recognise them by component.
		const kind = handlerKind(reactProps(el)) ?? (navArrowName(el) ? 'click' : undefined);
		if (!kind) continue;
		const r = el.getBoundingClientRect();
		// Tiny targets are resize and drag handles, not controls.
		if (r.width < 8 || r.height < 8 || r.width * r.height > maxArea) continue;
		// Skip wrappers: a candidate containing native controls is a container, not a control.
		if (el.querySelector(CONTROLS)) continue;
		const text = visibleText(el);
		const label = text ? '' : className(el) || navArrowName(el) || handlerName(el) || tooltipName(el);
		out.push({ el, kind, name: text || label, fromTooltip: !text && !!label });
	}
	// Keep only innermost candidates.
	return out.filter((c) => !out.some((o) => o !== c && c.el.contains(o.el)));
}

function hasAccessibleName(el: Element): boolean {
	return !!(
		el.getAttribute('aria-label') ||
		el.getAttribute('aria-labelledby') ||
		el.getAttribute('title') ||
		visibleText(el as HTMLElement) ||
		el.querySelector('img[alt]:not([alt=""])')
	);
}

/** Native links and buttons Steam left without a name: borrow the tooltip. */
export function nameUnlabeledControls(doc: Document) {
	for (const el of doc.querySelectorAll('a[href]:not([data-a11y-named]),button:not([data-a11y-named])')) {
		el.setAttribute('data-a11y-named', '');
		if (hasAccessibleName(el)) continue;
		const name = className(el) || tooltipName(el);
		if (name) el.setAttribute('aria-label', name);
	}
}

/** Images inside a control that already has a name are decorative. */
export function hideDecorativeImages(doc: Document) {
	for (const img of doc.querySelectorAll<HTMLImageElement>('[data-a11y-fixed] img:not([alt]), a[href] img:not([alt]), button img:not([alt])')) {
		const control = img.closest('[data-a11y-fixed],a[href],button')!;
		const text = visibleText(control as HTMLElement) || control.getAttribute('aria-label');
		if (text) img.alt = '';
	}
}

/** Make an element behave like a click for code that listens to mouse down/up. */
function pointerClick(el: HTMLElement) {
	const r = el.getBoundingClientRect();
	const init: MouseEventInit = {
		bubbles: true,
		cancelable: true,
		view: el.ownerDocument.defaultView,
		clientX: r.left + r.width / 2,
		clientY: r.top + r.height / 2,
		button: 0,
		buttons: 1,
	};
	el.dispatchEvent(new PointerEvent('pointerdown', init));
	el.dispatchEvent(new MouseEvent('mousedown', init));
	el.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
	el.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
}

export function activate(el: HTMLElement) {
	if (isDisabled(el)) return;
	if (el.dataset.a11yKind === 'click') el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
	else pointerClick(el);
}

export function applyFix(c: Candidate, role: string) {
	const el = c.el;
	el.setAttribute(FIXED, '');
	el.dataset.a11yKind = c.kind;
	el.setAttribute('role', role);
	if (el.tabIndex < 0) el.tabIndex = 0;
	if (c.fromTooltip) el.setAttribute('aria-label', c.name);
	for (const svg of el.querySelectorAll('svg')) svg.setAttribute('aria-hidden', 'true');
}

/** React swaps handlers in and out without touching the DOM, so re-check disabled state each pass. */
export function refreshDisabled(doc: Document) {
	for (const el of doc.querySelectorAll(`[${FIXED}]`)) {
		if (isDisabled(el)) el.setAttribute('aria-disabled', 'true');
		else el.removeAttribute('aria-disabled');
	}
}

/**
 * Keyboard and assistive-technology activation for fixed elements.
 * - Enter/Space on a focused fixed element activates it.
 * - Clicks synthesized by screen readers (detail === 0) on elements that only
 *   listen to mouse down/up are turned into a full pointer sequence.
 */
export function installActivation(doc: Document) {
	doc.addEventListener(
		'keydown',
		(e) => {
			const t = e.target as HTMLElement | null;
			if (!t?.hasAttribute?.(FIXED)) return;
			if (e.key !== 'Enter' && e.key !== ' ') return;
			if (e.ctrlKey || e.altKey || e.metaKey) return;
			e.preventDefault();
			e.stopPropagation();
			activate(t);
		},
		true,
	);
	doc.addEventListener(
		'click',
		(e) => {
			const target = e.target as HTMLElement | null;
			// Never redirect clicks meant for real links, buttons or form fields.
			if (target?.closest?.(NATIVE_CONTROLS)) return;
			const t = target?.closest?.<HTMLElement>(`[${FIXED}]`);
			if (!t || t.dataset.a11yKind === 'click' || e.detail !== 0) return;
			e.stopPropagation();
			pointerClick(t);
		},
		true,
	);
}
