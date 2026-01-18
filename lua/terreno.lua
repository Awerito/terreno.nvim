local lsp = require("terreno.lsp")

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

--- Send current buffer symbols to the server (via LSP)
M.send_buffer = function()
  local bufnr = vim.api.nvim_get_current_buf()
  local filename = vim.fn.expand("%:t")

  if filename == "" then
    filename = "[No Name]"
  end

  lsp.get_document_symbols(bufnr, function(symbols)
    if #symbols == 0 then
      vim.notify("Terreno: no symbols found (is LSP attached?)", vim.log.levels.WARN)
      return
    end

    local graph = lsp.symbols_to_graph(symbols, filename)
    vim.notify("Terreno: found " .. #symbols .. " symbols", vim.log.levels.INFO)
    M.send_graph(graph)
  end)
end

--- Send workspace symbols to the server (via LSP)
---@param query string|nil Search query (empty for all)
M.send_workspace = function(query)
  lsp.get_workspace_symbols(query or "", function(symbols)
    if #symbols == 0 then
      vim.notify("Terreno: no workspace symbols found", vim.log.levels.WARN)
      return
    end

    local cwd = vim.fn.fnamemodify(vim.fn.getcwd(), ":t")
    local graph = lsp.symbols_to_graph(symbols, cwd)
    vim.notify("Terreno: found " .. #symbols .. " workspace symbols", vim.log.levels.INFO)
    M.send_graph(graph)
  end)
end

return M
