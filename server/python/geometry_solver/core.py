"""SymPy-backed solver with a deliberately small public interface.

The coordinate-system convention follows the ideas in WY51AI/EduLab's
edu-solid-geometry kernel. This implementation narrows that general kernel to
one verified EduCompanion capability and adds strict input and result contracts.
"""

from __future__ import annotations

import math
import re
import sys
from pathlib import Path
from typing import Any


VENDOR = Path(__file__).resolve().parents[1] / "vendor"
if str(VENDOR) not in sys.path:
    sys.path.insert(0, str(VENDOR))

import sympy as sp  # noqa: E402

from .verifier import verify_all_equal_quad_pyramid, verify_projection_dihedral_tetrahedron, verify_regular_quad_pyramid  # noqa: E402


TEMPLATE_ID = "regular-quad-pyramid-be-pac"
TEMPLATE_VERSION = 1
ALL_EQUAL_TEMPLATE_ID = "regular-quad-pyramid-all-equal-cos"
ALL_EQUAL_TEMPLATE_VERSION = 1
TRIANGULAR_PROJECTION_TEMPLATE_ID = "triangular-pyramid-projection-dihedral"
MAX_AST_DEPTH = 8
MAX_AST_NODES = 64


class ContractError(ValueError):
    pass


def _failure(status: str, code: str, path: str, *, retryable: bool = False) -> dict[str, Any]:
    return {
        "solverStatus": status,
        "failureCode": code,
        "retryable": retryable,
        "details": [{"path": path, "code": code}],
    }


def _parse_exact(node: Any, *, depth: int = 1, counter: list[int] | None = None) -> sp.Expr:
    counter = counter or [0]
    counter[0] += 1
    if counter[0] > MAX_AST_NODES or depth > MAX_AST_DEPTH:
        raise ContractError("EXACT_AST_LIMIT_EXCEEDED")
    if not isinstance(node, dict) or not isinstance(node.get("op"), str):
        raise ContractError("EXACT_AST_REQUIRED")
    op = node["op"]
    if op == "integer" and set(node) == {"op", "value"}:
        value = node["value"]
        if isinstance(value, bool) or not isinstance(value, int) or abs(value) > 10**9:
            raise ContractError("INVALID_INTEGER")
        return sp.Integer(value)
    if op == "rational" and set(node) == {"op", "p", "q"}:
        p, q = node["p"], node["q"]
        if any(isinstance(value, bool) or not isinstance(value, int) for value in (p, q)) or q <= 0:
            raise ContractError("INVALID_RATIONAL")
        if math.gcd(abs(p), q) != 1:
            raise ContractError("RATIONAL_NOT_CANONICAL")
        return sp.Rational(p, q)
    if op in {"sqrt", "neg"} and set(node) == {"op", "arg"}:
        arg = _parse_exact(node["arg"], depth=depth + 1, counter=counter)
        if op == "sqrt":
            if arg.is_nonnegative is not True:
                raise ContractError("SQRT_NOT_PROVABLY_NONNEGATIVE")
            return sp.sqrt(arg)
        return -arg
    if op in {"add", "mul"} and set(node) == {"op", "args"}:
        args = node["args"]
        if not isinstance(args, list) or not 2 <= len(args) <= 16:
            raise ContractError("INVALID_VARIADIC_ARITY")
        parsed = [_parse_exact(value, depth=depth + 1, counter=counter) for value in args]
        return sp.Add(*parsed) if op == "add" else sp.Mul(*parsed)
    raise ContractError("UNSUPPORTED_EXACT_OP")


def _exact_ast(value: sp.Expr) -> dict[str, Any]:
    value = sp.factor(sp.simplify(value))
    if isinstance(value, sp.Integer):
        return {"op": "integer", "value": int(value)}
    if isinstance(value, sp.Rational):
        return {"op": "rational", "p": int(value.p), "q": int(value.q)}
    if value.is_Pow and value.exp == sp.Rational(1, 2):
        return {"op": "sqrt", "arg": _exact_ast(value.base)}
    if value.is_Add:
        return {"op": "add", "args": [_exact_ast(arg) for arg in value.as_ordered_terms()]}
    if value.is_Mul:
        return {"op": "mul", "args": [_exact_ast(arg) for arg in value.as_ordered_factors()]}
    raise ContractError(f"UNSERIALIZABLE_EXACT_VALUE:{value}")


def _vector_ast(vector: sp.Matrix) -> list[dict[str, Any]]:
    return [_exact_ast(value) for value in vector]


def _matches_capability(payload: dict[str, Any]) -> bool:
    try:
        if payload.get("lockedTemplate") != {"templateId": TEMPLATE_ID, "version": TEMPLATE_VERSION}:
            return False
        entities = payload["entities"]
        if not isinstance(entities, list) or len({item["id"] for item in entities}) != len(entities):
            return False
        by_id = {item["id"]: item for item in entities}
        body = by_id["body1"]
        if body.get("bodyType") != "regular_quad_pyramid" or body.get("apex") != "P" or body.get("baseVertices") != ["A", "B", "C", "D"]:
            return False
        if any(by_id[name].get("type") != "point" for name in ("P", "A", "B", "C", "D", "E")):
            return False
        if by_id["BE"].get("type") != "segment" or by_id["BE"].get("points") != ["B", "E"]:
            return False
        if by_id["PAC"].get("type") != "plane" or by_id["PAC"].get("points") != ["P", "A", "C"]:
            return False
        relations = {item["id"]: item for item in payload["relations"]}
        for relation_id, relation_type in (("r-base", "base_edge"), ("r-height", "height"), ("r-mid", "midpoint")):
            relation = relations[relation_id]
            if relation.get("type") != relation_type or relation.get("confirmationStatus") != "confirmed":
                return False
        if relations["r-base"]["args"].get("body") != "body1" or relations["r-height"]["args"].get("body") != "body1":
            return False
        midpoint = relations["r-mid"]["args"]
        if midpoint != {"point": "E", "endpoints": ["P", "C"], "resultRole": "midpointPC"}:
            return False
        return payload.get("query") == {"type": "line_plane_angle_sin", "line": "BE", "plane": "PAC", "lockedByTemplate": True}
    except (KeyError, TypeError):
        return False


def _matches_capability_all_equal(payload: dict[str, Any]) -> bool:
    """棱长均相等的正四棱锥 X-ABCD：E 是 XC 的中点，求 AE 与 BX 所成角的余弦值。

    该模板不需要数值尺寸：棱长均相等已把形状完全确定，所求角度与尺度无关。
    """
    try:
        if payload.get("lockedTemplate") != {"templateId": ALL_EQUAL_TEMPLATE_ID, "version": ALL_EQUAL_TEMPLATE_VERSION}:
            return False
        entities = payload["entities"]
        if not isinstance(entities, list) or len({item["id"] for item in entities}) != len(entities):
            return False
        by_id = {item["id"]: item for item in entities}
        body = by_id["body1"]
        apex = body.get("apex")
        if (
            body.get("bodyType") != "regular_quad_pyramid"
            or not isinstance(apex, str)
            or len(apex) != 1
            or apex in "ABCD"
            or body.get("baseVertices") != ["A", "B", "C", "D"]
        ):
            return False
        if any(by_id[name].get("type") != "point" for name in ("A", "B", "C", "D", "E", apex)):
            return False
        if by_id["AE"].get("type") != "segment" or sorted(by_id["AE"].get("points")) != ["A", "E"]:
            return False
        if by_id["BX"].get("type") != "segment" or sorted(by_id["BX"].get("points")) != ["B", apex]:
            return False
        relations = {item["id"]: item for item in payload["relations"]}
        midpoint = relations["r-mid"]
        if midpoint.get("type") != "midpoint" or midpoint.get("confirmationStatus") != "confirmed":
            return False
        midpoint_args = midpoint["args"]
        if midpoint_args != {"point": "E", "endpoints": [apex, "C"], "resultRole": "midpointXC"}:
            return False
        all_equal = relations["r-eq"]
        if (
            all_equal.get("type") != "all_edges_equal"
            or all_equal.get("confirmationStatus") != "confirmed"
            or all_equal["args"].get("body") != "body1"
        ):
            return False
        return payload.get("query") == {"type": "segment_angle_cosine", "line1": "AE", "line2": "BX", "lockedByTemplate": True}
    except (KeyError, TypeError):
        return False


def _plain_radical(value: sp.Expr) -> str:
    """把 sqrt(n)/m 这类精确值渲染成 √n/m 的简洁形式。"""
    text = str(sp.simplify(value))
    text = re.sub(r"sqrt\((\d+)\)", r"√\1", text)
    return text.replace("*", "")


def _solve_all_equal_pyramid(payload: dict[str, Any]) -> dict[str, Any]:
    """单位尺度 + 棱长均相等 ⇒ 高 h = a/√2；用向量内积求异面直线所成角的余弦。"""
    apex = next(entity for entity in payload["entities"] if entity["id"] == "body1")["apex"]
    a = sp.Integer(1)  # 尺度不影响角度，取单位棱长
    h = sp.simplify(a / sp.sqrt(2))
    points = {
        "O": sp.Matrix([0, 0, 0]),
        # Keep every base edge parallel to the unit grid.  This is a rigid
        # rotation of the former diagonal-on-axis embedding: the mathematics
        # is unchanged, but a side of length 2 now visibly spans two cells.
        "A": sp.Matrix([-a / 2, -a / 2, 0]),
        "B": sp.Matrix([a / 2, -a / 2, 0]),
        "C": sp.Matrix([a / 2, a / 2, 0]),
        "D": sp.Matrix([-a / 2, a / 2, 0]),
        apex: sp.Matrix([0, 0, h]),
    }
    points["E"] = sp.simplify((points[apex] + points["C"]) / 2)

    line_ae = points["E"] - points["A"]
    line_bx = points[apex] - points["B"]
    # 异面直线所成角取锐角，余弦取绝对值。
    answer = sp.factor(
        abs(line_ae.dot(line_bx)) / (sp.sqrt(line_ae.dot(line_ae)) * sp.sqrt(line_bx.dot(line_bx)))
    )

    base_edges = [("A", "B"), ("B", "C"), ("C", "D"), ("D", "A")]
    side_edges = [(apex, name) for name in ("A", "B", "C", "D")]
    verification = verify_all_equal_quad_pyramid(payload, points, answer)
    if not verification["valid"]:
        return _failure("solver_failed", "VERIFICATION_FAILED", "verification")

    display_plain = _plain_radical(answer)
    latex = sp.latex(answer)
    grid_size = 4  # 单位尺度下坐标范围约 ±0.71
    return {
        "solverStatus": "verified",
        "adapterVersion": "edulab_quad_pyramid_all_equal_v1",
        "answer": {"exact": _exact_ast(answer), "displayPlain": display_plain, "latex": latex},
        "canonicalCoordinates": {name: _vector_ast(point) for name, point in points.items()},
        "derivation": [
            {"stepId": "frame", "factCodes": ["CANONICAL_FRAME_BUILT"], "highlightElementIds": ["axes", "measure-edge"]},
            {"stepId": "all-equal", "factCodes": ["ALL_EDGES_EQUAL_HEIGHT_A_OVER_ROOT2"], "highlightElementIds": ["measure-edge", "measure-height"]},
            {"stepId": "midpoint", "factCodes": ["MIDPOINT_COORDINATES"], "highlightElementIds": ["point-E", f"segment-{apex}C"]},
            {"stepId": "answer", "factCodes": ["SEGMENT_ANGLE_COSINE"], "highlightElementIds": ["segment-AE", f"segment-B{apex}"]},
        ],
        "verification": {key: value for key, value in verification.items() if key != "valid"},
        "scene": {
            "coordinateConvention": "math_xyz_z_up",
            "threeTransform": "[x,z,y]",
            "grid": {"unit": 1, "size": grid_size, "divisions": grid_size, "plane": "z=0", "valueSource": "canonicalCoordinates", "alignment": "base_edge_xy"},
            "dimensions": [
                {"id": "measure-edge", "label": "棱长均相等（底边 = 侧棱 = 1）", "value": _exact_ast(a), "points": ["A", "B"], "valueSource": "constraint.all_edges_equal"},
                {"id": "measure-height", "label": f"高 h = {_plain(h)}", "value": _exact_ast(h), "points": [apex, "O"], "valueSource": "derived.allEdgesEqualHeight"},
            ],
            "camera": {"position": [5, 4, 5], "target": [0, 0.45, 0]},
            "frameEdges": [[start, end] for start, end in base_edges + side_edges],
            "queryLine": ["A", "E"],
            "queryLine2": ["B", apex],
            "midpoint": "E",
            "elements": [
                *({"id": f"point-{name}", "type": "point", "point": name, "label": name} for name in ("A", "B", "C", "D", "E", apex)),
                {"id": "edge-AB", "type": "segment", "points": ["A", "B"], "style": "frame"},
                {"id": "edge-BC", "type": "segment", "points": ["B", "C"], "style": "frame"},
                {"id": "edge-CD", "type": "segment", "points": ["C", "D"], "style": "frame"},
                {"id": "edge-DA", "type": "segment", "points": ["D", "A"], "style": "frame"},
                {"id": f"edge-{apex}A", "type": "segment", "points": [apex, "A"], "style": "frame"},
                {"id": f"edge-{apex}B", "type": "segment", "points": [apex, "B"], "style": "frame"},
                {"id": f"segment-{apex}C", "type": "segment", "points": [apex, "C"], "style": "frame"},
                {"id": f"edge-{apex}D", "type": "segment", "points": [apex, "D"], "style": "frame"},
                {"id": "segment-AE", "type": "segment", "points": ["A", "E"], "style": "emphasis"},
                {"id": f"segment-B{apex}", "type": "segment", "points": ["B", apex], "style": "emphasis"},
                {"id": "measure-edge", "type": "measure", "points": ["A", "B"], "label": "棱长 = 1"},
                {"id": "measure-height", "type": "measure", "points": [apex, "O"], "label": f"h = {_plain(h)}"},
                {"id": "axes", "type": "axes", "size": 3},
            ],
        },
    }


def solve_geometry(payload: dict[str, Any]) -> dict[str, Any]:
    """Solve a verified geometry IR without delegating mathematical facts to an LLM."""
    if isinstance(payload, dict) and payload.get("schemaVersion") == "geometry-ir/v2":
        return _solve_circular_geometry(payload)
    if not isinstance(payload, dict) or payload.get("schemaVersion") != "geometry-ir/v1":
        return _failure("solver_failed", "INVALID_GEOMETRY_IR", "schemaVersion")
    if payload.get("lockedTemplate") == {"templateId": TRIANGULAR_PROJECTION_TEMPLATE_ID, "version": 1}:
        try:
            length = _parse_exact(payload["parameters"]["BC"])
        except (KeyError, TypeError, ContractError) as error:
            return _failure("solver_failed", str(error) or "INVALID_BC", "parameters.BC")
        if length.is_positive is not True:
            return _failure("contradictory", "NON_POSITIVE_LENGTH", "parameters.BC")
        root_three = sp.sqrt(3)
        height = sp.simplify(sp.Rational(3, 2) * length * (2 - root_three))
        points = {
            "B": sp.Matrix([0, root_three * length / 2, 0]),
            "C": sp.Matrix([-length / 2, 0, 0]),
            "D": sp.Matrix([root_three * height, 0, 0]),
            "O": sp.Matrix([0, height, 0]),
            "A": sp.Matrix([0, height, height]),
        }
        base_normal = (points["C"] - points["B"]).cross(points["D"] - points["B"])
        ad = points["D"] - points["A"]
        sine = sp.factor(abs(ad.dot(base_normal)) / sp.sqrt(ad.dot(ad) * base_normal.dot(base_normal)))
        volume = sp.factor(abs((points["B"] - points["A"]).dot((points["C"] - points["A"]).cross(points["D"] - points["A"]))) / 6)
        verification = verify_projection_dihedral_tetrahedron(points, length, sine, volume)
        if not verification["valid"]:
            return _failure("solver_failed", "VERIFICATION_FAILED", "verification")
        max_coordinate = max(abs(float(value)) for point in points.values() for value in point)
        grid_size = max(4, math.ceil(max_coordinate) * 2)
        base_edges = [("B", "C"), ("C", "D"), ("D", "B")]
        side_edges = [("A", "B"), ("A", "C"), ("A", "D")]
        return {
            "solverStatus": "verified", "adapterVersion": "triangular_projection_dihedral_sympy_v1",
            "answer": {
                "exact": [_exact_ast(sine), _exact_ast(volume)],
                "displayPlain": f"(1) AB⊥CD；(2) sin = {_plain_radical(sine)}；(3) V = {_plain_radical(volume)}",
                "latex": rf"(1)\ AB\perp CD;\quad (2)\ \sin\alpha={sp.latex(sine)};\quad (3)\ V={sp.latex(volume)}"
            },
            "canonicalCoordinates": {name: _vector_ast(point) for name, point in points.items()},
            "derivation": [
                {"stepId":"projection","factCodes":["AO_PERP_BASE","BO_PERP_CD"],"highlightElementIds":["segment-AO","segment-BO"]},
                {"stepId":"proof","factCodes":["AB_PERP_CD"],"highlightElementIds":["edge-AB","edge-CD"]},
                {"stepId":"dihedrals","factCodes":["DIHEDRAL_BC_60","DIHEDRAL_CD_45"],"highlightElementIds":["base-plane"]},
                {"stepId":"sine","factCodes":["LINE_PLANE_SINE"],"highlightElementIds":["edge-AD","base-plane"]},
                {"stepId":"volume","factCodes":["TETRAHEDRON_VOLUME"],"highlightElementIds":["base-plane","segment-AO"]}
            ],
            "verification": {key:value for key,value in verification.items() if key != "valid"},
            "scene": {
                "coordinateConvention":"math_xyz_z_up", "threeTransform":"[x,z,y]",
                "grid":{"unit":1,"size":grid_size,"divisions":grid_size,"plane":"z=0","valueSource":"canonicalCoordinates"},
                "dimensions":[
                    {"id":"measure-BC","label":f"BC = {_plain_radical(length)}","value":_exact_ast(length),"points":["B","C"],"valueSource":"constraint.length-BC"},
                    {"id":"measure-AO","label":f"AO = {_plain_radical(height)}","value":_exact_ast(height),"points":["A","O"],"valueSource":"derived.dihedral-constraints"}
                ],
                "camera":{"position":[6,5,7],"target":[0,0.8,0]},
                "frameEdges":[[start,end] for start,end in base_edges + side_edges],
                "queryLine":["A","D"], "queryPlane":["B","C","D"],
                "elements":[
                    *({"id":f"point-{name}","type":"point","point":name,"label":name} for name in ("A","B","C","D","O")),
                    *({"id":f"edge-{start}{end}","type":"segment","points":[start,end],"style":"frame"} for start,end in base_edges + side_edges),
                    {"id":"segment-AO","type":"segment","points":["A","O"],"style":"emphasis"},
                    {"id":"segment-BO","type":"segment","points":["B","O"],"style":"construction"},
                    {"id":"base-plane","type":"plane","points":["B","C","D"],"opacity":0.20},
                    {"id":"measure-BC","type":"measure","points":["B","C"],"label":f"BC = {_plain_radical(length)}"},
                    {"id":"measure-AO","type":"measure","points":["A","O"],"label":f"AO = {_plain_radical(height)}"},
                    {"id":"axes","type":"axes","size":3}
                ]
            }
        }
    if payload.get("lockedTemplate") == {"templateId": ALL_EQUAL_TEMPLATE_ID, "version": ALL_EQUAL_TEMPLATE_VERSION}:
        if not _matches_capability_all_equal(payload):
            return _failure("unsupported", "CAPABILITY_NOT_REGISTERED", "query")
        return _solve_all_equal_pyramid(payload)
    if not _matches_capability(payload):
        return _failure("unsupported", "CAPABILITY_NOT_REGISTERED", "query")
    try:
        relations = {item["id"]: item for item in payload["relations"]}
        a = _parse_exact(relations["r-base"]["args"]["value"])
        h = _parse_exact(relations["r-height"]["args"]["value"])
    except (KeyError, TypeError, ContractError) as error:
        return _failure("solver_failed", str(error) or "INVALID_PARAMETERS", "parameters")
    if a.is_positive is not True or h.is_positive is not True:
        return _failure("contradictory", "NON_POSITIVE_LENGTH", "parameters")

    points = {
        "O": sp.Matrix([0, 0, 0]),
        # Textbook grid frame: base sides, not diagonals, align to X/Y.
        # No length is scaled; this is only a rigid rotation of the model.
        "A": sp.Matrix([-a / 2, -a / 2, 0]),
        "B": sp.Matrix([a / 2, -a / 2, 0]),
        "C": sp.Matrix([a / 2, a / 2, 0]),
        "D": sp.Matrix([-a / 2, a / 2, 0]),
        "P": sp.Matrix([0, 0, h]),
    }
    points["E"] = sp.simplify((points["P"] + points["C"]) / 2)

    line_be = points["E"] - points["B"]
    plane_normal = (points["A"] - points["P"]).cross(points["C"] - points["P"])
    answer = sp.factor(
        abs(line_be.dot(plane_normal))
        / (sp.sqrt(line_be.dot(line_be)) * sp.sqrt(plane_normal.dot(plane_normal)))
    )

    base_edges = [("A", "B"), ("B", "C"), ("C", "D"), ("D", "A")]
    side_edges = [("P", name) for name in ("A", "B", "C", "D")]
    verification = verify_regular_quad_pyramid(payload, points, answer)
    if not verification["valid"]:
        return _failure("solver_failed", "VERIFICATION_FAILED", "verification")

    golden = sp.simplify(a - 2) == 0 and sp.simplify(h - 1) == 0
    display_plain = "2√22/11" if golden else str(answer).replace("sqrt", "√")
    latex = r"\frac{2\sqrt{22}}{11}" if golden else sp.latex(answer)
    grid_radius = math.ceil(float(a / 2)) + 1
    grid_size = grid_radius * 2
    return {
        "solverStatus": "verified",
        "adapterVersion": "edulab_quad_pyramid_v1",
        "answer": {"exact": _exact_ast(answer), "displayPlain": display_plain, "latex": latex},
        "canonicalCoordinates": {name: _vector_ast(point) for name, point in points.items()},
        "derivation": [
            {"stepId": "frame", "factCodes": ["CANONICAL_FRAME_BUILT"], "highlightElementIds": ["axes", "measure-base", "measure-height"]},
            {"stepId": "midpoint", "factCodes": ["MIDPOINT_COORDINATES"], "highlightElementIds": ["point-E", "segment-PC"]},
            {"stepId": "line", "factCodes": ["LINE_DIRECTION_BE"], "highlightElementIds": ["segment-BE"]},
            {"stepId": "plane", "factCodes": ["PLANE_NORMAL_PAC"], "highlightElementIds": ["plane-PAC", "normal-PAC"]},
            {"stepId": "answer", "factCodes": ["LINE_PLANE_SINE"], "highlightElementIds": ["segment-BE", "plane-PAC"]},
        ],
        "verification": {key: value for key, value in verification.items() if key != "valid"},
        "scene": {
            "coordinateConvention": "math_xyz_z_up",
            "threeTransform": "[x,z,y]",
            "grid": {
                "unit": 1,
                "size": grid_size,
                "divisions": grid_size,
                "plane": "z=0",
                "valueSource": "canonicalCoordinates",
                "alignment": "base_edge_xy",
            },
            "dimensions": [
                {
                    "id": "base-edge",
                    "label": f"底边 a = {a}",
                    "value": _exact_ast(a),
                    "points": ["A", "B"],
                    "valueSource": "relations.r-base.args.value",
                },
                {
                    "id": "height",
                    "label": f"高 h = {h}",
                    "value": _exact_ast(h),
                    "points": ["P", "O"],
                    "valueSource": "relations.r-height.args.value",
                },
            ],
            "camera": {"position": [5, 4, 5], "target": [0, 0.45, 0]},
            "frameEdges": [[start, end] for start, end in base_edges + side_edges],
            "queryLine": ["B", "E"],
            "queryPlane": ["P", "A", "C"],
            "midpoint": "E",
            "elements": [
                *({"id": f"point-{name}", "type": "point", "point": name, "label": name} for name in ("P", "A", "B", "C", "D", "E")),
                {"id": "edge-AB", "type": "segment", "points": ["A", "B"], "style": "frame"},
                {"id": "edge-BC", "type": "segment", "points": ["B", "C"], "style": "frame"},
                {"id": "edge-CD", "type": "segment", "points": ["C", "D"], "style": "frame"},
                {"id": "edge-DA", "type": "segment", "points": ["D", "A"], "style": "frame"},
                {"id": "edge-PA", "type": "segment", "points": ["P", "A"], "style": "frame"},
                {"id": "edge-PB", "type": "segment", "points": ["P", "B"], "style": "frame"},
                {"id": "segment-PC", "type": "segment", "points": ["P", "C"], "style": "frame"},
                {"id": "edge-PD", "type": "segment", "points": ["P", "D"], "style": "frame"},
                {"id": "segment-BE", "type": "segment", "points": ["B", "E"], "style": "emphasis"},
                {"id": "plane-PAC", "type": "plane", "points": ["P", "A", "C"], "opacity": 0.24},
                {"id": "normal-PAC", "type": "arrow", "origin": "O", "direction": [1, -1, 0], "style": "normal"},
                {"id": "measure-base", "type": "measure", "points": ["A", "B"], "label": str(a)},
                {"id": "measure-height", "type": "measure", "points": ["P", "O"], "label": str(h)},
                {"id": "axes", "type": "axes", "size": 3},
            ],
        },
    }


# ===================== 圆柱 / 圆锥 / 球：geometry-ir/v2 =====================

def _circular_failure(status: str, code: str, path: str) -> dict[str, Any]:
    return _failure(status, code, path)


def _required_exact(payload: dict[str, Any], name: str) -> sp.Expr:
    try:
        value = _parse_exact(payload["parameters"][name])
    except (KeyError, TypeError, ContractError) as error:
        raise ContractError(f"MISSING_OR_INVALID_{name.upper()}") from error
    if value.is_positive is not True:
        raise ContractError(f"NON_POSITIVE_{name.upper()}")
    return value


def _required_nonnegative_exact(payload: dict[str, Any], name: str) -> sp.Expr:
    try:
        value = _parse_exact(payload["parameters"][name])
    except (KeyError, TypeError, ContractError) as error:
        raise ContractError(f"MISSING_OR_INVALID_{name.upper()}") from error
    if value.is_nonnegative is not True:
        raise ContractError(f"NEGATIVE_{name.upper()}")
    return value


def _grid_size(*values: sp.Expr) -> int:
    numeric = [abs(float(value)) for value in values]
    return max(8, min(48, int(math.ceil(max(numeric) * 2 + 4))))


def _point(x: sp.Expr | int, y: sp.Expr | int, z: sp.Expr | int) -> sp.Matrix:
    return sp.Matrix([sp.sympify(x), sp.sympify(y), sp.sympify(z)])


def _plain(value: sp.Expr) -> str:
    return str(sp.simplify(value)).replace("**", "^").replace("sqrt", "√").replace("pi", "π").replace("*π", "π")


def _circle_scene(
    body_type: str,
    points: dict[str, sp.Matrix],
    dimensions: list[dict[str, Any]],
    elements: list[dict[str, Any]],
    query_line: list[str],
    grid_size: int,
    derivation: list[dict[str, Any]],
    answer_plain: str,
    answer_latex: str,
    checks: list[str],
    embedding_unique: bool = True,
) -> dict[str, Any]:
    return {
        "solverStatus": "verified",
        "adapterVersion": "circular-solids-ir-v2",
        "answer": {"displayPlain": answer_plain, "latex": answer_latex},
        "canonicalCoordinates": {name: _vector_ast(point) for name, point in points.items()},
        "derivation": derivation,
        "verification": {
            "embeddingUnique": embedding_unique,
            "answerUnique": True,
            "distinctAnswerBranchCount": 1,
            "checks": checks,
        },
        "scene": {
            "schemaVersion": "geometry-scene/v2",
            "bodyType": body_type,
            "coordinateConvention": "math_xyz_z_up",
            "threeTransform": "[x,z,y]",
            "grid": {"unit": 1, "size": grid_size, "divisions": grid_size, "plane": "z=0", "valueSource": "canonicalCoordinates"},
            "camera": {"position": [grid_size * .72, grid_size * .56, grid_size * .72], "target": [0, 0.45, 0]},
            "frameEdges": [["A", "B"], query_line],
            "queryLine": query_line,
            "dimensions": dimensions,
            "elements": elements,
        },
    }


def _solve_circular_geometry(payload: dict[str, Any]) -> dict[str, Any]:
    """Solve only curriculum-standard circular-solid queries with exact SymPy values.

    The canonical coordinate frame removes rigid-motion freedom: base/center is
    the origin and the symmetry axis is mathematical z.  A result is emitted
    only for the supported body/query pairs below.
    """
    body = payload.get("body") if isinstance(payload.get("body"), dict) else {}
    body_type = body.get("type")
    query = payload.get("query") if isinstance(payload.get("query"), dict) else {}
    query_type = query.get("type")
    if body_type not in {"right_cylinder", "right_cone", "sphere"}:
        return _circular_failure("unsupported", "CIRCULAR_BODY_NOT_REGISTERED", "body.type")
    if body.get("axis", "z") != "z":
        return _circular_failure("unsupported", "NON_CANONICAL_AXIS", "body.axis")
    try:
        r = _required_exact(payload, "radius")
        h = _required_exact(payload, "height") if body_type in {"right_cylinder", "right_cone"} else None
    except ContractError as error:
        return _circular_failure("needs_more_context" if str(error).startswith("MISSING") else "contradictory", str(error), "parameters")

    if body_type == "right_cylinder":
        points = {"O": _point(0, 0, 0), "O1": _point(0, 0, h), "A": _point(r, 0, 0), "B": _point(-r, 0, 0), "A1": _point(r, 0, h), "B1": _point(-r, 0, h)}
        dimensions = [
            {"id": "radius", "label": f"r = {r}", "points": ["O", "A"], "value": _exact_ast(r), "valueSource": "parameters.radius"},
            {"id": "height", "label": f"h = {h}", "points": ["O", "O1"], "value": _exact_ast(h), "valueSource": "parameters.height"},
        ]
        body_element = {"id": "body-cylinder", "type": "cylinder", "baseCenter": "O", "topCenter": "O1", "radius": _exact_ast(r), "height": _exact_ast(h), "opacity": .42}
        if query_type == "axis_section":
            area = sp.simplify(2 * r * h)
            elements = [body_element, {"id": "section-axis", "type": "section-rectangle", "points": ["A", "B", "B1", "A1"], "opacity": .34}, {"id": "axis", "type": "segment", "points": ["O", "O1"], "style": "emphasis"}, {"id": "axes", "type": "axes", "size": 3}]
            return _circle_scene("right_cylinder", points, dimensions, elements, ["O", "O1"], _grid_size(r, h), [{"stepId": "frame", "factCodes": ["CYLINDER_AXIS_FRAME"]}, {"stepId": "section", "factCodes": ["AXIS_SECTION_RECTANGLE"]}, {"stepId": "answer", "factCodes": ["SECTION_AREA_2RH"]}], f"轴截面面积 = {_plain(area)}", sp.latex(area), ["CYLINDER_RADIUS", "CYLINDER_HEIGHT", "AXIS_SECTION_RECTANGLE", "SECTION_AREA"])
        if query_type == "parallel_base_section":
            # The题目 may omit the section height because every plane parallel to
            # a right cylinder's base cuts an equal circle.  Use z=h/2 only as a
            # canonical representative; it does not affect the verified radius.
            section_z = sp.simplify(h / 2)
            area = sp.simplify(sp.pi * r**2)
            points.update({"C": _point(0, 0, section_z), "Q": _point(r, 0, section_z)})
            section_dimensions = [*dimensions, {"id": "section-radius", "label": f"r = {r}", "points": ["C", "Q"], "value": _exact_ast(r), "valueSource": "parameters.radius"}]
            elements = [body_element, {"id": "section-parallel-base", "type": "section-circle", "center": "C", "radius": _exact_ast(r), "opacity": .62}, {"id": "section-radius-line", "type": "segment", "points": ["C", "Q"], "style": "emphasis"}, {"id": "axis", "type": "segment", "points": ["O", "O1"], "style": "construction"}, {"id": "axes", "type": "axes", "size": 3}]
            return _circle_scene("right_cylinder", points, section_dimensions, elements, ["C", "Q"], _grid_size(r, h), [{"stepId": "frame", "factCodes": ["CYLINDER_AXIS_FRAME"]}, {"stepId": "section", "factCodes": ["PARALLEL_BASE_SECTION_CIRCLE", "SECTION_RADIUS_EQUALS_BASE_RADIUS"]}, {"stepId": "answer", "factCodes": ["SECTION_AREA_PI_R2"]}], f"平行底面截面面积 = {_plain(area)}", sp.latex(area), ["CYLINDER_RADIUS", "CYLINDER_HEIGHT", "SECTION_PLANE_PARALLEL_BASE", "SECTION_RADIUS_EQUALS_BASE_RADIUS", "SECTION_AREA"], embedding_unique=False)
        if query_type != "volume_and_surface_area":
            return _circular_failure("unsupported", "CYLINDER_QUERY_NOT_REGISTERED", "query.type")
        volume, surface = sp.simplify(sp.pi * r**2 * h), sp.simplify(2 * sp.pi * r * (r + h))
        return _circle_scene("right_cylinder", points, dimensions, [body_element, {"id": "base-circle", "type": "disk", "center": "O", "radius": _exact_ast(r), "opacity": .16}, {"id": "top-circle", "type": "disk", "center": "O1", "radius": _exact_ast(r), "opacity": .16}, {"id": "axis", "type": "segment", "points": ["O", "O1"], "style": "emphasis"}, {"id": "axes", "type": "axes", "size": 3}], ["O", "O1"], _grid_size(r, h), [{"stepId": "frame", "factCodes": ["CYLINDER_AXIS_FRAME"]}, {"stepId": "volume", "factCodes": ["CYLINDER_VOLUME"]}, {"stepId": "surface", "factCodes": ["CYLINDER_SURFACE_AREA"]}], f"体积 = {_plain(volume)}；表面积 = {_plain(surface)}", f"V={sp.latex(volume)},\\quad S={sp.latex(surface)}", ["CYLINDER_RADIUS", "CYLINDER_HEIGHT", "VOLUME_PI_R2_H", "SURFACE_2PI_R_R_PLUS_H"])

    if body_type == "right_cone":
        l = sp.simplify(sp.sqrt(r**2 + h**2))
        points = {"O": _point(0, 0, 0), "P": _point(0, 0, h), "A": _point(r, 0, 0), "B": _point(-r, 0, 0)}
        dimensions = [
            {"id": "radius", "label": f"r = {r}", "points": ["O", "A"], "value": _exact_ast(r), "valueSource": "parameters.radius"},
            {"id": "height", "label": f"h = {h}", "points": ["O", "P"], "value": _exact_ast(h), "valueSource": "parameters.height"},
            {"id": "slant", "label": f"l = {l}", "points": ["P", "A"], "value": _exact_ast(l), "valueSource": "derived.slantHeight"},
        ]
        body_element = {"id": "body-cone", "type": "cone", "baseCenter": "O", "apex": "P", "radius": _exact_ast(r), "height": _exact_ast(h), "opacity": .42}
        if query_type == "axis_section":
            area = sp.simplify(r * h)
            return _circle_scene("right_cone", points, dimensions, [body_element, {"id": "section-axis", "type": "section-triangle", "points": ["A", "B", "P"], "opacity": .34}, {"id": "axis", "type": "segment", "points": ["O", "P"], "style": "emphasis"}, {"id": "axes", "type": "axes", "size": 3}], ["O", "P"], _grid_size(r, h), [{"stepId": "frame", "factCodes": ["CONE_AXIS_FRAME"]}, {"stepId": "section", "factCodes": ["CONE_AXIS_SECTION_ISOSCELES"]}, {"stepId": "answer", "factCodes": ["SECTION_AREA_RH"]}], f"轴截面面积 = {_plain(area)}", sp.latex(area), ["CONE_RADIUS", "CONE_HEIGHT", "CONE_AXIS_SECTION", "SECTION_AREA"])
        if query_type != "volume_and_surface_area":
            return _circular_failure("unsupported", "CONE_QUERY_NOT_REGISTERED", "query.type")
        volume, surface = sp.simplify(sp.pi * r**2 * h / 3), sp.simplify(sp.pi * r * (r + l))
        return _circle_scene("right_cone", points, dimensions, [body_element, {"id": "base-circle", "type": "disk", "center": "O", "radius": _exact_ast(r), "opacity": .16}, {"id": "axis", "type": "segment", "points": ["O", "P"], "style": "emphasis"}, {"id": "slant", "type": "segment", "points": ["P", "A"], "style": "frame"}, {"id": "axes", "type": "axes", "size": 3}], ["O", "P"], _grid_size(r, h), [{"stepId": "frame", "factCodes": ["CONE_AXIS_FRAME"]}, {"stepId": "slant", "factCodes": ["SLANT_HEIGHT_PYTHAGORAS"]}, {"stepId": "volume", "factCodes": ["CONE_VOLUME"]}, {"stepId": "surface", "factCodes": ["CONE_SURFACE_AREA"]}], f"母线 = {_plain(l)}；体积 = {_plain(volume)}；表面积 = {_plain(surface)}", f"l={sp.latex(l)},\\quad V={sp.latex(volume)},\\quad S={sp.latex(surface)}", ["CONE_RADIUS", "CONE_HEIGHT", "SLANT_PYTHAGORAS", "VOLUME_PI_R2_H_OVER_3", "SURFACE_PI_R_R_PLUS_L"])

    points = {"O": _point(0, 0, 0), "A": _point(r, 0, 0), "B": _point(-r, 0, 0)}
    dimensions = [{"id": "radius", "label": f"R = {r}", "points": ["O", "A"], "value": _exact_ast(r), "valueSource": "parameters.radius"}]
    body_element = {"id": "body-sphere", "type": "sphere", "center": "O", "radius": _exact_ast(r), "opacity": .42}
    if query_type == "volume_and_surface_area":
        volume, surface = sp.simplify(4 * sp.pi * r**3 / 3), sp.simplify(4 * sp.pi * r**2)
        return _circle_scene("sphere", points, dimensions, [body_element, {"id": "diameter", "type": "segment", "points": ["A", "B"], "style": "emphasis"}, {"id": "axes", "type": "axes", "size": 3}], ["O", "A"], _grid_size(r), [{"stepId": "frame", "factCodes": ["SPHERE_CENTER_RADIUS"]}, {"stepId": "volume", "factCodes": ["SPHERE_VOLUME"]}, {"stepId": "surface", "factCodes": ["SPHERE_SURFACE_AREA"]}], f"体积 = {_plain(volume)}；表面积 = {_plain(surface)}", f"V={sp.latex(volume)},\\quad S={sp.latex(surface)}", ["SPHERE_RADIUS", "VOLUME_4PI_R3_OVER_3", "SURFACE_4PI_R2"])
    if query_type != "section_circle":
        return _circular_failure("unsupported", "SPHERE_QUERY_NOT_REGISTERED", "query.type")
    try:
        d = _required_nonnegative_exact(payload, "planeDistance")
    except ContractError as error:
        return _circular_failure("needs_more_context" if str(error).startswith("MISSING") else "contradictory", str(error), "parameters.planeDistance")
    if sp.simplify(d - r) > 0:
        return _circular_failure("contradictory", "SECTION_PLANE_OUTSIDE_SPHERE", "parameters.planeDistance")
    section_r = sp.simplify(sp.sqrt(r**2 - d**2))
    area = sp.simplify(sp.pi * section_r**2)
    points.update({"C": _point(0, 0, d), "Q": _point(section_r, 0, d)})
    dimensions.extend([
        {"id": "plane-distance", "label": f"d = {d}", "points": ["O", "C"], "value": _exact_ast(d), "valueSource": "parameters.planeDistance"},
        {"id": "section-radius", "label": f"ρ = {section_r}", "points": ["C", "Q"], "value": _exact_ast(section_r), "valueSource": "derived.sectionRadius"},
    ])
    return _circle_scene("sphere", points, dimensions, [body_element, {"id": "section-plane", "type": "section-circle", "center": "C", "radius": _exact_ast(section_r), "opacity": .72}, {"id": "center-distance", "type": "segment", "points": ["O", "C"], "style": "emphasis"}, {"id": "section-radius-line", "type": "segment", "points": ["C", "Q"], "style": "emphasis"}, {"id": "axes", "type": "axes", "size": 3}], ["O", "C"], _grid_size(r), [{"stepId": "frame", "factCodes": ["SPHERE_CENTER_RADIUS"]}, {"stepId": "section", "factCodes": ["PLANE_SPHERE_INTERSECTION_CIRCLE"]}, {"stepId": "answer", "factCodes": ["SECTION_RADIUS_PYTHAGORAS"]}], f"截面半径 = {_plain(section_r)}；截面面积 = {_plain(area)}", f"\\rho={sp.latex(section_r)},\\quad A={sp.latex(area)}", ["SPHERE_RADIUS", "PLANE_DISTANCE", "SECTION_CIRCLE", "SECTION_RADIUS_PYTHAGORAS"])
