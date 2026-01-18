if vim.g.loaded_terreno then
  return
end
vim.g.loaded_terreno = true

local subcommands = {
  buffer = function()
    require("terreno").send_buffer()
  end,
  workspace = function(query)
    require("terreno").send_workspace(query)
  end,
}

vim.api.nvim_create_user_command("Terreno", function(opts)
  local args = vim.split(opts.args, "%s+", { trimempty = true })
  local subcmd = args[1]

  if not subcmd then
    vim.notify("Terreno: subcommand required (buffer, workspace)", vim.log.levels.WARN)
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
