<#
.SYNOPSIS
  Dump the MSAA/IAccessible2 tree NVDA sees for the Steam window, or activate an element.

.EXAMPLE
  .\tools\msaa-dump.ps1 -Target shell             # Steam window: menus, tabs, buttons
  .\tools\msaa-dump.ps1 -Target page -MaxNodes 200 # Store/Community page browser
  .\tools\msaa-dump.ps1 -Target shell -DoDefault 'МАГАЗИН'   # like NVDA pressing Enter on it

.NOTES
  Steam's desktop window (class SDL_app) holds one CefBrowserWindow per browser. The shell
  browser fills the whole window; the page browser (BrowserView) is the smaller visible one.
#>
param(
  [ValidateSet('shell', 'page')][string]$Target = 'shell',
  [string]$Hwnd,
  [int]$MaxNodes = 3000,
  [int]$MaxDepth = 60,
  [string]$DoDefault
)

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

[ComImport, Guid("618736E0-3C3D-11CF-810C-00AA00389B71"), InterfaceType(ComInterfaceType.InterfaceIsDual)]
public interface IAcc {
  [return: MarshalAs(UnmanagedType.IDispatch)] object get_accParent();
  int get_accChildCount();
  [return: MarshalAs(UnmanagedType.IDispatch)] object get_accChild(object v);
  string get_accName(object v);
  string get_accValue(object v);
  string get_accDescription(object v);
  object get_accRole(object v);
  object get_accState(object v);
  string get_accHelp(object v);
  int get_accHelpTopic(out string f, object v);
  string get_accKeyboardShortcut(object v);
  object get_accFocus();
  object get_accSelection();
  string get_accDefaultAction(object v);
  void accSelect(int f, object v);
  void accLocation(out int l, out int t, out int w, out int h, object v);
  object accNavigate(int dir, object start);
  object accHitTest(int x, int y);
  void accDoDefaultAction(object v);
}

public static class SteamWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }

  static string Cls(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
  static string Txt(IntPtr h) { var s = new StringBuilder(256); GetWindowText(h, s, 256); return s.ToString(); }

  /** The render widget (accessibility root) of the shell or page browser in Steam's main window. */
  public static IntPtr Find(bool page) {
    IntPtr top = IntPtr.Zero;
    EnumWindows((h, x) => { if (Cls(h) == "SDL_app" && Txt(h) == "Steam" && IsWindowVisible(h)) { top = h; return false; } return true; }, IntPtr.Zero);
    if (top == IntPtr.Zero) return IntPtr.Zero;
    var browsers = new List<KeyValuePair<long, IntPtr>>();
    EnumChildWindows(top, (h, x) => {
      if (GetParent(h) == top && Cls(h) == "CefBrowserWindow" && IsWindowVisible(h)) {
        RECT r; GetWindowRect(h, out r);
        browsers.Add(new KeyValuePair<long, IntPtr>((long)(r.R - r.L) * (r.B - r.T), h));
      }
      return true;
    }, IntPtr.Zero);
    browsers.Sort((a, b) => b.Key.CompareTo(a.Key));
    int index = page ? 1 : 0;
    if (browsers.Count <= index) return IntPtr.Zero;
    IntPtr widget = IntPtr.Zero;
    EnumChildWindows(browsers[index].Value, (h, x) => {
      if (Cls(h) == "Chrome_RenderWidgetHostHWND" && IsWindowVisible(h)) { widget = h; return false; }
      return true;
    }, IntPtr.Zero);
    return widget;
  }
}

public static class Msaa {
  [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr h, uint id, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object o);
  [DllImport("oleacc.dll")] static extern int AccessibleChildren(IAcc p, int start, int n, [Out] object[] kids, out int got);
  [DllImport("oleacc.dll", CharSet=CharSet.Unicode)] static extern uint GetRoleText(uint r, StringBuilder s, uint n);
  static Guid IID = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");

  static IAcc FromHwnd(IntPtr h) {
    object o; int hr = AccessibleObjectFromWindow(h, 0xFFFFFFFC /*OBJID_CLIENT*/, ref IID, out o);
    if (hr != 0) throw new COMException("AccessibleObjectFromWindow failed", hr);
    return (IAcc)o;
  }
  static object[] Kids(IAcc a) {
    int n; try { n = a.get_accChildCount(); } catch { return new object[0]; }
    if (n <= 0) return new object[0];
    var k = new object[n]; int got;
    if (AccessibleChildren(a, 0, n, k, out got) != 0) return new object[0];
    Array.Resize(ref k, got); return k;
  }
  static string S(Func<string> f) { try { return f() ?? ""; } catch { return "?"; } }
  static string RoleText(object r) {
    if (r is int) { var sb = new StringBuilder(128); GetRoleText((uint)(int)r, sb, 128); return sb.ToString(); }
    return r == null ? "" : r.ToString();
  }
  static string Describe(IAcc a, object child) {
    object self = child ?? (object)0;
    string role = S(() => RoleText(a.get_accRole(self)));
    string name = S(() => a.get_accName(self)); if (name.Length > 90) name = name.Substring(0, 90) + "...";
    string val = S(() => a.get_accValue(self)); if (val.Length > 60) val = val.Substring(0, 60) + "...";
    int st = 0; try { st = Convert.ToInt32(a.get_accState(self)); } catch {}
    int l = 0, t = 0, w = 0, h = 0; try { a.accLocation(out l, out t, out w, out h, self); } catch {}
    var flags = new StringBuilder();
    if ((st & 0x4) != 0) flags.Append(" FOCUSED");
    if ((st & 0x100000) != 0) flags.Append(" focusable");
    if ((st & 0x8000) != 0) flags.Append(" INVISIBLE");
    if ((st & 0x10000) != 0) flags.Append(" offscreen");
    if ((st & 0x1) != 0) flags.Append(" unavailable");
    string desc = S(() => a.get_accDescription(self)).Replace("\n", " | ");
    if (desc.Length > 600) desc = desc.Substring(0, 600) + "...";
    return string.Format("[{0}] name='{1}'{2} rect=({3},{4} {5}x{6}){7}{8}", role, name,
      val.Length > 0 ? " value='" + val + "'" : "", l, t, w, h, flags,
      desc.Length > 0 ? " desc='" + desc + "'" : "");
  }

  static int count;
  static void Walk(IAcc a, int d, int maxNodes, int maxDepth, StringBuilder o) {
    if (count >= maxNodes) return;
    count++;
    o.Append(' ', d * 2).AppendLine(Describe(a, null));
    if (d >= maxDepth) return;
    foreach (var k in Kids(a)) {
      if (count >= maxNodes) { o.Append(' ', d * 2 + 2).AppendLine("...truncated"); return; }
      var ka = k as IAcc;
      if (ka != null) Walk(ka, d + 1, maxNodes, maxDepth, o);
      else { count++; o.Append(' ', d * 2 + 2).Append("(simple) ").AppendLine(Describe(a, k)); }
    }
  }
  public static string Dump(IntPtr hwnd, int maxNodes, int maxDepth) {
    count = 0;
    var o = new StringBuilder();
    try { Walk(FromHwnd(hwnd), 0, maxNodes, maxDepth, o); }
    catch (Exception e) { o.AppendLine("ERROR: " + e.Message); }
    o.AppendLine("(nodes: " + count + ")");
    return o.ToString();
  }

  static IAcc FindByName(IAcc a, string name, int d) {
    string n = ""; try { n = a.get_accName(0) ?? ""; } catch {}
    if (n == name) return a;
    if (d > 60) return null;
    foreach (var k in Kids(a)) {
      var ka = k as IAcc;
      if (ka == null) continue;
      var r = FindByName(ka, name, d + 1);
      if (r != null) return r;
    }
    return null;
  }
  /** Like NVDA pressing Enter in browse mode: accDoDefaultAction on the first element with this exact name. */
  public static string DoDefault(IntPtr hwnd, string name) {
    var a = FindByName(FromHwnd(hwnd), name, 0);
    if (a == null) return "not found: " + name;
    string desc = Describe(a, null);
    try { a.accDoDefaultAction(0); return "did default action on " + desc; }
    catch (Exception e) { return "default action failed on " + desc + ": " + e.Message; }
  }
}
"@

$h = if ($Hwnd) { [IntPtr][Convert]::ToInt64($Hwnd, 16) } else { [SteamWin]::Find($Target -eq 'page') }
if ($h -eq [IntPtr]::Zero) { throw "Steam $Target browser not found (is Steam open and is a page shown?)" }

if ($DoDefault) { [Msaa]::DoDefault($h, $DoDefault); return }
"=== $Target, HWND 0x{0:X} ===" -f $h.ToInt64()
[Msaa]::Dump($h, $MaxNodes, $MaxDepth)
