-- Native focus handling. Steam's JS APIs can move focus into a browser view but not back
-- out of it in desktop mode, so give the shell browser Win32 focus directly, the same way a
-- mouse click on it would.
local ffi    = require("ffi")
local logger = require("logger")

ffi.cdef [[
typedef void* HWND;
typedef struct { long left, top, right, bottom; } RECT;
HWND FindWindowExW(HWND parent, HWND after, const uint16_t* cls, const uint16_t* title);
int GetClassNameW(HWND h, uint16_t* buf, int len);
int GetWindowRect(HWND h, RECT* r);
int IsWindowVisible(HWND h);
unsigned long GetWindowThreadProcessId(HWND h, unsigned long* pid);
unsigned long GetCurrentThreadId(void);
int AttachThreadInput(unsigned long attach, unsigned long to, int doAttach);
HWND SetFocus(HWND h);
HWND GetForegroundWindow(void);
int IsWindow(HWND h);
int SetForegroundWindow(HWND h);
void* OpenProcess(unsigned long access, int inherit, unsigned long pid);
int QueryFullProcessImageNameW(void* process, unsigned long flags, uint16_t* name, unsigned long* size);
int CloseHandle(void* h);
]]

local PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

-- ffi.C on Windows resolves kernel32 and user32 exports.
local C = ffi.C

local function wstr(s)
    local buf = ffi.new("uint16_t[?]", #s + 1)
    for i = 1, #s do buf[i - 1] = s:byte(i) end
    return buf
end

local CEF_BROWSER = wstr("CefBrowserWindow")
local CHROME_WIDGET = wstr("Chrome_WidgetWin_1")

local function class_of(h)
    local buf = ffi.new("uint16_t[64]")
    local n = C.GetClassNameW(h, buf, 64)
    local out = {}
    for i = 0, n - 1 do out[#out + 1] = string.char(buf[i] < 128 and buf[i] or 63) end
    return table.concat(out)
end

--- The shell browser fills the whole Steam window; browser views are smaller and sit on top.
local function find_shell_widget(top)
    local best, best_area = nil, -1
    local rect = ffi.new("RECT")
    local child = C.FindWindowExW(top, nil, CEF_BROWSER, nil)
    while child ~= nil do
        if C.IsWindowVisible(child) ~= 0 and C.GetWindowRect(child, rect) ~= 0 then
            local area = (rect.right - rect.left) * (rect.bottom - rect.top)
            if area > best_area then best, best_area = child, area end
        end
        child = C.FindWindowExW(top, child, CEF_BROWSER, nil)
    end
    if best == nil then return nil end
    local widget = C.FindWindowExW(best, nil, CHROME_WIDGET, nil)
    return widget ~= nil and widget or nil
end

---@ffi
--- Give Win32 keyboard focus to the Steam window's own (shell) browser.
---@return string
function focusShellWindow()
    if jit.os ~= "Windows" then
        return "native focus is only implemented on Windows (running on " .. jit.os .. ")"
    end
    local top = C.GetForegroundWindow()
    if top == nil or class_of(top) ~= "SDL_app" then
        return "foreground window is not a Steam window"
    end
    local widget = find_shell_widget(top)
    if widget == nil then return "shell browser not found" end

    local target = C.GetWindowThreadProcessId(widget, nil)
    local me = C.GetCurrentThreadId()
    local attached = C.AttachThreadInput(me, target, 1) ~= 0
    local previous = C.SetFocus(widget)
    if attached then C.AttachThreadInput(me, target, 0) end

    local result = string.format("attached=%s previous=%s", tostring(attached), tostring(previous))
    logger:info("focusShellWindow " .. result)
    return result
end

-- The window that was in front (the game) when the accessible overlay opened.
local saved_foreground = nil

--- File name of the process that owns a window, lower case ("steamwebhelper.exe").
local function process_name(h)
    local pid = ffi.new("unsigned long[1]")
    C.GetWindowThreadProcessId(h, pid)
    local process = C.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid[0])
    if process == nil then return "" end
    local buf = ffi.new("uint16_t[260]")
    local size = ffi.new("unsigned long[1]", 260)
    local ok = C.QueryFullProcessImageNameW(process, 0, buf, size) ~= 0
    C.CloseHandle(process)
    if not ok then return "" end
    local out = {}
    for i = 0, size[0] - 1 do out[#out + 1] = string.char(buf[i] < 128 and buf[i] or 63) end
    return (table.concat(out):match("[^\\]+$") or ""):lower()
end

---@ffi
--- Remember the foreground window before the accessible overlay takes focus. The frontend
--- calls this while none of the overlay's windows are shown, but does not wait for it, so by
--- the time this runs an overlay window (a Steam window) may already be in front.
---@return string
function rememberForeground()
    if jit.os ~= "Windows" then return "only implemented on Windows" end
    local fg = C.GetForegroundWindow()
    if fg == nil then return "no foreground window" end
    local name = process_name(fg)
    if name == "steamwebhelper.exe" then return "kept, Steam window in front" end
    saved_foreground = fg
    return "saved " .. class_of(fg) .. " of " .. name
end

---@ffi
--- Give the foreground back to the remembered window. Hiding the focused overlay window
--- leaves Windows' focus on it instead of the game.
---@return string
function restoreForeground()
    if jit.os ~= "Windows" then return "only implemented on Windows" end
    local target_window = saved_foreground
    if target_window == nil or C.IsWindow(target_window) == 0 then return "nothing to restore" end

    -- Windows only lets the foreground thread hand out the foreground; borrow its input state.
    local fg = C.GetForegroundWindow()
    local me = C.GetCurrentThreadId()
    local target = fg ~= nil and C.GetWindowThreadProcessId(fg, nil) or 0
    local attached = target ~= 0 and C.AttachThreadInput(me, target, 1) ~= 0
    local ok = C.SetForegroundWindow(target_window) ~= 0
    if attached then C.AttachThreadInput(me, target, 0) end

    local result = string.format("attached=%s ok=%s", tostring(attached), tostring(ok))
    logger:info("restoreForeground " .. result)
    return result
end
