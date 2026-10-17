-- Speech output through Prism (https://github.com/ethindp/prism), which talks to the running
-- screen reader (NVDA, JAWS, ...) and falls back to OneCore/SAPI voices. Steam draws its
-- desktop notifications in a window that can never have focus, so screen readers never read
-- them; the frontend sends their text here instead.
--
-- prism.dll ships inside the .star as a resource. A DLL can only be loaded from disk, so it is
-- written once to %LOCALAPPDATA%\steam-accessibility\. Paths go through the UTF-16 Win32 API:
-- LuaJIT's io and ffi.load use ANSI paths, which break on non-Latin user names.
local ffi        = require("ffi")
local logger     = require("logger")
local millennium = require("millennium")

local PRISM_VERSION = "0.18.3"
local PRISM_ASSET   = "resources/prism/prism.dll"
local PRISM_DLL     = "prism-" .. PRISM_VERSION .. ".dll"

ffi.cdef [[
typedef struct PrismContext PrismContext;
typedef struct PrismBackend PrismBackend;
typedef struct PrismRegistry PrismRegistry;
typedef uint64_t PrismBackendId;
typedef void (*PrismAvailabilityCallback)(void *userdata, PrismBackendId backend,
                                          const char *name, bool available);
typedef void (*PrismAvailabilityBaselineCallback)(void *userdata);
typedef struct {
  uint8_t version;
  PrismRegistry *registry;
  PrismAvailabilityCallback availability_callback;
  void *availability_userdata;
  uint32_t availability_poll_interval_ms;
  uint32_t availability_debounce_samples;
  uint32_t availability_backoff_max_ms;
  bool availability_auto_power_manage;
  PrismAvailabilityBaselineCallback availability_baseline_callback;
} PrismConfig;
typedef enum PrismError {
  PRISM_OK = 0,
  PRISM_ERROR_NOT_INITIALIZED,
  PRISM_ERROR_INVALID_PARAM,
  PRISM_ERROR_NOT_IMPLEMENTED,
  PRISM_ERROR_NO_VOICES,
  PRISM_ERROR_VOICE_NOT_FOUND,
  PRISM_ERROR_SPEAK_FAILURE,
  PRISM_ERROR_MEMORY_FAILURE,
  PRISM_ERROR_RANGE_OUT_OF_BOUNDS,
  PRISM_ERROR_INTERNAL,
  PRISM_ERROR_NOT_SPEAKING,
  PRISM_ERROR_NOT_PAUSED,
  PRISM_ERROR_ALREADY_PAUSED,
  PRISM_ERROR_INVALID_UTF8,
  PRISM_ERROR_INVALID_OPERATION,
  PRISM_ERROR_ALREADY_INITIALIZED,
  PRISM_ERROR_BACKEND_NOT_AVAILABLE,
  PRISM_ERROR_UNKNOWN,
  PRISM_ERROR_INVALID_AUDIO_FORMAT,
  PRISM_ERROR_INTERNAL_BACKEND_LIMIT_EXCEEDED,
  PRISM_ERROR_BACKEND_ENTERED_UNDEFINED_STATE,
  PRISM_ERROR_LIBRARY_LOAD_FAILED,
  PRISM_ERROR_LIBRARY_INVALID,
  PRISM_ERROR_INCOMPATIBLE_ABI
} PrismError;
typedef enum PrismLogLevel {
  PRISM_LOG_LEVEL_TRACE,
  PRISM_LOG_LEVEL_DEBUG,
  PRISM_LOG_LEVEL_INFO,
  PRISM_LOG_LEVEL_WARN,
  PRISM_LOG_LEVEL_ERROR,
  PRISM_LOG_LEVEL_NONE
} PrismLogLevel;

PrismConfig prism_config_init(void);
PrismContext *prism_init(PrismConfig *cfg);
void prism_shutdown(PrismContext *ctx);
size_t prism_registry_count(PrismContext *ctx);
PrismBackendId prism_registry_id_at(PrismContext *ctx, size_t index);
int prism_registry_priority(PrismContext *ctx, PrismBackendId id);
PrismBackend *prism_registry_create(PrismContext *ctx, PrismBackendId id);
void prism_backend_free(PrismBackend *backend);
const char *prism_backend_name(PrismBackend *backend);
PrismError prism_backend_initialize(PrismBackend *backend);
PrismError prism_backend_output(PrismBackend *backend, const char *text, bool interrupt);
const char *prism_error_string(PrismError error);
PrismLogLevel prism_set_log_level(PrismLogLevel level);

typedef void* HANDLE;
typedef void* HMODULE;
int MultiByteToWideChar(unsigned int cp, unsigned long flags, const char* s, int n, uint16_t* w, int wn);
int WideCharToMultiByte(unsigned int cp, unsigned long flags, const uint16_t* w, int wn, char* s, int n,
                        const char* def, int* used);
unsigned long GetEnvironmentVariableW(const uint16_t* name, uint16_t* buf, unsigned long size);
int CreateDirectoryW(const uint16_t* path, void* security);
HANDLE CreateFileW(const uint16_t* path, unsigned long access, unsigned long share, void* security,
                   unsigned long disposition, unsigned long flags, HANDLE templ);
int WriteFile(HANDLE h, const void* buf, unsigned long n, unsigned long* written, void* overlapped);
int CloseHandle(HANDLE h);
int MoveFileExW(const uint16_t* from, const uint16_t* to, unsigned long flags);
unsigned long GetFileAttributesW(const uint16_t* path);
HMODULE LoadLibraryW(const uint16_t* path);
unsigned long GetLastError(void);
unsigned long long GetTickCount64(void);
]]

local C = ffi.C
local CP_UTF8 = 65001
local INVALID_HANDLE = ffi.cast("HANDLE", -1)
local INVALID_ATTRIBUTES = 0xFFFFFFFF

-- Prism ranks screen readers at 100 or above and OneCore/SAPI below. On a fallback voice we
-- keep looking for a screen reader (one may start after Steam), but not on every message.
local SCREEN_READER_PRIORITY = 100
local RESELECT_INTERVAL_MS = 10000

local function wide(s)
    local n = C.MultiByteToWideChar(CP_UTF8, 0, s, #s, nil, 0)
    local buf = ffi.new("uint16_t[?]", n + 1)
    C.MultiByteToWideChar(CP_UTF8, 0, s, #s, buf, n)
    return buf
end

local function narrow(w, n)
    local size = C.WideCharToMultiByte(CP_UTF8, 0, w, n, nil, 0, nil, nil)
    local buf = ffi.new("char[?]", size)
    C.WideCharToMultiByte(CP_UTF8, 0, w, n, buf, size, nil, nil)
    return ffi.string(buf, size)
end

local function getenv(name)
    local buf = ffi.new("uint16_t[1024]")
    local n = C.GetEnvironmentVariableW(wide(name), buf, 1024)
    if n == 0 or n >= 1024 then return nil end
    return narrow(buf, n)
end

local function file_exists(path)
    return C.GetFileAttributesW(wide(path)) ~= INVALID_ATTRIBUTES
end

local function write_file(path, data)
    local GENERIC_WRITE, CREATE_ALWAYS = 0x40000000, 2
    local h = C.CreateFileW(wide(path), GENERIC_WRITE, 0, nil, CREATE_ALWAYS, 0, nil)
    if h == INVALID_HANDLE then return false, "CreateFileW error " .. C.GetLastError() end
    local written = ffi.new("unsigned long[1]")
    local ok = C.WriteFile(h, ffi.cast("const char*", data), #data, written, nil) ~= 0 and written[0] == #data
    local err = C.GetLastError()
    C.CloseHandle(h)
    if not ok then return false, "WriteFile error " .. err end
    return true
end

--- Write the bundled prism.dll to disk if needed and load it.
local function load_prism()
    local base = getenv("LOCALAPPDATA")
    if not base then return nil, "LOCALAPPDATA is not set" end
    local dir = base .. "\\steam-accessibility"
    local path = dir .. "\\" .. PRISM_DLL
    if not file_exists(path) then
        local data = millennium.assets.read(PRISM_ASSET)
        if not data then return nil, PRISM_ASSET .. " is missing from the plugin" end
        C.CreateDirectoryW(wide(dir), nil)
        -- Write under a temporary name first so a half-written DLL is never loaded.
        local tmp = path .. ".tmp"
        local ok, err = write_file(tmp, data)
        if not ok then return nil, err end
        local MOVEFILE_REPLACE_EXISTING = 1
        if C.MoveFileExW(wide(tmp), wide(path), MOVEFILE_REPLACE_EXISTING) == 0 then
            return nil, "MoveFileExW error " .. C.GetLastError()
        end
    end
    if C.LoadLibraryW(wide(path)) == nil then
        return nil, "LoadLibraryW error " .. C.GetLastError()
    end
    -- Already loaded under this module name, so ffi.load finds it without touching the path.
    local ok, lib = pcall(ffi.load, PRISM_DLL)
    if not ok then return nil, tostring(lib) end
    return lib
end

---@type any The loaded prism.dll namespace
local prism
local ctx
local backend, backend_priority, backend_name = nil, -1, ""
local last_select_ms = 0
local load_error

local function now_ms()
    return tonumber(C.GetTickCount64()) or 0
end

local function release_backend()
    if backend ~= nil then prism.prism_backend_free(backend) end
    backend, backend_priority, backend_name = nil, -1, ""
end

--- Pick the highest-priority backend that initializes, if it beats `min_priority`.
local function select_backend(min_priority)
    last_select_ms = now_ms()
    local count = tonumber(prism.prism_registry_count(ctx)) or 0
    for i = 0, count - 1 do
        local id = prism.prism_registry_id_at(ctx, i)
        if id ~= 0 then
            local priority = prism.prism_registry_priority(ctx, id)
            if priority <= min_priority then break end
            -- create rather than acquire: acquire returns the registry's cached instance,
            -- which keeps handing back the fallback voice we are trying to trade up from.
            local candidate = prism.prism_registry_create(ctx, id)
            if candidate ~= nil then
                local err = prism.prism_backend_initialize(candidate)
                if err == C.PRISM_OK or err == C.PRISM_ERROR_ALREADY_INITIALIZED then
                    local name = prism.prism_backend_name(candidate)
                    release_backend()
                    backend, backend_priority = candidate, priority
                    backend_name = name ~= nil and ffi.string(name) or "unknown"
                    logger:info("speech: using " .. backend_name)
                    return true
                end
                prism.prism_backend_free(candidate)
            end
        end
    end
    return false
end

local function ensure_backend()
    if prism == nil and load_error == nil then
        if jit.os ~= "Windows" or jit.arch ~= "x64" then
            load_error = "Prism is only bundled for Windows x64"
        else
            local lib, err = load_prism()
            if lib then
                prism = lib
                prism.prism_set_log_level(C.PRISM_LOG_LEVEL_ERROR)
                local cfg = ffi.new("PrismConfig[1]", prism.prism_config_init())
                ctx = prism.prism_init(cfg)
                if ctx == nil then load_error = "prism_init failed" end
            else
                load_error = err
            end
        end
        if load_error then logger:error("speech: " .. load_error) end
    end
    if load_error then return false end
    if backend == nil then
        select_backend(-1)
    elseif backend_priority < SCREEN_READER_PRIORITY and now_ms() - last_select_ms > RESELECT_INTERVAL_MS then
        select_backend(backend_priority)
    end
    return backend ~= nil
end

-- Errors that mean the screen reader went away rather than that this text was bad.
local function backend_lost(err)
    return err == C.PRISM_ERROR_BACKEND_NOT_AVAILABLE or err == C.PRISM_ERROR_BACKEND_ENTERED_UNDEFINED_STATE
        or err == C.PRISM_ERROR_INTERNAL or err == C.PRISM_ERROR_SPEAK_FAILURE
        or err == C.PRISM_ERROR_NOT_INITIALIZED or err == C.PRISM_ERROR_UNKNOWN
end

---@ffi
--- Speak and braille text through the user's screen reader, without interrupting it.
---@param text string
---@return string
function speak(text)
    if type(text) ~= "string" or text == "" then return "empty" end
    if not ensure_backend() then return "no speech: " .. (load_error or "no backend available") end
    local err = prism.prism_backend_output(backend, text, false)
    if err ~= C.PRISM_OK and backend_lost(err) then
        logger:warn("speech: " .. backend_name .. " failed (" .. ffi.string(prism.prism_error_string(err)) .. "), reselecting")
        release_backend()
        if select_backend(-1) then err = prism.prism_backend_output(backend, text, false) end
    end
    if err ~= C.PRISM_OK then return "failed: " .. ffi.string(prism.prism_error_string(err)) end
    return "spoken via " .. backend_name
end

local function shutdown()
    if prism == nil then return end
    release_backend()
    if ctx ~= nil then prism.prism_shutdown(ctx) end
    ctx = nil
end

return { shutdown = shutdown }
