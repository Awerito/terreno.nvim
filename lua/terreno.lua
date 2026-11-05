local lsp = require("terreno.lsp")

local M = {}

-- Neovim server socket path for bidirectional communication
M.server_name = nil

-- Server process management
M.server_job = nil
M.server_port = nil

--- Get the plugin's root directory (where /app is located)
local function get_plugin_root()
    local source = debug.getinfo(1, "S").source:sub(2)
    local plugin_lua = vim.fn.fnamemodify(source, ":p:h")
    return vim.fn.fnamemodify(plugin_lua, ":h")
end

--- Start the Terreno server and get its port
---@param callback function Called with port number when server is ready
M.start_server = function(callback)
    if M.server_job then
        -- Server already running
        if M.server_port then
            callback(M.server_port)
        end
        return
    end

    local app_dir = get_plugin_root() .. "/app"
    local server_script = app_dir .. "/server.js"

    if vim.fn.filereadable(server_script) == 0 then
        vim.notify("Terreno: server.js not found at " .. server_script, vim.log.levels.ERROR)
        return
    end

    M.server_job = vim.fn.jobstart({ "node", "server.js" }, {
        cwd = app_dir,
        on_stdout = function(_, data)
            for _, line in ipairs(data) do
                local port = line:match("TERRENO_PORT=(%d+)")
                if port then
                    M.server_port = tonumber(port)
                    vim.schedule(function()
                        callback(M.server_port)
                    end)
                end
            end
        end,
        on_stderr = function(_, data)
            for _, line in ipairs(data) do
                if line and line ~= "" then
                    vim.schedule(function()
                        vim.notify("Terreno server: " .. line, vim.log.levels.WARN)
                    end)
                end
            end
        end,
        on_exit = function(_, code)
            M.server_job = nil
            M.server_port = nil
            if code ~= 0 then
                vim.schedule(function()
                    vim.notify("Terreno: server exited with code " .. code, vim.log.levels.WARN)
                end)
            end
        end,
    })
end

--- Stop the Terreno server
M.stop_server = function()
    if M.server_job then
        vim.fn.jobstop(M.server_job)
        M.server_job = nil
        M.server_port = nil
    end
end

--- Open browser at the given URL
---@param port number Server port
M.open_browser = function(port)
    local url = "http://localhost:" .. port
    local cmd = vim.fn.has("mac") == 1 and "open" or "xdg-open"
    vim.fn.jobstart({ cmd, url }, { detach = true })
end

M.setup = function()
    -- Cleanup server on Neovim exit
    vim.api.nvim_create_autocmd("VimLeavePre", {
        callback = M.stop_server,
    })
end

--- POST a table as JSON to the Terreno server
---@param path string API path, e.g. "/api/graph"
---@param body table
---@param on_done function|nil Called with curl's exit code
M.post = function(path, body, on_done)
    if not M.server_port then
        vim.notify("Terreno: server not running", vim.log.levels.ERROR)
        return
    end

    -- Body goes through a temp file to avoid "argument list too long"
    local tmp = vim.fn.tempname()
    vim.fn.writefile({ vim.fn.json_encode(body) }, tmp)

    vim.fn.jobstart({
        "curl",
        "-s",
        "-X",
        "POST",
        "-H",
        "Content-Type: application/json",
        "-d",
        "@" .. tmp,
        "http://127.0.0.1:" .. M.server_port .. path,
    }, {
        on_exit = function(_, code)
            os.remove(tmp)
            if on_done then
                vim.schedule(function()
                    on_done(code)
                end)
            end
        end,
    })
end

--- Register Neovim socket with the Terreno server
---@param callback function|nil Called when registration completes
M.register_socket = function(callback)
    M.post("/api/register", { socket = M.server_name, cwd = vim.fn.getcwd() }, function(code)
        if code == 0 then
            vim.notify("Terreno: connected to server", vim.log.levels.INFO)
            if callback then
                callback()
            end
        end
    end)
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

--- Send a graph to the server
---@param graph table { nodes: table[], edges: table[] }
M.send_graph = function(graph)
    M.post("/api/graph", graph, function(code)
        if code == 0 then
            vim.notify("Terreno: graph sent", vim.log.levels.INFO)
        else
            vim.notify("Terreno: failed to send graph", vim.log.levels.ERROR)
        end
    end)
end

--- Send the file graph of the current buffer and its imports
M.send_workspace = function()
    lsp.build_file_graph(function(graph)
        if #graph.nodes == 0 then
            vim.notify("Terreno: no files found", vim.log.levels.WARN)
            return
        end

        M.send_graph(graph)
    end)
end

return M
