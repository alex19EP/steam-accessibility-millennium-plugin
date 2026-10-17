# Steam Accessibility Millennium Plugin

Millennium plugin that makes the Steam desktop client (Windows, not Big Picture) usable with
NVDA. The author is blind and tests everything with NVDA; Steam's UI language is Russian.
User-facing docs live in README.md.

## Layout

- `frontend/index.tsx`: runs in Steam's SharedJSContext. Attaches to every Steam popup window,
  F6 handling, auto-focus of the page on route change.
- `frontend/a11y.ts`: the generic repair: finds clickable elements via React props, gives
  them role/tabindex/name, keyboard and screen reader activation.
- `frontend/navmenus.ts`: the Store/Library/Community/Profile tabs: `aria-current="page"` on
  the active one, and a visually hidden "Меню: <tab>" button after each that opens Steam's
  hover-only dropdown and focuses it (APG disclosure navigation pattern: the tab itself
  still navigates).
- `frontend/toasts.ts`: speaks notification toasts through `backend.speak`.
- `backend/speech.lua`: speech/braille through Prism (`resources/prism/prism.dll`, v0.18.3
  x64 from the official GitHub release, MPL-2.0; licenses next to it). Written to
  `%LOCALAPPDATA%\steam-accessibility\prism-<version>.dll` on first use and loaded via
  `LoadLibraryW`. To update Prism: replace the DLL and licenses, bump `PRISM_VERSION`, and
  diff `prism.h` against the `ffi.cdef` (PrismConfig and PrismError change between versions).
- `webview/preload.ts`: injected into Store/Community pages; F6 there calls
  `frontend.focusShell()`.
- `backend/focus.lua`: native Win32 focus via LuaJIT `ffi` (Windows only).
- `tools/`: PowerShell tools for checking the result the way NVDA sees it (see below).

## Why things are the way they are

- Steam's main window (`SDL_app`, title "Steam") holds separate CEF browsers: the shell
  (full window, `steamloopback.host`) and a BrowserView for pages (smaller, on top). NVDA
  reads only the browser with Win32 focus. Their accessibility trees cannot be merged.
- Steam's CSS class names are generated and change with updates. Never select by them.
  Readable exceptions that are stable: `closeButton`, `minimizeButton`, `maximizeButton`,
  `restoreButton`, `Focusable`.
- Controls are found by React props on DOM nodes (`__reactProps$*`, `__reactFiber$*`):
  `onClick` / `onMouseDown` / `onPointerDown` / `onMouseUp`.
- Names come from, in order: visible text, stable class names, the back/forward arrow
  component (`{direction, disabled, onClick}`), which named parent callback the onClick is
  (`fnLeftClicked`, `onToggleCollapse`, ...), then tooltip props (`toolTipContent` wins over
  `title`, which can be raw English like "Notifications Menu"). `#Tokens` are localized via
  `window.LocalizationManager.LocalizeIfToken`.
- Steam has no strings for minimize/maximize/restore/scroll; those are in `OWN_STRINGS`
  (ru + en).

## Steam internals used

- `window.g_PopupManager`: `GetPopups()`, `AddPopupCreatedCallback()`. Main window popup is
  named `SP Desktop_uid0`; context menus are separate popups `contextmenu_N_uid0`.
- `window.MainWindowBrowserManager`: `.m_browser` is the page BrowserView itself (has
  `SetFocus`, `LoadURL`, `on/off`); `.m_history` is the shell router (`listen`,
  `location.pathname`). Pages are shown on route `/browser/`.
- Moving focus INTO the page: `m_browser.SetFocus(true)` works.
- Moving focus OUT of the page: `SetFocus(false)` and
  `popup.window.SteamClient.Window.SetKeyFocus(true)` do NOT move Win32 focus in desktop
  mode. The backend does `AttachThreadInput` + `SetFocus` on the shell's
  `Chrome_WidgetWin_1` (largest visible `CefBrowserWindow` in the foreground `SDL_app`).
- Dropdown menus (menu bar and tabs) are one component with props `{title, menuItems,
  bSuperNavBehavior, ...}`; its wrapper div's `onMouseEnter` opens the menu. The menu object
  sits in a `useRef` hook (has `Show`, `Hide`, `TakeFocus`, `BHasFocus`, `visible`).
  `bSuperNavBehavior` (the tabs) means hover-only and `bNoFocusWhenShown`; calling
  `TakeFocus()` afterwards moves focus into the menu like the menu bar's menus.
- Active tab: route under the tab component's `rootRoute` prop and, for the `/browser` tabs,
  `MainWindowBrowserManager.GetLastActiveTab()` equal to the parent's `tab` prop
  ('store', 'community', 'me'). Steam only toggles a hashed class.
- Notifications: `window.NotificationStore` (toast queue, settings `disable_all_toasts`,
  `disable_toasts_in_game`). The toast component's props hold
  `notification.notificationID`. In Big Picture each toast is a `<div role="alert">`; on the
  desktop every toast opens its own non-focusable popup `notificationtoasts_<id>_desktop`
  (in `g_PopupManager`) without an alert role. Test toasts: `NotificationStore.
  TestFriendMessage(null, text)`, `TestDownloadComplete(appid)`, `TestFriendIngame(name)`.
- Plugin assets: `[assets] resources = [...]` in millennium.toml (only picked up when the
  config file is named `millennium.toml`), read in Lua with `millennium.assets.read(path)`.
  `starlight pack -o <dir>` builds elsewhere without touching Steam; `starlight inspect
  <file>` lists a .star's contents.
- Some panels are hidden by collapsing to inline `height: 0; overflow: hidden` rather than
  unmounting; `hideCollapsed` makes them inert.
- Steam's own UI code is readable (minified) in `C:\Program Files (x86)\Steam\steamui\*.js`
  (mostly `sp.js`); localization strings in `steamui\localization\*_russian-json.js`.
- F6 is only used by Steam's keyboard-as-gamepad mapping in Big Picture; free in desktop mode.

## Development loop (important)

- **Never run `bun run dev` (watch/HMR).** Hot reloads leave Millennium believing the plugin
  is not running: backend calls fail with "plugin not running", store pages stall on Steam's
  `data:text/html,...tracking...` placeholder, and Millennium's own settings UI breaks.
- `bun run build` writes straight into `Steam\millennium\plugins\steam-accessibility.star`
  and, if Steam is running, hot-restarts the backend, which triggers the problem above. So:
  1. Check the foreground window first (`tools/steam-windows.ps1`); if Steam is in front the
     user is using it, so ask before restarting.
  2. `& 'C:\Program Files (x86)\Steam\Steam.exe' -shutdown` and wait for `steam` to exit.
  3. `bun run build`.
  4. Start Steam with `Start-Process explorer.exe '"C:\Program Files (x86)\Steam\steam.exe"'`
     so it gets the normal user environment, not the shell's. Explorer drops arguments; to
     pass `-cef-enable-debugging`, make a `.lnk` with the argument (WScript.Shell
     `CreateShortcut`, in the scratchpad) and open that through explorer.
- Never send synthetic keys unless Steam is the foreground window.
- Frontend `console.log` output is not visible live, not even through DevTools (Millennium
  routes plugin consoles elsewhere). Check results through the accessibility tree instead.
- With `-cef-enable-debugging` (ask first; any local program can then control Steam), the
  DevTools port 127.0.0.1:8080 lists every Steam window; `Runtime.evaluate` on the
  `SharedJSContext` target runs code in Steam's UI. `Millennium.callServerMethod(
  'steam-accessibility', 'speak', { text })` calls a backend export directly, and
  `MILLENNIUM_PRIVATE_INTERNAL_FOREIGN_FUNCTION_INTERFACE_DO_NOT_USE.nextId` counts backend
  calls.

## Verifying changes

- `.\tools\msaa-dump.ps1 -Target shell` (or `page`): the tree NVDA sees, with roles, names,
  focusable/unavailable states and descriptions. Search it for unnamed controls with
  `Select-String "\[кнопка\] name=''"` (role names are localized by Windows).
- `.\tools\msaa-dump.ps1 -Target shell -DoDefault 'МАГАЗИН'`: activate an element the way
  NVDA's Enter does in browse mode.
- `.\tools\steam-windows.ps1`: which browser has Win32 focus (for F6 / auto-focus).
- `.\tools\test-toast.ps1 [-Text ...] [-Kind Download -AppId 570]`: make Steam show a test
  toast (needs the DevTools port above).
- To learn what an unnamed control carries, temporarily set
  `aria-description` to its fiber prop keys (walk `__reactFiber$*` `.return` chain and list
  `memoizedProps` keys), rebuild, and read `desc=` in the dump. Remove before committing.

## Open work

- Unnamed: some Library sidebar icons, 41x41 buttons on game tiles.
- Untested so far: toast speech in game (and with "disable toasts in game").
- Announce status changes (downloads, update notices) via live regions.
- Not yet examined: library game list, game page (Play button and its menus), context menu
  arrow-key navigation, Friends window, Settings window.
- Linux is untested; `backend/focus.lua` returns early there.

## Publishing

- GitHub: `alex19EP/steam-accessibility-millennium-plugin` (planned), MIT.
- Decision (2026-10-16): GitHub only for now; do not submit to the Millennium plugin
  database unless the author brings it up again.
- If that changes, Millennium plugin database: PR adding a submodule to
  `SteamClientHomebrew/PluginDatabase`. Their guidelines forbid primarily AI-generated
  plugins and require AI disclosure; never disguise AI-written code. Their checklist also asks
  for testing on Steam Stable and Beta. Mention the `ffi` Win32 calls to reviewers.
- PR descriptions must end with the `## AI Usage Disclosure` section from the user's global
  instructions.
