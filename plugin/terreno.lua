if vim.g.loaded_terreno then
    return
end
vim.g.loaded_terreno = true

--- Ensure server is running, then execute callback
---@param callback function Called when server is ready
local function with_server(callback)
    local terreno = require("terreno")

    -- Start server if not running
    terreno.start_server(function(port)
        -- Get Neovim server socket for bidirectional communication
        if not terreno.server_name then
            terreno.server_name = vim.v.servername
        end

        -- Register with server, then proceed
        terreno.register_socket(function()
            -- Open browser on first run
            if not vim.g.terreno_browser_opened then
                vim.g.terreno_browser_opened = true
                terreno.open_browser(port)
            end

            -- Execute the actual command
            callback()
        end)
    end)
end

local subcommands = {
    workspace = function()
        with_server(function()
            require("terreno").send_workspace()
        end)
    end,
}

vim.api.nvim_create_user_command("Terreno", function(opts)
    local subcmd = vim.split(opts.args, "%s+", { trimempty = true })[1]

    if not subcmd then
        vim.notify("Terreno: subcommand required (workspace)", vim.log.levels.WARN)
        return
    end

    local fn = subcommands[subcmd]
    if fn then
        fn()
    else
        vim.notify("Terreno: unknown subcommand '" .. subcmd .. "'", vim.log.levels.ERROR)
    end
end, {
    nargs = 1,
    desc = "Terreno commands",
    complete = function()
        return vim.tbl_keys(subcommands)
    end,
})
