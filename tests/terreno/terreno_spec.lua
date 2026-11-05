local terreno = require("terreno")

describe("terreno", function()
    it("has server functions", function()
        assert.is_function(terreno.start_server)
        assert.is_function(terreno.stop_server)
        assert.is_function(terreno.open_browser)
    end)
end)
