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
- **Announces the active tab**: the Store, Library, Community or Profile tab you are in is
  reported as the current page.
- **Speaks Steam's notifications**: friend messages, downloads finishing and other toasts
  pop up in a separate window that screen readers never read. The plugin sends their text
  to your screen reader (or, without one, to a Windows voice) using
  [Prism](https://github.com/ethindp/prism).
- **Hides collapsed notices**: panels Steam has closed, such as the client update bar in
  the Library, are no longer read in browse mode or reached with Tab.
- **Names icon-only buttons** from the tooltip text Steam shows sighted users, in Steam's
  own language.
- **Reports disabled state**, for example "Forward, unavailable" when there is no page to
  go forward to.
- **Silences decorative images** inside buttons that already have a name.

### Experimental: accessible in-game overlay

Steam's in-game overlay (Shift+Tab, or the key set in Steam's settings) is drawn inside the
game window, so screen readers cannot read it. The setting **Accessible in-game overlay
(experimental)**, in the plugin's settings under Millennium settings, opens the overlay's
windows (friends list, achievements, guides, the web browser) as real windows instead:

- the overlay key opens them and moves focus there; the overlay key or Alt+F4 closes them
  and returns focus to the game;
- F6 moves between the overlay's windows and into and out of a web page in them;
- notifications the overlay shows are only spoken, focus stays in the game.

It is off by default and only affects games started after it is turned on. It is not
reliable yet: sometimes the overlay opens without anything being read, F6 can stop
responding for half a minute, and when a game starts the screen reader may briefly say
"SP Overlay". Turn it off again if it gets in the way.

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

The plugin is a single file, `steam-accessibility.star`. Nothing needs to be compiled.

1. Close Steam completely.
2. Download `steam-accessibility.star` from the latest
   [release](https://github.com/alex19EP/steam-accessibility-millennium-plugin/releases/latest).
3. Optionally, check its SHA-256 checksum against `steam-accessibility.star.sha256` in the
   same release.
4. Copy it into Millennium's plugin folder, usually
   `C:\Program Files (x86)\Steam\millennium\plugins`.
5. Start Steam and enable **Steam Accessibility** under Millennium settings, Plugins. You can
   also add `"steam-accessibility"` to `plugins.enabledPlugins` in
   `Steam\millennium\config\config.json` while Steam is closed.

To update, close Steam and replace the file with the new one. To uninstall, close Steam and
delete it.

### Building from source

1. Install [Bun](https://bun.sh).
2. Close Steam.
3. In this folder, run `bun install`, then `bun run build`. The build is placed directly into
   Millennium's plugin folder, replacing any installed release.
4. Enable the plugin as in step 5 above.

To build somewhere else without touching Steam, run
`./node_modules/.bin/starlight pack --release -o dist`.

### Making a release

1. Set `version` in `millennium.toml`, for example `0.2.0`, and commit it.
2. Tag the commit with the same version and push the tag:
   `git tag v0.2.0` and `git push origin v0.2.0`.

GitHub Actions then builds the plugin and publishes a release with `steam-accessibility.star`
and its checksum attached (see `.github/workflows/release.yml`). The build fails if the tag
does not match the version in `millennium.toml`.

## Keyboard

- **F6**: move focus between the Steam window and the page it is showing.
- **Tab / Shift+Tab**: move between the Steam window's buttons.
- **Enter or Space**: activate the focused button.
- **Enter on "Menu: Store"** (and the other tab menu buttons): open that tab's menu.

## Known limitations

- A few icon buttons in the Library are still unnamed.
- Status messages such as download progress are not announced when they change.
- Notifications you turned off in Steam's settings (all of them, or while in game) are not
  spoken either. In game, notifications are only spoken when the Steam overlay is enabled
  for that game, because without it Steam drops them.
- The accessible in-game overlay is experimental (see above).

Bug reports from screen reader users are very welcome. Please mention your screen reader and
Steam's interface language.

## AI usage disclosure

Most of this plugin's code was written with Claude (Anthropic), working with the author, who
is a screen reader user. The author tested every change in Steam with NVDA.

## License

[MIT](LICENSE)

The plugin bundles `prism.dll` from [Prism](https://github.com/ethindp/prism) v0.18.3
(MPL-2.0), which includes the NVDA controller client (LGPL-2.1) and other libraries. Their
licenses are in [resources/prism/LICENSES](resources/prism/LICENSES). On first use the DLL is
copied to `%LOCALAPPDATA%\steam-accessibility\`.
