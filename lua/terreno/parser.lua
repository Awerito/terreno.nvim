local M = {}

--- Extract functions from current buffer using tree-sitter
---@param bufnr number|nil Buffer number (nil = current)
---@return table[] functions List of found functions
M.get_functions = function(bufnr)
	bufnr = bufnr or 0
	local ft = vim.bo[bufnr].filetype
	local functions = {}

	-- Check that tree-sitter is available for this filetype
	local ok, parser = pcall(vim.treesitter.get_parser, bufnr)
	if not ok then
		vim.notify("Terreno: no tree-sitter parser for " .. ft, vim.log.levels.WARN)
		return functions
	end

	local tree = parser:parse()[1]
	if not tree then
		return functions
	end

	local root = tree:root()

	-- Queries by language
	local queries = {
		lua = [[
      (function_declaration name: (identifier) @name) @func
      (assignment_statement
        (variable_list (identifier) @name)
        (expression_list (function_definition))) @func
      (field
        name: (identifier) @name
        value: (function_definition)) @func
    ]],
		javascript = [[
      (function_declaration name: (identifier) @name) @func
      (variable_declarator
        name: (identifier) @name
        value: (function_expression)) @func
      (variable_declarator
        name: (identifier) @name
        value: (arrow_function)) @func
    ]],
		typescript = [[
      (function_declaration name: (identifier) @name) @func
      (variable_declarator
        name: (identifier) @name
        value: (function_expression)) @func
      (variable_declarator
        name: (identifier) @name
        value: (arrow_function)) @func
    ]],
		python = [[
      (function_definition name: (identifier) @name) @func
    ]],
	}

	local query_str = queries[ft]
	if not query_str then
		vim.notify("Terreno: no query for " .. ft, vim.log.levels.WARN)
		return functions
	end

	local query = vim.treesitter.query.parse(ft, query_str)

	for id, node, _ in query:iter_captures(root, bufnr, 0, -1) do
		local name = query.captures[id]
		if name == "name" then
			local text = vim.treesitter.get_node_text(node, bufnr)
			local row, col = node:range()
			table.insert(functions, {
				name = text,
				line = row + 1,
				col = col + 1,
			})
		end
	end

	return functions
end

--- Convert functions to graph format for React Flow
---@param functions table[] List of functions
---@param filename string Filename
---@return table graph { nodes: table[], edges: table[] }
M.functions_to_graph = function(functions, filename)
	local nodes = {}
	local edges = {}

	-- Root node with filename
	table.insert(nodes, {
		id = "file",
		type = "input",
		data = { label = filename },
		position = { x = 250, y = 0 },
	})

	-- Add nodes for each function
	local cols = 3
	for i, func in ipairs(functions) do
		local id = "func_" .. i
		local col = (i - 1) % cols
		local row = math.floor((i - 1) / cols)

		table.insert(nodes, {
			id = id,
			data = { label = func.name .. "()" },
			position = {
				x = 100 + col * 200,
				y = 100 + row * 100,
			},
		})

		-- Edge from file to function
		table.insert(edges, {
			id = "e_file_" .. id,
			source = "file",
			target = id,
		})
	end

	return { nodes = nodes, edges = edges }
end

return M
