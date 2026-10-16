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
]]

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
