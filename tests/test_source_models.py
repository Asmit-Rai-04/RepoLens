from app.schemas.source import Import, Inheritance, ParseStatus, SourceFile, SupportedLanguage, Symbol


def test_source_models_validate_and_preserve_analysis_data():
    source = SourceFile(
        path="src/main.py",
        size_bytes=10,
        language=SupportedLanguage.PYTHON,
        parse_status=ParseStatus.SUCCESS,
        symbols=[Symbol(name="main", kind="function", line_start=1, line_end=2, column_start=0, column_end=10)],
        imports=[Import(module="os", kind="import", line_start=1, line_end=1)],
        inheritance=[Inheritance(child="Child", parent="Base", relation="inherits", line_start=2, line_end=2)],
    )
    assert source.kind == "source"
    assert source.symbols[0].name == "main"
    assert source.imports[0].module == "os"
    assert source.inheritance[0].parent == "Base"
