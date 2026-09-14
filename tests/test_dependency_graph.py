import json
from app.graph.graph_builder import DependencyGraphBuilder
from app.graph.models import GraphEdgeType, GraphNodeType
from app.schemas.source import Import, Inheritance, ParseStatus, SourceFile, SupportedLanguage, Symbol


def sf(path, language, imports=None, inheritance=None, symbols=None, package=None):
    return SourceFile(path=path, size_bytes=1, language=language, parse_status=ParseStatus.SUCCESS, imports=imports or [], inheritance=inheritance or [], symbols=symbols or [], package_name=package)


def test_single_file_has_file_node_and_empty_metrics():
    result = DependencyGraphBuilder().build([sf("main.py", SupportedLanguage.PYTHON)])
    assert [n.id for n in result.nodes] == ["main.py"]
    assert result.edges == []
    assert result.cycles == []


def test_python_absolute_from_import_resolves_internal():
    files=[sf("services/user.py", SupportedLanguage.PYTHON, symbols=[Symbol(name="User",kind="class",line_start=1,line_end=1,column_start=0,column_end=1)]), sf("main.py", SupportedLanguage.PYTHON, imports=[Import(module="services.user",kind="from_import",imported_names=["User"],line_start=1,line_end=1)])]
    result=DependencyGraphBuilder().build(files)
    assert any(e.source=="main.py" and e.target=="services/user.py" and e.edge_type==GraphEdgeType.IMPORTS and e.resolved for e in result.edges)


def test_python_relative_import_resolves_internal_and_missing_is_unresolved():
    files=[sf("pkg/util.py", SupportedLanguage.PYTHON), sf("pkg/main.py", SupportedLanguage.PYTHON, imports=[Import(module=".util",kind="from_import",line_start=1,line_end=1), Import(module=".missing",kind="from_import",line_start=2,line_end=2)])]
    result=DependencyGraphBuilder().build(files)
    assert any(e.target=="pkg/util.py" and e.resolved for e in result.edges)
    assert any(e.target.startswith("unresolved:unresolved_internal:") and not e.resolved for e in result.edges)


def test_external_imports_are_not_internal_unresolved():
    files=[sf("main.py", SupportedLanguage.PYTHON, imports=[Import(module="requests",kind="import",line_start=1,line_end=1)])]
    result=DependencyGraphBuilder().build(files)
    node=next(n for n in result.nodes if n.id=="external:requests")
    assert node.node_type == GraphNodeType.EXTERNAL
    assert result.edges[0].resolved is False


def test_js_ts_extension_and_index_resolution():
    files=[
        sf("src/utils.ts", SupportedLanguage.TYPESCRIPT),
        sf("src/components/index.tsx", SupportedLanguage.TSX),
        sf("src/main.ts", SupportedLanguage.TYPESCRIPT, imports=[Import(module="./utils",kind="import",line_start=1,line_end=1), Import(module="./components",kind="import",line_start=2,line_end=2)])
    ]
    result=DependencyGraphBuilder().build(files)
    assert {e.target for e in result.edges} == {"src/utils.ts", "src/components/index.tsx"}


def test_js_ts_import_with_explicit_extension_resolves_to_that_file():
    files=[
        sf("source/index.js", SupportedLanguage.JAVASCRIPT, imports=[Import(module="./utilities.js",kind="import",line_start=1,line_end=1)]),
        sf("source/utilities.js", SupportedLanguage.JAVASCRIPT),
        sf("test/chalk.js", SupportedLanguage.JAVASCRIPT, imports=[Import(module="../source/index.js",kind="import",line_start=1,line_end=1)]),
    ]
    result=DependencyGraphBuilder().build(files)
    resolved={e.source: e.target for e in result.edges if e.resolved}
    assert resolved["source/index.js"] == "source/utilities.js"
    assert resolved["test/chalk.js"] == "source/index.js"


def test_js_ts_directory_index_resolves_through_parent_segments():
    files=[
        sf("src/lib/index.ts", SupportedLanguage.TYPESCRIPT),
        sf("src/a/b/consumer.ts", SupportedLanguage.TYPESCRIPT, imports=[Import(module="../../lib",kind="import",line_start=1,line_end=1)]),
    ]
    result=DependencyGraphBuilder().build(files)
    assert any(e.target == "src/lib/index.ts" and e.resolved for e in result.edges)


def test_js_ts_import_escaping_the_repository_is_unresolved_not_internal():
    files=[sf("src/a.py", SupportedLanguage.PYTHON), sf("src/main.ts", SupportedLanguage.TYPESCRIPT, imports=[Import(module="../../outside",kind="import",line_start=1,line_end=1)])]
    result=DependencyGraphBuilder().build(files)
    edge=next(e for e in result.edges if e.source == "src/main.ts")
    assert edge.resolved is False
    assert edge.import_evidence["reason"] == "Relative JS/TS import points outside the repository"


def test_d_typescript_index_is_indexed_like_its_implementation():
    files=[
        sf("src/index.d.ts", SupportedLanguage.TYPESCRIPT),
        sf("src/user.ts", SupportedLanguage.TYPESCRIPT, imports=[Import(module=".",kind="import",line_start=1,line_end=1)]),
    ]
    result=DependencyGraphBuilder().build(files)
    assert any(e.target == "src/index.d.ts" and e.resolved for e in result.edges)


def test_java_package_resolution():
    files=[
        sf("src/demo/User.java", SupportedLanguage.JAVA, package="demo", symbols=[Symbol(name="User",kind="class",line_start=1,line_end=1,column_start=0,column_end=1)]),
        sf("src/demo/Service.java", SupportedLanguage.JAVA, package="demo", imports=[Import(module="demo.User",kind="import",line_start=1,line_end=1)]),
    ]
    result=DependencyGraphBuilder().build(files)
    assert any(e.target=="src/demo/User.java" and e.resolved for e in result.edges)


def test_ambiguous_import_is_explicit_and_candidates_preserved():
    files=[sf("a/User.py", SupportedLanguage.PYTHON), sf("b/User.py", SupportedLanguage.PYTHON), sf("main.py", SupportedLanguage.PYTHON, imports=[Import(module="User",kind="from_import",line_start=1,line_end=1)])]
    result=DependencyGraphBuilder().build(files)
    edge=result.edges[0]
    assert not edge.resolved
    assert edge.import_evidence["classification"] == "ambiguous"
    assert set(edge.import_evidence["candidates"]) == {"a/User.py","b/User.py"}
    assert any(n.node_type == GraphNodeType.UNRESOLVED and n.metadata["classification"] == "ambiguous" for n in result.nodes)


def test_three_file_chain_has_directional_metrics_and_no_cycle():
    files=[
        sf("a.py", SupportedLanguage.PYTHON, imports=[Import(module="b",kind="import",line_start=1,line_end=1)]),
        sf("b.py", SupportedLanguage.PYTHON, imports=[Import(module="c",kind="import",line_start=1,line_end=1)]),
        sf("c.py", SupportedLanguage.PYTHON),
    ]
    result=DependencyGraphBuilder().build(files)
    assert result.metrics.node_metrics["a.py"].outgoing_dependencies == 1
    assert result.metrics.node_metrics["b.py"].incoming_dependencies == 1
    assert result.metrics.node_metrics["c.py"].incoming_dependencies == 1
    assert result.cycles == []
    assert result.strongly_connected_components == []


def test_cycle_and_scc_are_detected():
    files=[
        sf("a.py", SupportedLanguage.PYTHON, imports=[Import(module="b",kind="import",line_start=1,line_end=1)]),
        sf("b.py", SupportedLanguage.PYTHON, imports=[Import(module="c",kind="import",line_start=1,line_end=1)]),
        sf("c.py", SupportedLanguage.PYTHON, imports=[Import(module="a",kind="import",line_start=1,line_end=1)]),
    ]
    result=DependencyGraphBuilder().build(files)
    assert {"a.py","b.py","c.py"} in [set(x) for x in result.strongly_connected_components]
    assert any(set(c.files)=={"a.py","b.py","c.py"} and c.length==3 for c in result.cycles)


def test_external_and_unresolved_do_not_affect_internal_cycles():
    files=[sf("a.py", SupportedLanguage.PYTHON, imports=[Import(module="requests",kind="import",line_start=1,line_end=1), Import(module=".missing",kind="from_import",line_start=2,line_end=2)])]
    result=DependencyGraphBuilder().build(files)
    assert result.cycles == []
    assert result.strongly_connected_components == []


def test_dense_component_cycle_enumeration_is_bounded_and_fast():
    """A 16-file mutual dependency group contains millions of cycles; reporting must stay bounded.

    Enumerating every simple cycle of a complete 17-node digraph does not finish, so this test
    would hang the suite if the bound were removed.
    """
    import time

    size = 16
    files = [
        sf(
            f"mod{i}.py",
            SupportedLanguage.PYTHON,
            imports=[
                Import(module=f"mod{j}", kind="import", line_start=1, line_end=1)
                for j in range(size)
                if j != i
            ],
        )
        for i in range(size)
    ]
    started = time.monotonic()
    result = DependencyGraphBuilder().build(files)
    elapsed = time.monotonic() - started

    assert elapsed < 20
    assert result.cycles_truncated is True
    assert len(result.cycles) <= 150
    assert all(len(c.files) >= 2 and c.length >= 2 for c in result.cycles)
    # The shortest cycles are reported first, and the component itself is fully described.
    assert result.cycles == sorted(result.cycles, key=lambda c: (c.length, c.files))
    assert result.cycles[0].length == 2
    assert len(result.strongly_connected_components) == 1
    assert len(result.strongly_connected_components[0]) == size


def test_simple_two_file_cycle_is_not_marked_truncated():
    files=[
        sf("a.py", SupportedLanguage.PYTHON, imports=[Import(module="b",kind="import",line_start=1,line_end=1)]),
        sf("b.py", SupportedLanguage.PYTHON, imports=[Import(module="a",kind="import",line_start=1,line_end=1)]),
    ]
    result=DependencyGraphBuilder().build(files)
    assert result.cycles_truncated is False
    assert [c.length for c in result.cycles] == [2]


def test_self_import_does_not_produce_a_one_element_cycle():
    """NetworkX reports self-loops as one-element cycles, which must not enter the model."""
    files=[sf("logging.py", SupportedLanguage.PYTHON, imports=[Import(module="logging",kind="import",line_start=1,line_end=1)])]
    result=DependencyGraphBuilder().build(files)
    assert result.cycles == []
    assert result.strongly_connected_components == []
    assert all(cycle.length >= 2 and len(cycle.files) >= 2 for cycle in result.cycles)
    json.dumps(result.model_dump(mode="json"))


def test_self_import_inside_a_larger_cycle_is_filtered_but_the_cycle_is_kept():
    files=[
        sf("a.py", SupportedLanguage.PYTHON, imports=[Import(module="a",kind="import",line_start=1,line_end=1), Import(module="b",kind="import",line_start=2,line_end=2)]),
        sf("b.py", SupportedLanguage.PYTHON, imports=[Import(module="a",kind="import",line_start=1,line_end=1)]),
    ]
    result=DependencyGraphBuilder().build(files)
    assert all(cycle.length >= 2 for cycle in result.cycles)
    assert any(set(cycle.files) == {"a.py", "b.py"} for cycle in result.cycles)


def test_standard_library_import_is_not_resolved_to_a_same_named_repository_file():
    """`import logging` in src/pkg/logging.py must not resolve back to that file."""
    files=[sf("src/pkg/logging.py", SupportedLanguage.PYTHON, imports=[Import(module="logging",kind="import",line_start=1,line_end=1), Import(module="json",kind="import",line_start=2,line_end=2)])]
    result=DependencyGraphBuilder().build(files)
    assert result.edges
    assert all(edge.resolved is False for edge in result.edges)
    assert {node.id for node in result.nodes if node.node_type == GraphNodeType.EXTERNAL} == {"external:logging", "external:json"}
    assert result.cycles == []


def test_a_repository_top_level_module_still_wins_over_the_stdlib_name():
    files=[sf("logging.py", SupportedLanguage.PYTHON), sf("app.py", SupportedLanguage.PYTHON, imports=[Import(module="logging",kind="import",line_start=1,line_end=1)])]
    result=DependencyGraphBuilder().build(files)
    edge=next(e for e in result.edges if e.source == "app.py")
    assert edge.resolved is True
    assert edge.target == "logging.py"


def test_jdk_imports_are_external_even_when_a_local_class_shares_the_name():
    files=[
        sf("src/demo/Demo.java", SupportedLanguage.JAVA, package="demo", imports=[Import(module="java.util.List",kind="import",line_start=1,line_end=1)], symbols=[Symbol(name="List",kind="class",line_start=1,line_end=1,column_start=0,column_end=1)]),
        sf("src/demo/List.java", SupportedLanguage.JAVA, package="demo", symbols=[Symbol(name="List",kind="class",line_start=1,line_end=1,column_start=0,column_end=1)]),
    ]
    result=DependencyGraphBuilder().build(files)
    edge=next(e for e in result.edges if e.source == "src/demo/Demo.java")
    assert edge.resolved is False
    assert edge.target == "external:java.util.List"


def test_inheritance_edges_are_separate_from_import_metrics():
    files=[
        sf("base.py", SupportedLanguage.PYTHON, symbols=[Symbol(name="Base",kind="class",line_start=1,line_end=1,column_start=0,column_end=1)]),
        sf("child.py", SupportedLanguage.PYTHON, symbols=[Symbol(name="Child",kind="class",line_start=1,line_end=1,column_start=0,column_end=1)], inheritance=[Inheritance(child="Child",parent="Base",relation="inherits",line_start=1,line_end=1)]),
    ]
    result=DependencyGraphBuilder().build(files)
    edge=result.edges[0]
    assert edge.edge_type == GraphEdgeType.EXTENDS
    assert edge.target == "base.py"
    assert result.metrics.node_metrics["base.py"].incoming_dependencies == 0


def test_import_edge_evidence_is_json_serializable():
    files=[sf("a.py", SupportedLanguage.PYTHON, imports=[Import(module="requests",kind="import",line_start=1,line_end=1)])]
    result=DependencyGraphBuilder().build(files)
    json.dumps(result.model_dump(mode="json"))


def test_external_js_packages_are_explicit_external_nodes():
    files=[sf("main.ts", SupportedLanguage.TYPESCRIPT, imports=[Import(module="react",kind="import",line_start=1,line_end=1), Import(module="express",kind="import",line_start=2,line_end=2)])]
    result=DependencyGraphBuilder().build(files)
    external_ids={n.id for n in result.nodes if n.node_type == GraphNodeType.EXTERNAL}
    assert {"external:react", "external:express"} <= external_ids


def test_bridge_node_has_higher_betweenness_and_importance():
    files=[
        sf("a.py", SupportedLanguage.PYTHON, imports=[Import(module="bridge",kind="import",line_start=1,line_end=1)]),
        sf("bridge.py", SupportedLanguage.PYTHON, imports=[Import(module="b",kind="import",line_start=1,line_end=1), Import(module="c",kind="import",line_start=2,line_end=2)]),
        sf("b.py", SupportedLanguage.PYTHON),
        sf("c.py", SupportedLanguage.PYTHON),
    ]
    result=DependencyGraphBuilder().build(files)
    assert result.metrics.node_metrics["bridge.py"].betweenness_centrality > result.metrics.node_metrics["a.py"].betweenness_centrality
    assert result.importance_ranking[0] == "bridge.py"


def test_parsed_error_file_is_preserved_and_does_not_create_import_edges():
    broken = SourceFile(path="broken.py", size_bytes=2, language=SupportedLanguage.PYTHON, parse_status=ParseStatus.ERROR, parse_error="syntax")
    good = sf("good.py", SupportedLanguage.PYTHON, imports=[Import(module="broken",kind="import",line_start=1,line_end=1)])
    result = DependencyGraphBuilder().build([broken, good])
    assert any(n.id == "broken.py" and n.node_type == GraphNodeType.FILE for n in result.nodes)
    assert all(e.source != "broken.py" for e in result.edges)
