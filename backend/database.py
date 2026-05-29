"""
database.py — Backward-compatible shim.

All logic has been moved to the db/ package.
This file re-exports every public symbol so that existing
`from database import X` statements continue to work.
"""

from db import *  # noqa: F401, F403
