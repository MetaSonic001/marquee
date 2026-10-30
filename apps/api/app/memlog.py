import os

import psutil

_proc = psutil.Process(os.getpid())


def rss_mb() -> float:
    """Resident memory of this process plus children (the `qloo mcp` Node process)."""
    total = _proc.memory_info().rss
    for c in _proc.children(recursive=True):
        try:
            total += c.memory_info().rss
        except psutil.Error:
            pass
    return total / (1024 * 1024)
