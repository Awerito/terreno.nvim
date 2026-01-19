# terreno.nvim

Visualize your codebase structure in the browser. Navigate code relationships interactively.

## Features

- **File graph visualization** - See how files connect via imports
- **Symbol exploration** - Expand files to see functions, classes, variables
- **Bidirectional navigation** - Click nodes to jump to code in Neovim
- **LSP-powered** - Uses your existing LSP for accurate symbol detection

## Requirements

- Neovim 0.9+
- Node.js 18+
- LSP configured for your language

## Installation

### lazy.nvim

```lua
{
  "Awerito/terreno.nvim",
  build = ":call terreno#util#install()",
  config = function()
    require("terreno").setup()
  end,
}
```

## Usage

```vim
:Terreno workspace       " Visualize workspace file structure
:Terreno buffer          " Visualize current buffer symbols
:Terreno calls           " Visualize call hierarchy from cursor
```

## How it works

1. Plugin starts a local Node.js server on a random port
2. Opens browser with React-based graph visualization
3. Neovim sends LSP data to server via HTTP
4. Server pushes updates to browser via WebSocket
5. Clicking nodes sends navigation commands back to Neovim

## Inspiration

- [Nogic](https://nogic.app/) - Visual codebase exploration
- [markdown-preview.nvim](https://github.com/iamcco/markdown-preview.nvim) - Server lifecycle pattern
- [nvim-plugin-template](https://github.com/ellisonleao/nvim-plugin-template) - Plugin structure
