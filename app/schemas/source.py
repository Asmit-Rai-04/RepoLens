from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.files import DiscoveredFile


class SupportedLanguage(StrEnum):
    PYTHON = "python"
    JAVASCRIPT = "javascript"
    TYPESCRIPT = "typescript"
    TSX = "tsx"
    JAVA = "java"


class ParseStatus(StrEnum):
    SUCCESS = "success"
    ERROR = "error"
    EMPTY = "empty"
    UNSUPPORTED = "unsupported"


class Symbol(BaseModel):
    name: str = Field(min_length=1)
    kind: str = Field(min_length=1)
    line_start: int = Field(ge=1)
    line_end: int = Field(ge=1)
    column_start: int = Field(ge=0)
    column_end: int = Field(ge=0)
    parent: str | None = None


class Import(BaseModel):
    module: str = Field(min_length=1)
    kind: Literal["import", "from_import", "require"]
    imported_names: list[str] = Field(default_factory=list)
    alias: str | None = None
    line_start: int = Field(ge=1)
    line_end: int = Field(ge=1)


class Inheritance(BaseModel):
    child: str = Field(min_length=1)
    parent: str = Field(min_length=1)
    relation: Literal["extends", "implements", "inherits"]
    line_start: int = Field(ge=1)
    line_end: int = Field(ge=1)


class SourceFile(DiscoveredFile):
    kind: Literal["source"] = "source"
    language: SupportedLanguage | None = None
    package_name: str | None = None
    parse_status: ParseStatus
    parse_error: str | None = None
    symbols: list[Symbol] = Field(default_factory=list)
    imports: list[Import] = Field(default_factory=list)
    inheritance: list[Inheritance] = Field(default_factory=list)
