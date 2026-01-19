local M = {}

-- Supported file extensions and their filetypes
local extensions = {
	[".lua"] = "lua",
	[".py"] = "python",
	[".js"] = "javascript",
	[".ts"] = "typescript",
	[".jsx"] = "javascript",
	[".tsx"] = "typescript",
}

-- Import queries by language
local import_queries = {
	python = [[
    (import_statement
      name: (dotted_name) @import)
    (import_from_statement
      module_name: (dotted_name) @import)
  ]],
	javascript = [[
    (import_statement
      source: (string) @import)
    (call_expression
      function: (identifier) @fn (#eq? @fn "require")
      arguments: (arguments (string) @import))
  ]],
	typescript = [[
    (import_statement
      source: (string) @import)
    (call_expression
      function: (identifier) @fn (#eq? @fn "require")
      arguments: (arguments (string) @import))
  ]],
	lua = [[
    (function_call
      name: (identifier) @fn (#eq? @fn "require")
      arguments: (arguments (string) @import))
  ]],
}

--- Get all project files with supported extensions
---@param dir string Directory to scan
---@return table[] files List of {path, filetype}
M.get_project_files = function(dir)
	local files = {}

	local handle = vim.loop.fs_scandir(dir)
	if not handle then
		return files
	end

	while true do
		local name, type = vim.loop.fs_scandir_next(handle)
		if not name then
			break
		end

		local path = dir .. "/" .. name

		if type == "directory" then
			-- Skip common non-source directories
			if
				not name:match("^%.")
				and name ~= "node_modules"
				and name ~= "__pycache__"
				and name ~= "venv"
				and name ~= ".git"
			then
				local subfiles = M.get_project_files(path)
				for _, f in ipairs(subfiles) do
					table.insert(files, f)
				end
			end
		elseif type == "file" then
			for ext, ft in pairs(extensions) do
				if name:sub(-#ext) == ext then
					table.insert(files, { path = path, filetype = ft, name = name })
					break
				end
			end
		end
	end

	return files
end

--- Extract imports from a file
---@param filepath string Path to file
---@param filetype string Filetype
---@return string[] imports List of import strings
M.get_imports = function(filepath, filetype)
	local imports = {}

	local query_str = import_queries[filetype]
	if not query_str then
		return imports
	end

	-- Read file content
	local file = io.open(filepath, "r")
	if not file then
		return imports
	end
	local content = file:read("*all")
	file:close()

	-- Parse with tree-sitter
	local ok, parser = pcall(vim.treesitter.get_string_parser, content, filetype)
	if not ok then
		return imports
	end

	local tree = parser:parse()[1]
	if not tree then
		return imports
	end

	local root = tree:root()
	local query = vim.treesitter.query.parse(filetype, query_str)

	for id, node, _ in query:iter_captures(root, content, 0, -1) do
		local name = query.captures[id]
		if name == "import" then
			local text = vim.treesitter.get_node_text(node, content)
			-- Clean up quotes from string literals
			text = text:gsub("^['\"]", ""):gsub("['\"]$", "")
			table.insert(imports, text)
		end
	end

	return imports
end

--- Scan project and build dependency graph
---@param dir string|nil Directory to scan (nil = cwd)
---@return table graph { nodes: table[], edges: table[] }
M.scan_project = function(dir)
	dir = dir or vim.fn.getcwd()

	local files = M.get_project_files(dir)
	local nodes = {}
	local edges = {}
	local file_map = {} -- Map filename to node id

	-- Create nodes for each file
	local cols = 4
	for i, file in ipairs(files) do
		local id = "file_" .. i
		local col = (i - 1) % cols
		local row = math.floor((i - 1) / cols)

		-- Use relative path from project root
		local rel_path = file.path:gsub("^" .. vim.pesc(dir) .. "/", "")

		table.insert(nodes, {
			id = id,
			data = {
				label = file.name,
				path = rel_path,
				filetype = file.filetype,
			},
			position = {
				x = 50 + col * 200,
				y = 50 + row * 120,
			},
		})

		file_map[file.name] = id
		file_map[rel_path] = id
		-- Also map without extension for module imports
		local name_no_ext = file.name:gsub("%.[^.]+$", "")
		file_map[name_no_ext] = id
	end

	-- Create edges for imports
	local edge_id = 1
	for i, file in ipairs(files) do
		local source_id = "file_" .. i
		local imports = M.get_imports(file.path, file.filetype)

		for _, imp in ipairs(imports) do
			-- Try to match import to a file
			local target_id = file_map[imp]

			-- Try variations
			if not target_id then
				-- Remove leading ./ or ../
				local clean_imp = imp:gsub("^%.+/", "")
				target_id = file_map[clean_imp]
			end

			if not target_id then
				-- Try just the last part (module name)
				local module_name = imp:match("[^/%.]+$")
				if module_name then
					target_id = file_map[module_name]
				end
			end

			if target_id and target_id ~= source_id then
				table.insert(edges, {
					id = "e_" .. edge_id,
					source = source_id,
					target = target_id,
					label = imp,
				})
				edge_id = edge_id + 1
			end
		end
	end

	return { nodes = nodes, edges = edges }
end

return M
