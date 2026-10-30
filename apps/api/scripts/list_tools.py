import asyncio
import json
import os
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[1]

def load_env():
    for line in (ROOT / ".env").read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1); os.environ.setdefault(k, v)

async def main():
    load_env()
    exe = ROOT / "node_modules" / ".bin" / ("qloo.cmd" if os.name == "nt" else "qloo")
    params = StdioServerParameters(command=str(exe), args=["mcp"], env=dict(os.environ))
    async with stdio_client(params) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            tools = await s.list_tools()
            out = [{"name": t.name, "description": t.description, "schema": t.input_schema} for t in tools.tools]
            Path(sys.argv[1]).write_text(json.dumps(out, indent=1))
            print([t["name"] for t in out])

asyncio.run(main())
