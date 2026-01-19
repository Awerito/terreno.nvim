-- Reload terreno plugin for development
vim.opt.rtp:prepend(vim.fn.expand("~/Git/terreno.nvim"))
package.loaded["terreno.lsp"] = nil
package.loaded["terreno"] = nil
dofile(vim.fn.expand("~/Git/terreno.nvim/plugin/terreno.lua"))
require("terreno").setup()
vim.cmd("Terreno workspace")
