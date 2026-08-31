"""Exercise the patched upstream Scrape tool through real FastMCP sampling without desktop access."""

import asyncio
import importlib.util
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace

from fastmcp import Client, FastMCP

# Embedded Python's isolated path omits the script directory.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from source import INPUTS, ROOT, install_source, prepared_source


TOKEN_KEY = "deepseek-harness/sampling-token"
RAW = "Menu | Cookie banner | The ticket costs 42 yuan. | Footer"


class DesktopFixture:
    """Replace only the external webpage and desktop state retrieval."""

    def __init__(self):
        self.dom = SimpleNamespace(vertical_scroll_percent=100)

    def scrape(self, url):
        assert url == "https://example.com/tickets"
        return RAW

    def get_state(self, *, use_vision, use_dom):
        assert use_vision is False and use_dom is True
        return SimpleNamespace(tree_state=SimpleNamespace(
            dom_node=self.dom,
            dom_informative_nodes=[SimpleNamespace(text="The ticket costs 42 yuan.")],
        ))


async def smoke(module):
    """Verify summary focus, call correlation, DOM selection, opt-out, and raw fallback."""
    desktop = DesktopFixture()
    server = FastMCP("windows-mcp-sampling-smoke")
    module.register(server, get_desktop=lambda: desktop, get_analytics=lambda: None)
    requests = []
    fail_sampling = False

    async def sample(messages, params, _context):
        requests.append(params)
        assert params.metadata == {TOKEN_KEY: "active-tool-token"}
        assert params.maxTokens == 2048
        assert "Focus specifically on: ticket price." in params.systemPrompt
        assert "Raw scraped content from https://example.com/tickets:" in messages[0].content.text
        if fail_sampling:
            raise RuntimeError("model unavailable")
        return "42 yuan"

    arguments = {"url": "https://example.com/tickets", "query": "ticket price"}
    async with Client(server, sampling_handler=sample) as client:
        async def call(**overrides):
            result = await client.call_tool("Scrape", arguments | overrides, meta={TOKEN_KEY: "active-tool-token"})
            assert not result.is_error
            return result.content[0].text

        assert await call() == "URL: https://example.com/tickets\nContent:\n42 yuan"
        assert len(requests) == 1
        assert RAW in requests[0].messages[0].content.text
        for opt_out in [False, "false"]:
            assert (await call(use_sampling=opt_out)).endswith(RAW)
        assert len(requests) == 1
        assert (await call(use_dom="true")).endswith("42 yuan")
        assert "Scroll up to see more\nThe ticket costs 42 yuan.\nReached bottom" in requests[-1].messages[0].content.text
        desktop.dom = None
        assert (await call(use_dom=True)).startswith("No DOM information found.")
        assert len(requests) == 2
        fail_sampling = True
        assert (await call()).endswith(RAW)
        assert len(requests) == 3

    async with Client(server) as client:
        result = await client.call_tool("Scrape", arguments)
        assert result.content[0].text.endswith(RAW)


def main():
    """Import the verified source without importing Windows-only tool registrations."""
    metadata = json.loads((INPUTS / "runtime.json").read_text(encoding="utf-8"))
    with TemporaryDirectory(prefix="windows-mcp-sampling-") as directory:
        install_source(Path(directory), prepared_source(ROOT, metadata))
        sys.path.insert(0, directory)
        spec = importlib.util.spec_from_file_location(
            "scrape_under_test", Path(directory) / "windows_mcp/tools/scrape.py",
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        asyncio.run(smoke(module))
    print("Windows-MCP Scrape sampling, DOM, opt-out, and fallback verified")


if __name__ == "__main__":
    main()
