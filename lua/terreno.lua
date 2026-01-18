local parser = require("terreno.parser")

local M = {}

---@class TerrenoConfig
---@field server_url string Terreno server URL
---@field port number Server port
local default_config = {
  server_url = "http://localhost",
  port = 3000,
}

---@type TerrenoConfig
M.config = default_config

---@param opts TerrenoConfig?
M.setup = function(opts)
  M.config = vim.tbl_deep_extend("force", default_config, opts or {})
end

--- Send a graph to the server
---@param graph table { nodes: table[], edges: table[] }
M.send_graph = function(graph)
  local url = M.config.server_url .. ":" .. M.config.port .. "/api/graph"
  local json = vim.fn.json_encode(graph)

  vim.fn.jobstart({
    "curl",
    "-s",
    "-X", "POST",
    "-H", "Content-Type: application/json",
    "-d", json,
    url,
  }, {
    on_exit = function(_, code)
      if code == 0 then
        vim.notify("Terreno: graph sent", vim.log.levels.INFO)
      else
        vim.notify("Terreno: failed to send graph", vim.log.levels.ERROR)
      end
    end,
  })
end

--- Send current buffer to the server
M.send_buffer = function()
  local bufnr = vim.api.nvim_get_current_buf()
  local filename = vim.fn.expand("%:t")

  if filename == "" then
    filename = "[No Name]"
  end

  local functions = parser.get_functions(bufnr)

  if #functions == 0 then
    vim.notify("Terreno: no functions found in buffer", vim.log.levels.WARN)
    return
  end

  local graph = parser.functions_to_graph(functions, filename)
  vim.notify("Terreno: found " .. #functions .. " functions", vim.log.levels.INFO)
  M.send_graph(graph)
end

return M
