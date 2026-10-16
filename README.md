# Steam Accessibility Millennium Plugin

A [Millennium](https://steambrew.app) plugin that makes the Steam desktop client usable with
screen readers such as NVDA.

## The problem

The Steam desktop client is built from two separate embedded browsers:

- the **Steam window** itself: menus, the Store / Library / Community / Profile tabs,
  window buttons and status bar;
- the **page** shown inside it: Store, Community and Profile pages.

A screen reader only reads the browser that has keyboard focus. Steam keeps focus in the
Steam window, so on a Store page you hear only the menus and tabs around the page, never the
page itself, unless you click into it with the mouse.

On top of that, the Steam window's menus, tabs and icon buttons are plain `div` elements
with no role and no name. They are not announced as buttons, cannot be reached with Tab,
and icon-only buttons are silent.

## What the plugin does

- **Moves focus into the page** automatically when you open the Store, Community or your
  profile.
- **F6** switches focus between the page and the Steam window, in both directions, like F6
  in a regular web browser.
- **Makes the Steam window's controls real buttons**: menus (Steam, View, Friends, Games,
  Help), tabs, notifications, account, Big Picture, minimize/maximize/close, back and
  forward. They get a role, a name and Tab focus, and work with Enter, Space and the screen
  reader's own activation.
- **Opens the tab menus from the keyboard**: sighted users open the Store, Library,
  Community and Profile menus (Wishlist, Downloads, Market, Activity, ...) by hovering over
  the tab. After each tab there is now a "Menu: <tab>" button that opens the same menu and
  moves focus into it. The tab itself still goes to its section.
- **Hides collapsed notices**: panels Steam has closed, such as the client update bar in
  the Library, are no longer read in browse mode or reached with Tab.
- **Names icon-only buttons** from the tooltip text Steam shows sighted users, in Steam's
  own language.
- **Reports disabled state**, for example "Forward, unavailable" when there is no page to
  go forward to.
- **Silences decorative images** inside buttons that already have a name.

Nothing is matched by Steam's generated CSS class names, which change with every update.
Controls are found by the click handlers React attaches to them, and named from the
tooltips and labels Steam already passes to them.

## Requirements

- Windows. The F6 jump back from a page to the Steam window uses a native Windows call.
  The other fixes are plain JavaScript and may work on Linux, but this is untested.
- [Millennium](https://steambrew.app) 3.4 or later.

## Installing Millennium without the graphical installer

Millennium's official installer draws its own interface, which screen readers cannot read.
It only does a few simple steps, which you can do by hand:

1. Close Steam completely.
2. Download `millennium-<version>-windows-x86_64.zip` from the
   [Millennium releases](https://github.com/SteamClientHomebrew/Millennium/releases).
3. Optionally, check its SHA-256 checksum against the `.sha256` file next to it in the
   release.
4. Extract the archive into your Steam folder, usually `C:\Program Files (x86)\Steam`. This
   adds `wsock32.dll` and a `millennium` folder.
5. Start Steam.

To uninstall, close Steam and delete `wsock32.dll` and the `millennium` folder.

## Installing the plugin

From source:

1. Install [Bun](https://bun.sh).
2. Close Steam.
3. In this folder, run `bun install`, then `bun run build`. The build is placed directly into
   Millennium's plugin folder.
4. Start Steam and enable **Steam Accessibility** under Millennium settings, Plugins. You can
   also add `"steam-accessibility"` to `plugins.enabledPlugins` in
   `Steam\millennium\config\config.json` while Steam is closed.

## Keyboard

- **F6**: move focus between the Steam window and the page it is showing.
- **Tab / Shift+Tab**: move between the Steam window's buttons.
- **Enter or Space**: activate the focused button.
- **Enter on "Menu: Store"** (and the other tab menu buttons): open that tab's menu.

## Known limitations

- A few icon buttons in the Library are still unnamed.
- Which of the Store / Library / Community / Profile tabs is active is not announced yet.
- Status messages such as download progress are not announced when they change.

Bug reports from screen reader users are very welcome. Please mention your screen reader and
Steam's interface language.

## AI usage disclosure

Most of this plugin's code was written with Claude (Anthropic), working with the author, who
is a screen reader user. The author tested every change in Steam with NVDA.

## License

[MIT](LICENSE)
