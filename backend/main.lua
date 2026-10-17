local logger     = require("logger")
local millennium = require("millennium")

require("focus")
local speech = require("speech")

local function on_load()
    logger:info("Steam Accessibility loaded, Millennium " .. millennium.version())
    millennium.ready()
end

local function on_unload()
    speech.shutdown()
    logger:info("Steam Accessibility unloaded")
end

return {
    on_load = on_load,
    on_unload = on_unload,
}
