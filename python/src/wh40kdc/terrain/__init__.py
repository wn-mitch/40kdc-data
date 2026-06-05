"""Terrain layout resolution and keystone measurement."""

from wh40kdc.terrain.keystones import (
    BOARD_INCHES,
    TerrainKeystoneError,
    keystone_measurements,
)
from wh40kdc.terrain.resolve import (
    TerrainResolveError,
    footprint_vertices,
    oriented_offsets,
    polygon_centroid,
    resolve_layout,
)

__all__ = [
    "BOARD_INCHES",
    "TerrainKeystoneError",
    "TerrainResolveError",
    "footprint_vertices",
    "keystone_measurements",
    "oriented_offsets",
    "polygon_centroid",
    "resolve_layout",
]
