/**
 * Injected into Steam's browser views (Store, Community, Profile).
 * F6 here hands focus back to the Steam window.
 */
export default async function main() {
	window.addEventListener(
		'keydown',
		(e) => {
			if (e.key !== 'F6' || e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			frontend.focusShell();
		},
		true,
	);
}
