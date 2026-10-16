<#
.SYNOPSIS
  List Steam's windows and show which one has Win32 keyboard focus.

.DESCRIPTION
  Use this to check F6: after F6 in a page, focus should be on the Chrome_WidgetWin_1 under the
  large (full-window) CefBrowserWindow; after F6 in the Steam window, on the one under the
  smaller page CefBrowserWindow. NVDA reads whichever browser has this focus.
#>
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint tid, ref GUITHREADINFO g);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO {
    public int cbSize, flags; public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret; public RECT rcCaret;
  }
  public static string Cls(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
  public static string Txt(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
  public static List<IntPtr> Top() { var l = new List<IntPtr>(); EnumWindows((h, x) => { l.Add(h); return true; }, IntPtr.Zero); return l; }
  public static List<IntPtr> Kids(IntPtr p) { var l = new List<IntPtr>(); EnumChildWindows(p, (h, x) => { l.Add(h); return true; }, IntPtr.Zero); return l; }
}
"@

$pids = @(Get-Process steam, steamwebhelper -ErrorAction SilentlyContinue | ForEach-Object Id)
function Show($h, $indent) {
  $p = 0; $null = [W]::GetWindowThreadProcessId($h, [ref]$p)
  $r = New-Object W+RECT; $null = [W]::GetWindowRect($h, [ref]$r)
  "{0}0x{1:X} pid={2} vis={3} class='{4}' text='{5}' rect=({6},{7},{8},{9})" -f $indent, $h.ToInt64(), $p,
    [W]::IsWindowVisible($h), [W]::Cls($h), [W]::Txt($h), $r.L, $r.T, $r.R, $r.B
}

foreach ($h in [W]::Top()) {
  $p = 0; $null = [W]::GetWindowThreadProcessId($h, [ref]$p)
  if ($pids -notcontains $p -or -not [W]::IsWindowVisible($h)) { continue }
  Show $h ''
  foreach ($k in [W]::Kids($h)) {
    $depth = 0; $q = $k
    while (($q = [W]::GetParent($q)) -ne $h -and $q -ne [IntPtr]::Zero) { $depth++ }
    Show $k ('  ' * ($depth + 1))
  }
}

$fg = [W]::GetForegroundWindow()
$p = 0; $tid = [W]::GetWindowThreadProcessId($fg, [ref]$p)
$g = New-Object W+GUITHREADINFO; $g.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($g)
$null = [W]::GetGUIThreadInfo($tid, [ref]$g)
''
"foreground: 0x{0:X} '{1}' pid={2}" -f $fg.ToInt64(), [W]::Cls($fg), $p
"focus:      0x{0:X} '{1}'" -f $g.hwndFocus.ToInt64(), [W]::Cls($g.hwndFocus)
