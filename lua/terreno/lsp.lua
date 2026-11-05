local M = {}

local SymbolKind = vim.lsp.protocol.SymbolKind

local function post(path, body)
    require("terreno").post(path, body)
end

--- Flatten nested document symbols into a flat list
---@param symbols table[] Raw LSP symbols
---@return table[] Flattened symbols
M.flatten_symbols = function(symbols)
    local result = {}

    for _, symbol in ipairs(symbols or {}) do
        local name = symbol.name
        local range = symbol.range or (symbol.location and symbol.location.range)

        -- Skip dunder methods (__init__, __enter__, etc.) - not useful for call graphs
        local is_dunder = name and name:match("^__") and name:match("__$")
        -- Skip anonymous callbacks (useEffect() callback, map() callback, etc.)
        local is_callback = name and (name:match("%) callback$") or name:match("^callback$"))

        if name and range and not is_dunder and not is_callback then
            local sel_range = symbol.selectionRange or range

            table.insert(result, {
                name = name,
                kind = SymbolKind[symbol.kind] or "Unknown",
                line = sel_range.start.line + 1,
                end_line = range["end"].line + 1,
            })

            for _, child in ipairs(M.flatten_symbols(symbol.children)) do
                table.insert(result, child)
            end
        end
    end

    return result
end

--- Check if a filepath is a project file (not a dependency)
---@param filepath string
---@param cwd string
---@return boolean
local function is_project_file(filepath, cwd)
    if filepath:sub(1, #cwd) ~= cwd then
        return false
    end

    -- Exclude dependency/generated directories
    if
        filepath:match("/node_modules/")
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
        or filepath:match("/target/") -- Rust
        or filepath:match("/vendor/") -- Go
    then
        return false
    end

    return true
end

--- Follow imports using LSP definition (language agnostic)
---@param bufnr number Buffer number
---@param cwd string Current working directory
---@param callback function Callback with (filepaths: table)
local function follow_imports_via_lsp(bufnr, cwd, callback)
    local lines = vim.api.nvim_buf_get_lines(bufnr, 0, 100, false) -- First 100 lines
    local found_files = {}
    local seen = {}
    local pending = 0
    local started = false

    local function finish()
        if started and pending == 0 then
            callback(found_files)
        end
    end

    -- For each line in the import section, try to find definitions
    for lnum, line in ipairs(lines) do
        local is_skip_line = line:match("^%s*$") or line:match("^%s*#") or line:match("^%s*//") or line:match("^%s*%-%-")

        if not is_skip_line then
            -- Find identifiers on this line (words that could be imports)
            for col, word in line:gmatch("()([%w_]+)") do
                local is_keyword = word == "from"
                    or word == "import"
                    or word == "as"
                    or word == "require"
                    or word == "use"
                    or word == "const"
                    or word == "let"
                    or word == "var"

                if not is_keyword then
                    pending = pending + 1
                    local params = {
                        textDocument = { uri = vim.uri_from_fname(vim.api.nvim_buf_get_name(bufnr)) },
                        position = { line = lnum - 1, character = col - 1 },
                    }

                    vim.lsp.buf_request(bufnr, "textDocument/definition", params, function(err, result)
                        pending = pending - 1

                        if not err and result then
                            local defs = vim.islist(result) and result or { result }
                            for _, def in ipairs(defs) do
                                local uri = def.uri or def.targetUri
                                if uri then
                                    local def_path = vim.uri_to_fname(uri)
                                    if is_project_file(def_path, cwd) and not seen[def_path] then
                                        seen[def_path] = true
                                        table.insert(found_files, def_path)
                                    end
                                end
                            end
                        end

                        finish()
                    end)
                end
            end
        end
    end

    started = true
    if pending == 0 then
        callback(found_files)
    end
end

--- Get all symbols from a file via LSP documentSymbol
---@param filepath string
---@param callback function Callback with (symbols: table[])
local function get_file_symbols(filepath, callback)
    local bufnr = vim.fn.bufadd(filepath)
    vim.fn.bufload(bufnr)

    -- Give the LSP client time to attach to the new buffer
    vim.defer_fn(function()
        if #vim.lsp.get_clients({ bufnr = bufnr }) == 0 then
            callback({})
            return
        end

        local params = { textDocument = { uri = vim.uri_from_fname(filepath) } }

        vim.lsp.buf_request(bufnr, "textDocument/documentSymbol", params, function(err, result)
            if err or not result then
                callback({})
                return
            end
            callback(M.flatten_symbols(result))
        end)
    end, 50)
end

--- Build a React Flow file node
---@param file string Absolute path
---@param cwd string
---@param symbols table[]
---@return table
local function file_node(file, cwd, symbols)
    local rel_path = file
    if file:sub(1, #cwd) == cwd then
        rel_path = file:sub(#cwd + 2)
    end

    return {
        id = file,
        type = "file",
        data = {
            filepath = file,
            filename = vim.fn.fnamemodify(file, ":t"),
            path = rel_path,
            symbols = symbols,
        },
    }
end

--- Build file nodes for a list of files, skipping files with no symbols
---@param files string[]
---@param cwd string
---@param callback function Callback with (nodes: table[])
local function file_nodes(files, cwd, callback)
    local nodes = {}
    local pending = #files

    if pending == 0 then
        callback(nodes)
        return
    end

    for _, file in ipairs(files) do
        get_file_symbols(file, function(symbols)
            pending = pending - 1
            -- Skip files with no symbols (empty files like __init__.py)
            if #symbols > 0 then
                table.insert(nodes, file_node(file, cwd, symbols))
            end
            if pending == 0 then
                callback(nodes)
            end
        end)
    end
end

--- Build file graph from the current buffer and the files it imports
---@param callback function Callback with (graph: table)
M.build_file_graph = function(callback)
    local cwd = vim.fn.getcwd()
    local bufnr = vim.api.nvim_get_current_buf()
    local filepath = vim.api.nvim_buf_get_name(bufnr)

    if #vim.lsp.get_clients({ bufnr = bufnr }) == 0 then
        vim.notify("Terreno: no LSP attached to current buffer", vim.log.levels.WARN)
        callback({ nodes = {}, edges = {} })
        return
    end

    follow_imports_via_lsp(bufnr, cwd, function(imported_files)
        local all_files = { filepath }
        for _, f in ipairs(imported_files) do
            if f ~= filepath then
                table.insert(all_files, f)
            end
        end

        file_nodes(all_files, cwd, function(nodes)
            local edges = {}
            for _, node in ipairs(nodes) do
                if node.id ~= filepath then
                    table.insert(edges, {
                        id = "e_" .. filepath .. "_" .. node.id,
                        source = filepath,
                        target = node.id,
                    })
                end
            end
            callback({ nodes = nodes, edges = edges })
        end)
    end)
end

--- Find project files referencing the symbol at a line (called by server via RPC)
---@param filepath string
---@param line number
---@param request_id string
M.find_references = function(filepath, line, request_id)
    local cwd = vim.fn.getcwd()
    local bufnr = vim.fn.bufadd(filepath)
    vim.fn.bufload(bufnr)

    vim.defer_fn(function()
        if #vim.lsp.get_clients({ bufnr = bufnr }) == 0 then
            post("/api/expand-result", { request_id = request_id, files = {} })
            return
        end

        local params = {
            textDocument = { uri = vim.uri_from_fname(filepath) },
            position = { line = line - 1, character = 5 },
            context = { includeDeclaration = true },
        }

        vim.lsp.buf_request(bufnr, "textDocument/references", params, function(err, result)
            local files = {}
            local seen = {}

            for _, ref in ipairs((not err and result) or {}) do
                if ref.uri then
                    local ref_path = vim.uri_to_fname(ref.uri)
                    if is_project_file(ref_path, cwd) and not seen[ref_path] then
                        seen[ref_path] = true
                        table.insert(files, ref_path)
                    end
                end
            end

            post("/api/expand-result", { request_id = request_id, files = files })
        end)
    end, 50)
end

--- Expand a file's imports into file nodes (called by server via RPC)
---@param filepath string
---@param request_id string
M.expand_file_imports = function(filepath, request_id)
    local cwd = vim.fn.getcwd()
    local bufnr = vim.fn.bufadd(filepath)
    vim.fn.bufload(bufnr)

    vim.defer_fn(function()
        if #vim.lsp.get_clients({ bufnr = bufnr }) == 0 then
            post("/api/expand-result", { request_id = request_id, nodes = {}, edges = {} })
            return
        end

        follow_imports_via_lsp(bufnr, cwd, function(imported_files)
            file_nodes(imported_files, cwd, function(nodes)
                post("/api/expand-result", { request_id = request_id, nodes = nodes, edges = {} })
            end)
        end)
    end, 100)
end

return M
