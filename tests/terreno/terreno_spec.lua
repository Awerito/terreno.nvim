local terreno = require("terreno")

describe("terreno", function()
	it("has default config", function()
		assert.is_not_nil(terreno.config)
		assert.equals("http://localhost", terreno.config.server_url)
	end)

	it("setup merges config", function()
		terreno.setup({ server_url = "http://custom" })
		assert.equals("http://custom", terreno.config.server_url)
	end)

	it("has server functions", function()
		assert.is_function(terreno.start_server)
		assert.is_function(terreno.stop_server)
		assert.is_function(terreno.open_browser)
	end)
end)
