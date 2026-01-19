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
      -- Use selectionRange for the name position (for prepareCallHierarchy)
      -- Fall back to range if selectionRange not available
      local sel_range = symbol.selectionRange or range

      table.insert(result, {
        name = full_name,
        kind = kind,
        kind_name = SymbolKindName[kind] or "Unknown",
        line = sel_range.start.line + 1,
        end_line = range["end"].line + 1,
        col = sel_range.start.character + 1,
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
-- Debug logging
local DEBUG = true
local DEBUG_FILE = "/tmp/terreno_debug.log"

local function debug_log(msg)
  if not DEBUG then return end
  local f = io.open(DEBUG_FILE, "a")
  if f then
    f:write(os.date("%H:%M:%S ") .. msg .. "\n")
    f:close()
  end
end

local function debug_clear()
  if not DEBUG then return end
  local f = io.open(DEBUG_FILE, "w")
  if f then
    f:write("=== Terreno Debug Log ===\n")
    f:close()
  end
end

--- Check if a filepath is a project file (not a dependency)
---@param filepath string
---@param cwd string
---@return boolean
local function is_project_file(filepath, cwd)
  -- Must be inside cwd
  if filepath:sub(1, #cwd) ~= cwd then
    return false
  end

  -- Exclude dependency/generated directories
  if filepath:match("/node_modules/")
      or filepath:match("/%.git/")
      or filepath:match("/env/")
      or filepath:match("/venv/")
      or filepath:match("/%.venv/")
      or filepath:match("/__pycache__/")
      or filepath:match("/site%-packages/")
      or filepath:match("/dist/")
      or filepath:match("/build/")
      or filepath:match("/%.tox/")
      or filepath:match("/%.eggs/")
      or filepath:match("/%.mypy_cache/")
      or filepath:match("/target/")  -- Rust
      or filepath:match("/vendor/")  -- Go
  then
    return false
  end

  return true
end

--- Get all project files (Python, JS, TS, Lua, etc.)
local function get_project_files()
  local cwd = vim.fn.getcwd()
  local extensions = { "py", "js", "ts", "jsx", "tsx", "lua", "go", "rs", "rb" }
  local pattern = "*.{" .. table.concat(extensions, ",") .. "}"

  local files = vim.fn.globpath(cwd, "**/" .. pattern, false, true)
  local filtered = {}
  for _, file in ipairs(files) do
    if is_project_file(file, cwd) then
      table.insert(filtered, file)
    end
  end
  return filtered
end

--- Get all functions from LOADED buffers with LSP (files user has opened)
---@param callback function Callback with (functions: table[])
M.get_all_project_functions = function(callback)
  local cwd = vim.fn.getcwd()
  local all_functions = {}

  -- Get all loaded buffers with LSP attached
  local buffers = vim.api.nvim_list_bufs()
  local valid_buffers = {}

  for _, bufnr in ipairs(buffers) do
    if vim.api.nvim_buf_is_loaded(bufnr) then
      local filepath = vim.api.nvim_buf_get_name(bufnr)
      -- Only include files in project and with LSP
      if filepath:sub(1, #cwd) == cwd then
        local clients = vim.lsp.get_clients({ bufnr = bufnr })
        if #clients > 0 then
          table.insert(valid_buffers, { bufnr = bufnr, filepath = filepath })
        end
      end
    end
  end

  debug_log("found " .. #valid_buffers .. " loaded buffers with LSP")

  if #valid_buffers == 0 then
    vim.notify("Terreno: no files with LSP open. Open some files first or use :Terreno workspace <query>", vim.log.levels.WARN)
    callback({})
    return
  end

  local pending = #valid_buffers

  for _, buf in ipairs(valid_buffers) do
    local bufnr = buf.bufnr
    local filepath = buf.filepath

    local params = { textDocument = vim.lsp.util.make_text_document_params(bufnr) }

    vim.lsp.buf_request(bufnr, "textDocument/documentSymbol", params, function(err, result)
      if not err and result then
        local symbols = M.flatten_symbols(result, bufnr)
        for _, sym in ipairs(symbols) do
          if sym.kind == 6 or sym.kind == 12 then -- Method = 6, Function = 12
            local rel_path = filepath
            if filepath:sub(1, #cwd) == cwd then
              rel_path = filepath:sub(#cwd + 2)
            end
            table.insert(all_functions, {
              name = sym.name,
              kind = sym.kind,
              kind_name = sym.kind_name,
              file = vim.fn.fnamemodify(filepath, ":t"),
              filepath = filepath,
              path = rel_path,
              line = sym.line,
              end_line = sym.end_line,
              col = sym.col,
            })
          end
        end
      end

      pending = pending - 1
      if pending == 0 then
        debug_log("total functions found: " .. #all_functions)
        callback(all_functions)
      end
    end)
  end
end

M.build_workspace_call_graph = function(query, callback)
  debug_clear()
  debug_log("build_workspace_call_graph started, query: " .. (query or "nil"))
  local cwd = vim.fn.getcwd()
  debug_log("cwd: " .. cwd)

  -- If no query, use documentSymbol on all project files
  -- If query provided, use workspace/symbol
  local get_functions = function(cb)
    if not query or query == "" then
      M.get_all_project_functions(cb)
    else
      M.get_workspace_symbols(query, function(symbols)
        local functions = {}
        for _, sym in ipairs(symbols) do
          if sym.kind == 6 or sym.kind == 12 then
            table.insert(functions, sym)
          end
        end
        cb(functions)
      end)
    end
  end

  get_functions(function(functions)
    debug_log("functions found: " .. #functions)

    if #functions == 0 then
      callback({ nodes = {}, edges = {} })
      return
    end

    local nodes = {}
    local edges = {}
    local node_ids = {} -- Map filepath:line -> true for quick lookup

    -- First pass: create all nodes and build lookup
    for i, func in ipairs(functions) do
      local id = func.filepath .. ":" .. func.line
      node_ids[id] = true
      debug_log("node: " .. func.name .. " -> " .. id)

      local rel_path = func.filepath
      if func.filepath:sub(1, #cwd) == cwd then
        rel_path = func.filepath:sub(#cwd + 2)
      end

      table.insert(nodes, {
        id = id,
        data = {
          label = func.name,
          filepath = func.filepath,
          file = vim.fn.fnamemodify(func.filepath, ":t"),
          path = rel_path,
          line = func.line,
          col = func.col,
          end_line = func.end_line,
          kind = func.kind_name or "Function",
          expandable = true,
        },
        position = { x = (i % 5) * 250, y = math.floor(i / 5) * 120 },
      })
    end

    debug_log("created " .. #nodes .. " nodes, starting edge discovery...")

    -- Second pass: find edges between existing nodes
    local pending = #functions
    local edge_set = {} -- Avoid duplicate edges

    vim.notify("Terreno: found " .. #nodes .. " functions, finding connections...", vim.log.levels.INFO)

    for _, func in ipairs(functions) do
      local source_id = func.filepath .. ":" .. func.line
      local bufnr = vim.fn.bufadd(func.filepath)
      vim.fn.bufload(bufnr)

      local params = {
        textDocument = { uri = vim.uri_from_fname(func.filepath) },
        position = { line = func.line - 1, character = (func.col or 5) - 1 },
      }

      debug_log("prepareCallHierarchy for: " .. func.name .. " at " .. func.filepath .. ":" .. func.line)

      vim.lsp.buf_request(bufnr, "textDocument/prepareCallHierarchy", params, function(err, result)
        if err then
          debug_log("  ERROR: " .. vim.inspect(err))
        end

        if not err and result and #result > 0 then
          local item = result[1]
          debug_log("  prepareCallHierarchy OK: " .. item.name)

          M.get_outgoing_calls(item, bufnr, function(calls)
            debug_log("  outgoingCalls returned: " .. #calls)

            for _, call in ipairs(calls) do
              local target_uri = call.to.uri
              local target_line = call.to.range and (call.to.range.start.line + 1) or 0
              local target_filepath = vim.uri_to_fname(target_uri)
              local target_id = target_filepath .. ":" .. target_line

              debug_log("    call to: " .. call.to.name .. " -> " .. target_id)
              debug_log("    in node_ids? " .. tostring(node_ids[target_id] ~= nil))

              -- Only add edge if target is in our node set
              if node_ids[target_id] and target_id ~= source_id then
                local edge_key = source_id .. "->" .. target_id
                if not edge_set[edge_key] then
                  edge_set[edge_key] = true
                  debug_log("    EDGE ADDED: " .. edge_key)
                  table.insert(edges, {
                    id = "e_" .. source_id .. "_" .. target_id,
                    source = source_id,
                    target = target_id,
                  })
                end
              end
            end

            pending = pending - 1
            debug_log("  pending: " .. pending)
            if pending == 0 then
              debug_log("DONE: " .. #nodes .. " nodes, " .. #edges .. " edges")
              vim.notify("Terreno: " .. #nodes .. " functions, " .. #edges .. " connections", vim.log.levels.INFO)
              callback({ nodes = nodes, edges = edges })
            end
          end)
        else
          debug_log("  prepareCallHierarchy EMPTY or nil")
          pending = pending - 1
          debug_log("  pending: " .. pending)
          if pending == 0 then
            debug_log("DONE: " .. #nodes .. " nodes, " .. #edges .. " edges")
            vim.notify("Terreno: " .. #nodes .. " functions, " .. #edges .. " connections", vim.log.levels.INFO)
            callback({ nodes = nodes, edges = edges })
          end
        end
      end)
    end
  end)
end

--- Expand a single node - get its outgoing calls
---@param filepath string
---@param line number
---@param col number
---@param request_id string
M.expand_node = function(filepath, line, col, request_id)
  debug_log("expand_node called: " .. filepath .. ":" .. line .. " col=" .. (col or "nil") .. " request_id=" .. request_id)
  local cwd = vim.fn.getcwd()
  local bufnr = vim.fn.bufadd(filepath)
  vim.fn.bufload(bufnr)
  debug_log("buffer loaded: " .. bufnr)

  local params = {
    textDocument = { uri = vim.uri_from_fname(filepath) },
    position = { line = line - 1, character = (col or 5) - 1 },
  }

  -- Check LSP client
  local clients = vim.lsp.get_clients({ bufnr = bufnr })
  debug_log("LSP clients for buffer: " .. #clients)

  vim.lsp.buf_request(bufnr, "textDocument/prepareCallHierarchy", params, function(err, result)
    local new_nodes = {}
    local new_edges = {}
    local source_id = filepath .. ":" .. line

    if err then
      debug_log("prepareCallHierarchy error: " .. vim.inspect(err))
    end
    debug_log("prepareCallHierarchy result: " .. (result and #result or "nil"))

    if err or not result or #result == 0 then
      -- Send empty result
      M.send_expand_result(request_id, new_nodes, new_edges)
      return
    end

    local item = result[1]
    M.get_outgoing_calls(item, function(calls)
      for _, call in ipairs(calls) do
        local target_name = call.to.name
        local target_uri = call.to.uri
        local target_line = call.to.range and (call.to.range.start.line + 1) or 0
        local target_col = call.to.range and (call.to.range.start.character + 1) or 5
        local target_filepath = vim.uri_to_fname(target_uri)
        local target_id = target_filepath .. ":" .. target_line

        -- Only include calls to project files (not dependencies)
        if is_project_file(target_filepath, cwd) then
          local rel_path = target_filepath:sub(#cwd + 2)

          table.insert(new_nodes, {
            id = target_id,
            data = {
              label = target_name,
              filepath = target_filepath,
              file = vim.fn.fnamemodify(target_filepath, ":t"),
              path = rel_path,
              line = target_line,
              col = target_col,
              kind = "Function",
              expandable = true,
            },
            position = { x = 0, y = 0 }, -- Frontend will position
          })

          if target_id ~= source_id then
            table.insert(new_edges, {
              id = "e_" .. source_id .. "_" .. target_id,
              source = source_id,
              target = target_id,
            })
          end
        end
      end

      M.send_expand_result(request_id, new_nodes, new_edges)
    end)
  end)
end

--- Send expand result to server
M.send_expand_result = function(request_id, nodes, edges)
  debug_log("send_expand_result: " .. request_id .. " nodes=" .. #nodes .. " edges=" .. #edges)
  local url = require("terreno").config.server_url .. ":" .. require("terreno").config.port .. "/api/expand-result"
  local data = vim.fn.json_encode({
    request_id = request_id,
    nodes = nodes,
    edges = edges,
  })

  vim.fn.jobstart({
    "curl", "-s", "-X", "POST",
    "-H", "Content-Type: application/json",
    "-d", data,
    url,
  })
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
