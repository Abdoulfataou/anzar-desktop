"""python -m db.migrations status|up|down <id>"""
import asyncio
import sys

from db.base import get_engine
from db import migrations as M


async def main(argv):
    cmd = argv[0] if argv else "status"
    engine = get_engine()
    async with engine.begin() as conn:
        if cmd == "status":
            for mid, ok in await conn.run_sync(M.status):
                print(f"{'[x]' if ok else '[ ]'} {mid}")
        elif cmd == "up":
            print("Appliquées :", await conn.run_sync(M.upgrade) or "rien à faire")
        elif cmd == "down" and len(argv) == 2:
            await conn.run_sync(M.downgrade, argv[1])
            print(f"{argv[1]} défaite. Redéploie la version précédente du code avant de redémarrer l'API.")
        else:
            print(__doc__)
            return 2
    await engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))
