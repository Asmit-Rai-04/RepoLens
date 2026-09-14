import re
from pathlib import PurePosixPath
from typing import Literal

from pydantic import BaseModel, Field, field_validator

# A POSIX root, an MS-DOS drive prefix, or a UNC share. All of these are absolute
# filesystem locations that must never reach an API response.
_ABSOLUTE_PATH = re.compile(r"^(?:/|[A-Za-z]:[\\/]|\\\\)")


class DiscoveredFile(BaseModel):
    path: str
    size_bytes: int = Field(ge=0)
    kind: Literal["source", "ignored", "other"]

    @field_validator("path")
    @classmethod
    def validate_relative_path(cls, value: str) -> str:
        path = PurePosixPath(value)
        if path.is_absolute() or ".." in path.parts or _ABSOLUTE_PATH.match(value):
            raise ValueError("path must be relative and traversal-free")
        return path.as_posix()
