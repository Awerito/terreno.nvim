local M = {}

-- LSP Symbol kinds (from LSP spec)
local SymbolKind = {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

-- Reverse mapping for display
local SymbolKindName = {}
for name, kind in pairs(SymbolKind) do
  SymbolKindName[kind] = name
end

--- Check if LSP client is available for buffer
---@param bufnr number Buffer number
---@return boolean
M.has_client = function(bufnr)
  local clients = vim.lsp.get_clients({ bufnr = bufnr })
  return #clients > 0
end

--- Get document symbols from LSP (async)
---@param bufnr number Buffer number
---@param callback function Callback with (symbols: table[])
M.get_document_symbols = function(bufnr, callback)
  bufnr = bufnr or 0

  if not M.has_client(bufnr) then
    vim.notify("Terreno: no LSP client attached", vim.log.levels.WARN)
    callback({})
    return
  end

  local params = { textDocument = vim.lsp.util.make_text_document_params(bufnr) }

  vim.lsp.buf_request(bufnr, "textDocument/documentSymbol", params, function(err, result)
    if err or not result then
      callback({})
      return
    end

    local symbols = M.flatten_symbols(result, bufnr)
    callback(symbols)
  end)
end

--- Flatten nested document symbols into a flat list
---@param symbols table[] Raw LSP symbols
---@param bufnr number Buffer number
---@param parent string|nil Parent name for nested symbols
---@return table[] Flattened symbols
M.flatten_symbols = function(symbols, bufnr, parent)
  local result = {}

  for _, symbol in ipairs(symbols or {}) do
    local name = symbol.name
    local kind = symbol.kind
    local range = symbol.range or (symbol.location and symbol.location.range)

    if name and range then
      local full_name = parent and (parent .. "." .. name) or name

      table.insert(result, {
        name = full_name,
        kind = kind,
        kind_name = SymbolKindName[kind] or "Unknown",
        line = range.start.line + 1,
        end_line = range["end"].line + 1,
        col = range.start.character + 1,
      })

      -- Recursively process children
      if symbol.children then
        local children = M.flatten_symbols(symbol.children, bufnr, full_name)
        for _, child in ipairs(children) do
          table.insert(result, child)
        end
      end
    end
  end

  return result
end

--- Get workspace symbols from LSP (async)
---@param query string Search query (empty for all)
---@param callback function Callback with (symbols: table[])
M.get_workspace_symbols = function(query, callback)
  query = query or ""

  local bufnr = vim.api.nvim_get_current_buf()
  if not M.has_client(bufnr) then
    vim.notify("Terreno: no LSP client attached", vim.log.levels.WARN)
    callback({})
    return
  end

  local params = { query = query }

  vim.lsp.buf_request(bufnr, "workspace/symbol", params, function(err, result)
    if err or not result then
      callback({})
      return
    end

    local symbols = {}
    for _, symbol in ipairs(result) do
      local location = symbol.location
      local uri = location and location.uri
      local range = location and location.range

      if uri and range then
        local filepath = vim.uri_to_fname(uri)
        local filename = vim.fn.fnamemodify(filepath, ":t")

        table.insert(symbols, {
          name = symbol.name,
          kind = symbol.kind,
          kind_name = SymbolKindName[symbol.kind] or "Unknown",
          file = filename,
          filepath = filepath,
          line = range.start.line + 1,
          end_line = range["end"].line + 1,
          col = range.start.character + 1,
        })
      end
    end

    callback(symbols)
  end)
end

--- Prepare call hierarchy item at cursor position
---@param bufnr number Buffer number
---@param callback function Callback with (item: table|nil)
M.prepare_call_hierarchy = function(bufnr, callback)
  bufnr = bufnr or 0

  if not M.has_client(bufnr) then
    vim.notify("Terreno: no LSP client attached", vim.log.levels.WARN)
    callback(nil)
    return
  end

  local params = vim.lsp.util.make_position_params()

  vim.lsp.buf_request(bufnr, "textDocument/prepareCallHierarchy", params, function(err, result)
    if err or not result or #result == 0 then
      callback(nil)
      return
    end
    callback(result[1])
  end)
end

--- Get incoming calls (who calls this function)
---@param item table Call hierarchy item
---@param callback function Callback with (calls: table[])
M.get_incoming_calls = function(item, callback)
  local bufnr = vim.api.nvim_get_current_buf()

  vim.lsp.buf_request(bufnr, "callHierarchy/incomingCalls", { item = item }, function(err, result)
    if err or not result then
      callback({})
      return
    end
    callback(result)
  end)
end

--- Get outgoing calls (what functions does this call)
---@param item table Call hierarchy item
---@param callback function Callback with (calls: table[])
M.get_outgoing_calls = function(item, callback)
  local bufnr = vim.api.nvim_get_current_buf()

  vim.lsp.buf_request(bufnr, "callHierarchy/outgoingCalls", { item = item }, function(err, result)
    if err or not result then
      callback({})
      return
    end
    callback(result)
  end)
end

--- Build call graph recursively (outgoing calls)
---@param item table Starting call hierarchy item
---@param depth number Max depth to explore
---@param callback function Callback with (nodes: table[], edges: table[])
M.build_call_graph = function(item, depth, callback)
  local nodes = {}
  local edges = {}
  local visited = {}
  local pending = 0

  local function add_node(call_item, level, parent_id)
    local id = call_item.name .. "_" .. (call_item.range and call_item.range.start.line or 0)

    if visited[id] then
      -- Just add edge if already visited
      if parent_id then
        table.insert(edges, {
          id = "e_" .. parent_id .. "_" .. id,
          source = parent_id,
          target = id,
        })
      end
      return
    end
    visited[id] = true

    local uri = call_item.uri
    local filepath = uri and vim.uri_to_fname(uri) or ""
    local filename = filepath ~= "" and vim.fn.fnamemodify(filepath, ":t") or ""

    table.insert(nodes, {
      id = id,
      data = {
        label = call_item.name,
        file = filename,
        filepath = filepath,
        line = call_item.range and (call_item.range.start.line + 1) or 0,
      },
      position = { x = level * 250, y = #nodes * 80 },
    })

    if parent_id then
      table.insert(edges, {
        id = "e_" .. parent_id .. "_" .. id,
        source = parent_id,
        target = id,
      })
    end

    -- Recurse if not at max depth
    if level < depth then
      pending = pending + 1
      M.get_outgoing_calls(call_item, function(calls)
        for _, call in ipairs(calls) do
          add_node(call.to, level + 1, id)
        end
        pending = pending - 1
        if pending == 0 then
          callback(nodes, edges)
        end
      end)
    end
  end

  add_node(item, 0, nil)

  -- If no async calls were made, callback immediately
  vim.defer_fn(function()
    if pending == 0 then
      callback(nodes, edges)
    end
  end, 100)
end

--- Convert symbols to graph format for React Flow
---@param symbols table[] List of symbols
---@param title string Graph title
---@param base_filepath string|nil Base filepath for document symbols
---@return table graph { nodes: table[], edges: table[] }
M.symbols_to_graph = function(symbols, title, base_filepath)
  local nodes = {}
  local edges = {}

  -- Group symbols by file (for workspace) or kind (for buffer)
  local by_file = {}
  local has_files = false

  for _, sym in ipairs(symbols) do
    local file_key = sym.filepath or sym.file or base_filepath or "unknown"
    if sym.filepath then
      has_files = true
    end
    if not by_file[file_key] then
      by_file[file_key] = {}
    end
    table.insert(by_file[file_key], sym)
  end

  -- Root node
  table.insert(nodes, {
    id = "root",
    type = "input",
    data = { label = title },
    position = { x = 400, y = 0 },
  })

  local file_index = 0
  local y_offset = 100

  for file_path, file_symbols in pairs(by_file) do
    local file_name = vim.fn.fnamemodify(file_path, ":t")
    local file_id = "file_" .. file_index

    -- File node
    table.insert(nodes, {
      id = file_id,
      data = {
        label = file_name,
        filepath = file_path,
        file = file_name,
        line = 1,
      },
      position = { x = 100 + file_index * 350, y = y_offset },
    })

    table.insert(edges, {
      id = "e_root_" .. file_id,
      source = "root",
      target = file_id,
    })

    -- Group symbols by kind within each file
    local by_kind = {}
    for _, sym in ipairs(file_symbols) do
      local kind = sym.kind_name
      if not by_kind[kind] then
        by_kind[kind] = {}
      end
      table.insert(by_kind[kind], sym)
    end

    local kind_index = 0
    for kind, kind_symbols in pairs(by_kind) do
      -- Kind group node
      local kind_id = file_id .. "_kind_" .. kind
      table.insert(nodes, {
        id = kind_id,
        data = { label = kind .. " (" .. #kind_symbols .. ")" },
        position = {
          x = 100 + file_index * 350 + kind_index * 40,
          y = y_offset + 80,
        },
      })

      table.insert(edges, {
        id = "e_" .. file_id .. "_" .. kind_id,
        source = file_id,
        target = kind_id,
      })

      -- Individual symbols
      for i, sym in ipairs(kind_symbols) do
        local sym_id = kind_id .. "_" .. i
        table.insert(nodes, {
          id = sym_id,
          data = {
            label = sym.name,
            line = sym.line,
            end_line = sym.end_line,
            file = file_name,
            filepath = sym.filepath or file_path,
          },
          position = {
            x = 100 + file_index * 350 + kind_index * 40,
            y = y_offset + 160 + (i - 1) * 60,
          },
        })

        table.insert(edges, {
          id = "e_" .. kind_id .. "_" .. sym_id,
          source = kind_id,
          target = sym_id,
        })
      end

      kind_index = kind_index + 1
    end

    file_index = file_index + 1
  end

  return { nodes = nodes, edges = edges }
end

return M
