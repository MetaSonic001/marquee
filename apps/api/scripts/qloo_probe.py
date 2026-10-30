"""Quick raw probe: call one MCP tool with JSON args, print + save the envelope."""
import asyncio
import json
import os
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "fixtures" / "qloo"

def load_env():
    for line in (ROOT / ".env").read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1); os.environ.setdefault(k, v)

async def main(calls):
    load_env(); OUT.mkdir(parents=True, exist_ok=True)
    exe = ROOT / "node_modules" / ".bin" / ("qloo.cmd" if os.name == "nt" else "qloo")
    params = StdioServerParameters(command=str(exe), args=["mcp"], env=dict(os.environ))
    async with stdio_client(params) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            for name, tool, args in calls:
                res = await s.call_tool(tool, args)
                env = res.structured_content or json.loads(res.content[0].text)
                (OUT / f"{name}.json").write_text(json.dumps({"tool": tool, "args": args, "envelope": env}, indent=1))
                print(f"=== {name} [{env.get('status')}] n={env.get('result_count')} :: {env.get('summary','')[:200]}")
                r = env.get("results", [])
                r = r[:int(os.environ.get('SHOW','2'))] if isinstance(r, list) else r
                print(json.dumps(r, indent=1)[:int(os.environ.get('CHARS','1500'))])
                if env.get("error"): print("ERR", env["error"])

calls = json.loads(Path(sys.argv[1]).read_text())
asyncio.run(main(calls))
