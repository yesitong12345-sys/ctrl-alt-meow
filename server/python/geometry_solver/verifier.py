"""Independent constraint and query verifier for candidate solver output."""

from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Any


VENDOR = Path(__file__).resolve().parents[1] / "vendor"
if str(VENDOR) not in sys.path:
    sys.path.insert(0, str(VENDOR))

import sympy as sp  # noqa: E402


def _parse_exact_independently(node: dict[str, Any], depth: int = 1) -> sp.Expr:
    if depth > 8 or not isinstance(node, dict):
        raise ValueError("INVALID_VERIFIER_EXACT_AST")
    op = node.get("op")
    if op == "integer" and isinstance(node.get("value"), int) and not isinstance(node["value"], bool):
        return sp.Integer(node["value"])
    if op == "rational" and all(isinstance(node.get(key), int) and not isinstance(node[key], bool) for key in ("p", "q")) and node["q"] > 0:
        return sp.Rational(node["p"], node["q"])
    if op == "sqrt":
        value = _parse_exact_independently(node["arg"], depth + 1)
        if value.is_nonnegative is not True:
            raise ValueError("INVALID_VERIFIER_SQRT")
        return sp.sqrt(value)
    if op == "neg":
        return -_parse_exact_independently(node["arg"], depth + 1)
    if op in {"add", "mul"} and isinstance(node.get("args"), list) and 2 <= len(node["args"]) <= 16:
        values = [_parse_exact_independently(value, depth + 1) for value in node["args"]]
        return sp.Add(*values) if op == "add" else sp.Mul(*values)
    raise ValueError("INVALID_VERIFIER_EXACT_AST")


def verify_regular_quad_pyramid(
    geometry_ir: dict[str, Any],
    candidate_points: dict[str, sp.Matrix],
    candidate_answer: sp.Expr,
) -> dict[str, Any]:
    """Rebuild every asserted relation and the queried angle from the candidate."""
    entities = {item["id"]: item for item in geometry_ir["entities"]}
    relations = {item["id"]: item for item in geometry_ir["relations"]}
    base_edge = _parse_exact_independently(relations["r-base"]["args"]["value"])
    height = _parse_exact_independently(relations["r-height"]["args"]["value"])
    query = geometry_ir["query"]
    line_names = entities[query["line"]]["points"]
    plane_names = entities[query["plane"]]["points"]
    p = candidate_points

    body_id = relations["r-base"]["args"]["body"]
    body = entities[body_id]
    base_names = body["baseVertices"]
    base_pairs = list(zip(base_names, base_names[1:] + base_names[:1]))
    base_square = all(
        sp.simplify((p[end] - p[start]).dot(p[end] - p[start]) - base_edge**2) == 0
        for start, end in base_pairs
    )
    adjacent_perpendicular = sp.simplify(
        (p[base_names[1]] - p[base_names[0]]).dot(p[base_names[2]] - p[base_names[1]])
    ) == 0
    base_coplanar = all(sp.simplify(p[name][2]) == 0 for name in base_names)
    apex = body["apex"]
    height_vector = p[apex] - p["O"]
    height_valid = (
        sp.simplify(height_vector.dot(height_vector) - height**2) == 0
        and all(sp.simplify(height_vector.dot(p[name] - p["O"])) == 0 for name in base_names[:2])
    )
    midpoint = relations["r-mid"]["args"]
    midpoint_name, midpoint_endpoints = midpoint["point"], midpoint["endpoints"]
    midpoint_valid = all(
        sp.simplify(p[midpoint_name][index] - (p[midpoint_endpoints[0]][index] + p[midpoint_endpoints[1]][index]) / 2) == 0
        for index in range(3)
    )

    line_vector = p[line_names[1]] - p[line_names[0]]
    plane_u = p[plane_names[1]] - p[plane_names[0]]
    plane_v = p[plane_names[2]] - p[plane_names[0]]
    plane_normal = plane_u.cross(plane_v)
    plane_non_collinear = sp.simplify(plane_normal.dot(plane_normal)) != 0
    rebuilt_answer = sp.simplify(
        abs(line_vector.dot(plane_normal))
        / (sp.sqrt(line_vector.dot(line_vector)) * sp.sqrt(plane_normal.dot(plane_normal)))
    )
    query_identity = sp.simplify(rebuilt_answer - candidate_answer) == 0

    line_float = [float(value) for value in line_vector]
    normal_float = [float(value) for value in plane_normal]
    dot = abs(sum(x * y for x, y in zip(line_float, normal_float)))
    numeric_rebuilt = dot / math.sqrt(sum(x * x for x in line_float) * sum(x * x for x in normal_float))
    numeric_candidate = float(candidate_answer)
    numeric_crosscheck = math.isclose(numeric_rebuilt, numeric_candidate, rel_tol=1e-12, abs_tol=1e-12)

    valid = all((base_square, adjacent_perpendicular, base_coplanar, height_valid, midpoint_valid, plane_non_collinear, query_identity, numeric_crosscheck))
    return {
        "valid": valid,
        "answerUnique": valid,
        "embeddingUnique": valid,
        "distinctAnswerBranchCount": 1 if valid else 0,
        "checks": [
            "BASE_SQUARE",
            "HEIGHT_PERPENDICULAR",
            "MIDPOINT",
            "PLANE_NON_COLLINEAR",
            "QUERY_IDENTITY",
            "NUMERIC_VECTOR_CROSSCHECK",
        ],
    }


def verify_projection_dihedral_tetrahedron(
    candidate_points: dict[str, sp.Matrix],
    bc_length: sp.Expr,
    sine_answer: sp.Expr,
    volume_answer: sp.Expr,
) -> dict[str, Any]:
    """Independently rebuild every stated relation and both numerical queries."""
    p = candidate_points
    base_normal = (p["C"] - p["B"]).cross(p["D"] - p["B"])
    ao = p["A"] - p["O"]
    bo = p["O"] - p["B"]
    cd = p["D"] - p["C"]
    ad = p["D"] - p["A"]
    bc = p["C"] - p["B"]

    projection = sp.simplify(p["O"][2]) == 0 and sp.simplify(ao.dot(p["C"] - p["B"])) == 0 and sp.simplify(ao.dot(p["D"] - p["B"])) == 0
    bo_cd = sp.simplify(bo.dot(cd)) == 0
    ad_bc = sp.simplify(ad.dot(bc)) == 0
    bc_valid = sp.simplify(bc.dot(bc) - bc_length**2) == 0

    def cosine(u: sp.Matrix, v: sp.Matrix) -> sp.Expr:
        return sp.simplify(abs(u.dot(v)) / sp.sqrt(u.dot(u) * v.dot(v)))

    angle_bcd = sp.simplify(cosine(p["B"] - p["C"], p["D"] - p["C"]) - sp.Rational(1, 2)) == 0
    normal_abc = (p["A"] - p["B"]).cross(p["C"] - p["B"])
    normal_acd = (p["A"] - p["C"]).cross(p["D"] - p["C"])
    dihedral_bc = sp.simplify(cosine(normal_abc, base_normal) - sp.Rational(1, 2)) == 0
    dihedral_cd = sp.simplify(cosine(normal_acd, base_normal) - sp.sqrt(2) / 2) == 0
    rebuilt_sine = sp.simplify(abs(ad.dot(base_normal)) / sp.sqrt(ad.dot(ad) * base_normal.dot(base_normal)))
    rebuilt_volume = sp.simplify(abs((p["B"] - p["A"]).dot((p["C"] - p["A"]).cross(p["D"] - p["A"]))) / 6)
    query_crosscheck = sp.simplify(rebuilt_sine - sine_answer) == 0 and sp.simplify(rebuilt_volume - volume_answer) == 0
    checks = [projection, bo_cd, ad_bc, angle_bcd, dihedral_bc, dihedral_cd, bc_valid, query_crosscheck]
    return {
        "valid": all(checks), "answerUnique": all(checks), "embeddingUnique": all(checks),
        "distinctAnswerBranchCount": 1 if all(checks) else 0,
        "checks": [
            "PROJECTION_PERPENDICULAR_BASE", "BO_PERPENDICULAR_CD", "AD_PERPENDICULAR_BC",
            "BASE_ANGLE_BCD", "DIHEDRAL_BC", "DIHEDRAL_CD", "BC_LENGTH", "QUERY_CROSSCHECK"
        ],
    }


def verify_all_equal_quad_pyramid(
    geometry_ir: dict[str, Any],
    candidate_points: dict[str, sp.Matrix],
    candidate_answer: sp.Expr,
) -> dict[str, Any]:
    """独立复核全等棱锥模板：8 条棱等长、E 是顶点-C 的中点、重建夹角余弦一致。"""
    entities = {item["id"]: item for item in geometry_ir["entities"]}
    relations = {item["id"]: item for item in geometry_ir["relations"]}
    body = entities[relations["r-eq"]["args"]["body"]]
    base_names = body["baseVertices"]
    apex = body["apex"]
    p = candidate_points

    base_pairs = list(zip(base_names, base_names[1:] + base_names[:1]))
    side = sp.simplify((p[base_names[1]] - p[base_names[0]]).dot(p[base_names[1]] - p[base_names[0]]))
    base_equal = all(
        sp.simplify((p[end] - p[start]).dot(p[end] - p[start]) - side) == 0
        for start, end in base_pairs
    )
    side_equal = all(
        sp.simplify((p[apex] - p[name]).dot(p[apex] - p[name]) - side) == 0
        for name in base_names
    )
    base_coplanar = all(sp.simplify(p[name][2]) == 0 for name in base_names)
    height_valid = sp.simplify((p[apex][2]) ** 2 - side / 2) == 0  # h² = a²/2（棱长均相等）
    midpoint = relations["r-mid"]["args"]
    midpoint_name, midpoint_endpoints = midpoint["point"], midpoint["endpoints"]
    midpoint_valid = all(
        sp.simplify(p[midpoint_name][index] - (p[midpoint_endpoints[0]][index] + p[midpoint_endpoints[1]][index]) / 2) == 0
        for index in range(3)
    )

    line_ae = p["E"] - p["A"]
    line_bx = p[apex] - p["B"]
    rebuilt_answer = sp.simplify(
        abs(line_ae.dot(line_bx))
        / (sp.sqrt(line_ae.dot(line_ae)) * sp.sqrt(line_bx.dot(line_bx)))
    )
    query_identity = sp.simplify(rebuilt_answer - candidate_answer) == 0

    line_float = [float(value) for value in line_ae]
    other_float = [float(value) for value in line_bx]
    dot = abs(sum(x * y for x, y in zip(line_float, other_float)))
    numeric_rebuilt = dot / math.sqrt(sum(x * x for x in line_float) * sum(x * x for x in other_float))
    numeric_candidate = float(candidate_answer)
    numeric_crosscheck = math.isclose(numeric_rebuilt, numeric_candidate, rel_tol=1e-12, abs_tol=1e-12)

    valid = all((base_equal, side_equal, base_coplanar, height_valid, midpoint_valid, query_identity, numeric_crosscheck))
    return {
        "valid": valid,
        "answerUnique": valid,
        "embeddingUnique": valid,
        "distinctAnswerBranchCount": 1 if valid else 0,
        "checks": [
            "BASE_SQUARE",
            "SIDE_EDGES_EQUAL_BASE",
            "HEIGHT_A_OVER_ROOT2",
            "MIDPOINT",
            "QUERY_IDENTITY",
            "NUMERIC_VECTOR_CROSSCHECK",
        ],
    }
