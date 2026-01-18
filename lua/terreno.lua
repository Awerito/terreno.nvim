local M = {}

---@class TerrenoConfig
---@field server_url string URL del servidor terreno
---@field port number Puerto del servidor
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

--- Envía un grafo al servidor
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

--- Envía un grafo de prueba
M.send_test = function()
  local test_graph = {
    nodes = {
      { id = "1", type = "input", data = { label = "FROM NEOVIM!" }, position = { x = 250, y = 0 } },
      { id = "2", data = { label = "init.lua" }, position = { x = 250, y = 100 } },
      { id = "3", data = { label = "terreno.setup()" }, position = { x = 100, y = 200 } },
      { id = "4", data = { label = "terreno.open()" }, position = { x = 400, y = 200 } },
      { id = "5", type = "output", data = { label = "visualize!" }, position = { x = 250, y = 300 } },
    },
    edges = {
      { id = "e1-2", source = "1", target = "2" },
      { id = "e2-3", source = "2", target = "3" },
      { id = "e2-4", source = "2", target = "4" },
      { id = "e3-5", source = "3", target = "5" },
      { id = "e4-5", source = "4", target = "5" },
    },
  }
  M.send_graph(test_graph)
end

return M
