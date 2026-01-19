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
---@param bufnr number|nil Buffer number (optional, uses item.uri if not provided)
---@param callback function Callback with (calls: table[])
M.get_outgoing_calls = function(item, bufnr, callback)
  -- Support old signature (item, callback)
  if type(bufnr) == "function" then
    callback = bufnr
    bufnr = nil
  end

  -- Get buffer from item uri if not provided
  if not bufnr and item.uri then
    local filepath = vim.uri_to_fname(item.uri)
    bufnr = vim.fn.bufadd(filepath)
    vim.fn.bufload(bufnr)
  end

  bufnr = bufnr or vim.api.nvim_get_current_buf()

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

--- Build workspace-wide call graph
---@param query string Search query for workspace symbols
---@param callback function Callback with (graph: table)
-- Debug log to file
local function debug_log(msg)
  local f = io.open("/tmp/terreno_debug.log", "a")
  if f then
    f:write(os.date("%H:%M:%S ") .. msg .. "\n")
    f:close()
  end
end

M.build_workspace_call_graph = function(query, callback)
  -- Clear debug log
  os.remove("/tmp/terreno_debug.log")
  debug_log("Starting build_workspace_call_graph")

  local cwd = vim.fn.getcwd()

  M.get_workspace_symbols(query or "", function(symbols)
    -- Filter to only functions and methods
    local functions = {}
    for _, sym in ipairs(symbols) do
      if sym.kind == 6 or sym.kind == 12 then -- Method = 6, Function = 12
        table.insert(functions, sym)
      end
    end

    if #functions == 0 then
      callback({ nodes = {}, edges = {} })
      return
    end

    local nodes = {}
    local edges = {}
    local node_map = {} -- id -> true (tracks existing nodes)
    local queue = {} -- functions to process
    local processed_ids = {} -- already processed

    -- Helper to add a node
    local function add_node(func_data)
      local id = func_data.filepath .. ":" .. func_data.line
      if node_map[id] then
        return id
      end

      local rel_path = func_data.filepath
      if func_data.filepath:sub(1, #cwd) == cwd then
        rel_path = func_data.filepath:sub(#cwd + 2)
      end

      node_map[id] = true
      table.insert(nodes, {
        id = id,
        data = {
          label = func_data.name,
          filepath = func_data.filepath,
          file = vim.fn.fnamemodify(func_data.filepath, ":t"),
          path = rel_path,
          line = func_data.line,
          end_line = func_data.end_line,
          kind = func_data.kind_name or "Function",
        },
        position = { x = (#nodes % 10) * 200, y = math.floor(#nodes / 10) * 100 },
      })
      return id
    end

    -- Add initial functions and queue them
    for _, func in ipairs(functions) do
      add_node(func)
      table.insert(queue, func)
    end

    vim.notify("Terreno: analyzing " .. #queue .. " functions (recursive)...", vim.log.levels.INFO)

    -- Process queue recursively
    local function process_next()
      if #queue == 0 then
        vim.notify("Terreno: found " .. #nodes .. " functions, " .. #edges .. " calls", vim.log.levels.INFO)
        callback({ nodes = nodes, edges = edges })
        return
      end

      local func = table.remove(queue, 1)
      local source_id = func.filepath .. ":" .. func.line

      -- Skip if already processed
      if processed_ids[source_id] then
        vim.defer_fn(process_next, 1)
        return
      end
      processed_ids[source_id] = true

      local bufnr = vim.fn.bufadd(func.filepath)
      vim.fn.bufload(bufnr)

      local params = {
        textDocument = { uri = vim.uri_from_fname(func.filepath) },
        position = { line = func.line - 1, character = (func.col or 5) - 1 },
      }

      vim.lsp.buf_request(bufnr, "textDocument/prepareCallHierarchy", params, function(err, result)
        if err or not result or #result == 0 then
          debug_log(string.format("PrepareCallHierarchy FAILED for %s", func.name))
          vim.defer_fn(process_next, 1)
          return
        end

        local item = result[1]
        debug_log(string.format("PrepareCallHierarchy OK: %s", item.name))

        M.get_outgoing_calls(item, function(calls)
          debug_log(string.format("OutgoingCalls for %s: %d calls", item.name, #calls))

          for _, call in ipairs(calls) do
            local target_name = call.to.name
            local target_uri = call.to.uri
            local target_line = call.to.range and (call.to.range.start.line + 1) or 0
            local target_col = call.to.range and (call.to.range.start.character + 1) or 5
            local target_filepath = vim.uri_to_fname(target_uri)
            local target_id = target_filepath .. ":" .. target_line

            debug_log(string.format("Call: %s -> %s (%s:%d)", func.name, target_name, target_filepath, target_line))

            -- Only include calls to files in our project
            if target_filepath:sub(1, #cwd) == cwd then
              -- Add node if not exists
              if not node_map[target_id] then
                add_node({
                  name = target_name,
                  filepath = target_filepath,
                  line = target_line,
                  col = target_col,
                  kind_name = "Function",
                })
                -- Queue for processing
                table.insert(queue, {
                  name = target_name,
                  filepath = target_filepath,
                  line = target_line,
                  col = target_col,
                })
                debug_log(string.format("Added to queue: %s", target_name))
              end

              -- Add edge
              if target_id ~= source_id then
                table.insert(edges, {
                  id = "e_" .. #edges,
                  source = source_id,
                  target = target_id,
                  animated = true,
                })
              end
            end
          end

          -- Progress update
          local total_processed = 0
          for _ in pairs(processed_ids) do total_processed = total_processed + 1 end
          if total_processed % 10 == 0 then
            vim.notify("Terreno: processed " .. total_processed .. ", queue: " .. #queue, vim.log.levels.INFO)
          end

          vim.defer_fn(process_next, 1)
        end)
      end)
    end

    process_next()
  end)
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

  -- Get cwd to make paths relative
  local cwd = vim.fn.getcwd()

  local file_index = 0
  local y_offset = 100

  for file_path, file_symbols in pairs(by_file) do
    local file_name = vim.fn.fnamemodify(file_path, ":t")
    -- Make path relative to cwd for display
    local rel_path = file_path
    if file_path:sub(1, #cwd) == cwd then
      rel_path = file_path:sub(#cwd + 2) -- +2 to skip the trailing /
    end
    -- Use parent folder + filename for label (e.g., "email_group/models.py")
    local label = vim.fn.fnamemodify(file_path, ":h:t") .. "/" .. file_name
    local file_id = "file_" .. file_index

    -- File node
    table.insert(nodes, {
      id = file_id,
      data = {
        label = label,
        filepath = file_path,
        file = file_name,
        path = rel_path,
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
