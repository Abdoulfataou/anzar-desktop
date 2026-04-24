"""Simple file-based cache with TTL support."""
import json
import time
from pathlib import Path
from typing import Any, Optional


class FileCache:
    """Simple file-based cache with TTL."""
    
    def __init__(self, cache_dir: str = "./data/cache"):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
    
    def _get_cache_path(self, key: str) -> Path:
        """Get the file path for a cache key."""
        safe_key = key.replace("/", "_").replace(":", "_")
        return self.cache_dir / f"{safe_key}.json"
    
    def set(self, key: str, value: Any, ttl: int = 3600) -> None:
        """Store a value in cache with TTL in seconds."""
        cache_file = self._get_cache_path(key)
        data = {
            "value": value,
            "expires_at": time.time() + ttl,
        }
        cache_file.write_text(json.dumps(data))
    
    def get(self, key: str) -> Optional[Any]:
        """Retrieve a value from cache if not expired."""
        cache_file = self._get_cache_path(key)
        
        if not cache_file.exists():
            return None
        
        try:
            data = json.loads(cache_file.read_text())
            if time.time() > data.get("expires_at", 0):
                cache_file.unlink()
                return None
            return data.get("value")
        except (json.JSONDecodeError, KeyError):
            cache_file.unlink()
            return None
    
    def delete(self, key: str) -> None:
        """Delete a cache entry."""
        cache_file = self._get_cache_path(key)
        if cache_file.exists():
            cache_file.unlink()
    
    def clear(self) -> None:
        """Clear all cache entries."""
        for cache_file in self.cache_dir.glob("*.json"):
            cache_file.unlink()


# Global cache instance
file_cache = FileCache()
