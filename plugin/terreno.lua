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
  buffer = function()
    with_server(function()
      require("terreno").send_buffer()
    end)
  end,
  workspace = function(query)
    with_server(function()
      require("terreno").send_workspace(query)
    end)
  end,
  calls = function(depth)
    with_server(function()
      require("terreno").send_calls(depth)
    end)
  end,
}

vim.api.nvim_create_user_command("Terreno", function(opts)
  local args = vim.split(opts.args, "%s+", { trimempty = true })
  local subcmd = args[1]

  if not subcmd then
    vim.notify("Terreno: subcommand required (buffer, workspace, calls)", vim.log.levels.WARN)
    return
  end

  local fn = subcommands[subcmd]
  if fn then
    fn(unpack(args, 2))
  else
    vim.notify("Terreno: unknown subcommand '" .. subcmd .. "'", vim.log.levels.ERROR)
  end
end, {
  nargs = "+",
  desc = "Terreno commands",
  complete = function(_, line)
    local args = vim.split(line, "%s+", { trimempty = true })
    if #args <= 2 then
      return vim.tbl_keys(subcommands)
    end
    return {}
  end,
})
