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

-- Neovim server socket path for bidirectional communication
M.server_name = nil

---@param opts TerrenoConfig?
M.setup = function(opts)
  M.config = vim.tbl_deep_extend("force", default_config, opts or {})

  -- Start Neovim server for receiving commands from browser
  if not M.server_name then
    M.server_name = vim.fn.serverstart("terreno")
    if M.server_name ~= "" then
      -- Register the socket with the server
      M.register_socket()
    end
  end
end

--- Register Neovim socket with the Terreno server
M.register_socket = function()
  local url = M.config.server_url .. ":" .. M.config.port .. "/api/register"
  local data = vim.fn.json_encode({
    socket = M.server_name,
    cwd = vim.fn.getcwd(),
  })

  vim.fn.jobstart({
    "curl", "-s", "-X", "POST",
    "-H", "Content-Type: application/json",
    "-d", data,
    url,
  }, {
    on_exit = function(_, code)
      if code == 0 then
        vim.notify("Terreno: connected to server", vim.log.levels.INFO)
      end
    end,
  })
end

--- Navigate to a file and line (called by server via RPC)
---@param filepath string Full path to file
---@param line number Line number (1-indexed)
M.navigate_to = function(filepath, line)
  vim.schedule(function()
    vim.cmd("edit " .. vim.fn.fnameescape(filepath))
    if line and line > 0 then
      vim.api.nvim_win_set_cursor(0, { line, 0 })
      vim.cmd("normal! zz")
    end
  end)
end

--- Send document symbols for a specific file (called by server for range detection)
---@param filepath string Full path to file
---@param request_id string Unique request ID for matching response
M.send_document_symbols = function(filepath, request_id)
  -- Open the file in a buffer (hidden) to get LSP symbols
  local bufnr = vim.fn.bufadd(filepath)
  vim.fn.bufload(bufnr)

  lsp.get_document_symbols(bufnr, function(symbols)
    local url = M.config.server_url .. ":" .. M.config.port .. "/api/symbols"
    local data = vim.fn.json_encode({
      request_id = request_id,
      filepath = filepath,
      symbols = symbols,
    })

    vim.fn.jobstart({
      "curl", "-s", "-X", "POST",
      "-H", "Content-Type: application/json",
      "-d", data,
      url,
    })
  end)
end

--- Get code snippet around a line
---@param filepath string Full path to file
---@param line number Center line
---@param context number Lines of context before/after (default 5)
---@return string[] lines
M.get_code_snippet = function(filepath, line, context)
  context = context or 5
  local lines = {}

  local file = io.open(filepath, "r")
  if not file then
    return lines
  end

  local current_line = 0
  local start_line = math.max(1, line - context)
  local end_line = line + context

  for content in file:lines() do
    current_line = current_line + 1
    if current_line >= start_line and current_line <= end_line then
      table.insert(lines, { num = current_line, text = content })
    end
    if current_line > end_line then
      break
    end
  end

  file:close()
  return lines
end

--- Send a graph to the server
---@param graph table { nodes: table[], edges: table[] }
M.send_graph = function(graph)
  local url = M.config.server_url .. ":" .. M.config.port .. "/api/graph"
  local json = vim.fn.json_encode(graph)

  -- Write JSON to temp file to avoid "argument list too long" error
  local tmpfile = "/tmp/terreno_graph.json"
  local f = io.open(tmpfile, "w")
  if f then
    f:write(json)
    f:close()
  else
    vim.notify("Terreno: failed to write temp file", vim.log.levels.ERROR)
    return
  end

  vim.fn.jobstart({
    "curl",
    "-s",
    "-X", "POST",
    "-H", "Content-Type: application/json",
    "-d", "@" .. tmpfile,
    url,
  }, {
    on_exit = function(_, code)
      if code == 0 then
        vim.notify("Terreno: graph sent", vim.log.levels.INFO)
      else
        vim.notify("Terreno: failed to send graph", vim.log.levels.ERROR)
      end
      -- Clean up temp file
      os.remove(tmpfile)
    end,
  })
end

--- Send current buffer symbols to the server (via LSP)
M.send_buffer = function()
  local bufnr = vim.api.nvim_get_current_buf()
  local filename = vim.fn.expand("%:t")
  local filepath = vim.fn.expand("%:p")

  if filename == "" then
    filename = "[No Name]"
  end

  lsp.get_document_symbols(bufnr, function(symbols)
    if #symbols == 0 then
      vim.notify("Terreno: no symbols found (is LSP attached?)", vim.log.levels.WARN)
      return
    end

    local graph = lsp.symbols_to_graph(symbols, filename, filepath)
    vim.notify("Terreno: found " .. #symbols .. " symbols", vim.log.levels.INFO)
    M.send_graph(graph)
  end)
end

--- Send workspace call graph to the server (via LSP)
---@param query string|nil Search query to filter functions
M.send_workspace = function(query)
  lsp.build_workspace_call_graph(query or "", function(graph)
    if #graph.nodes == 0 then
      vim.notify("Terreno: no functions found", vim.log.levels.WARN)
      return
    end

    M.send_graph(graph)
  end)
end

--- Send call hierarchy graph from cursor position
---@param depth number|nil Max depth to explore (default 3)
M.send_calls = function(depth)
  depth = tonumber(depth) or 3
  local bufnr = vim.api.nvim_get_current_buf()

  lsp.prepare_call_hierarchy(bufnr, function(item)
    if not item then
      vim.notify("Terreno: no function at cursor (or LSP doesn't support call hierarchy)", vim.log.levels.WARN)
      return
    end

    vim.notify("Terreno: building call graph for " .. item.name .. "...", vim.log.levels.INFO)

    lsp.build_call_graph(item, depth, function(nodes, edges)
      if #nodes == 0 then
        vim.notify("Terreno: no calls found", vim.log.levels.WARN)
        return
      end

      local graph = { nodes = nodes, edges = edges }
      vim.notify("Terreno: found " .. #nodes .. " functions, " .. #edges .. " calls", vim.log.levels.INFO)
      M.send_graph(graph)
    end)
  end)
end

return M
