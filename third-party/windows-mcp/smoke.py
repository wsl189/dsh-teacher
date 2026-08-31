"""Smoke the exact bundled Windows-MCP stdio surface before packaging."""

import asyncio
import json
import os
from pathlib import Path
import sys

from fastmcp import Client
from fastmcp.client.transports import StdioTransport


EXPECTED_TOOLS = {
    "App",
    "Click",
    "Clipboard",
    "DisplayInventory",
    "FileSystem",
    "Move",
    "MultiEdit",
    "MultiSelect",
    "Notification",
    "PowerShell",
    "Process",
    "Registry",
    "Screenshot",
    "Scrape",
    "Scroll",
    "Shortcut",
    "Snapshot",
    "Type",
    "Wait",
    "WaitFor",
}
SERVER_ARGS = [
    "-m",
    "windows_mcp",
    "serve",
    "--transport",
    "stdio",
    "--tools",
    ",".join(sorted(EXPECTED_TOOLS)),
]
STARTUP_TIMEOUT_SECONDS = 60.0


async def smoke() -> None:
    """Complete MCP initialization, assert discovery, and call the inert Wait tool."""
    environment = os.environ | {
        "ANONYMIZED_TELEMETRY": "false",
        "NO_COLOR": "1",
        "PYTHONIOENCODING": "utf-8",
        "PYTHONUNBUFFERED": "1",
        "WINDOWS_MCP_WATCHDOG": "off",
    }
    transport = StdioTransport(
        command=sys.executable,
        args=SERVER_ARGS,
        env=environment,
    )
    async with Client(transport) as client:
        tools = await asyncio.wait_for(client.list_tools(), STARTUP_TIMEOUT_SECONDS)
        actual = {tool.name for tool in tools}
        if actual != EXPECTED_TOOLS:
            raise RuntimeError(
                f"Windows-MCP advertised {sorted(actual)!r}; expected {sorted(EXPECTED_TOOLS)!r}"
            )
        signatures = json.loads(Path(__file__).with_name('tool-signatures.json').read_text(encoding='utf-8'))
        if set(signatures) != EXPECTED_TOOLS:
            raise RuntimeError('Windows-MCP reviewed signatures do not match the permitted tool catalog')
        for tool in tools:
            expected_parameters = {parameter['name'] for parameter in signatures[tool.name]}
            actual_parameters = set(tool.inputSchema.get('properties', {}))
            if actual_parameters != expected_parameters:
                raise RuntimeError(
                    f'Windows-MCP {tool.name} parameters {sorted(actual_parameters)!r}; '
                    f'expected {sorted(expected_parameters)!r}'
                )
        result = await asyncio.wait_for(
            client.call_tool("Wait", {"duration": 1}), STARTUP_TIMEOUT_SECONDS
        )
        if result.is_error:
            raise RuntimeError(f"Windows-MCP Wait smoke failed: {result}")


if __name__ == "__main__":
    asyncio.run(smoke())
