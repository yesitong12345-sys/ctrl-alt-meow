import json
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from geometry_solver import solve_geometry


GOLDEN_REQUEST = {
    "schemaVersion": "geometry-ir/v1",
    "caseId": "case-pyramid-001",
    "revision": 1,
    "lockedTemplate": {"templateId": "regular-quad-pyramid-be-pac", "version": 1},
    "problem": {"language": "zh-CN", "questionText": "正四棱锥黄金题"},
    "entities": [
        {"id": "body1", "type": "body", "bodyType": "regular_quad_pyramid", "apex": "P", "baseVertices": ["A", "B", "C", "D"], "lockedByTemplate": True},
        *({"id": name, "type": "point"} for name in ("P", "A", "B", "C", "D", "E")),
        {"id": "BE", "type": "segment", "points": ["B", "E"], "lockedByTemplate": True},
        {"id": "PAC", "type": "plane", "points": ["P", "A", "C"], "lockedByTemplate": True},
    ],
    "relations": [
        {"id": "r-base", "type": "base_edge", "args": {"body": "body1", "value": {"op": "integer", "value": 2}}, "confirmationStatus": "confirmed", "valueOrigin": "manual_correction", "evidenceRegion": None},
        {"id": "r-height", "type": "height", "args": {"body": "body1", "value": {"op": "integer", "value": 1}}, "confirmationStatus": "confirmed", "valueOrigin": "manual_correction", "evidenceRegion": None},
        {"id": "r-mid", "type": "midpoint", "args": {"point": "E", "endpoints": ["P", "C"], "resultRole": "midpointPC"}, "confirmationStatus": "confirmed", "valueOrigin": "fixture", "lockedByTemplate": True, "evidenceRegion": None},
    ],
    "query": {"type": "line_plane_angle_sin", "line": "BE", "plane": "PAC", "lockedByTemplate": True},
}

ALL_EQUAL_REQUEST = {
    "schemaVersion": "geometry-ir/v1",
    "caseId": "case-pyramid-all-equal-001",
    "revision": 1,
    "lockedTemplate": {"templateId": "regular-quad-pyramid-all-equal-cos", "version": 1},
    "problem": {"language": "zh-CN", "questionText": "棱长均相等的正四棱锥 S-ABCD 中，E 是 SC 的中点，求 AE 与 BS 所成角的余弦值。"},
    "entities": [
        {"id": "body1", "type": "body", "bodyType": "regular_quad_pyramid", "apex": "S", "baseVertices": ["A", "B", "C", "D"], "lockedByTemplate": True},
        *({"id": name, "type": "point"} for name in ("A", "B", "C", "D", "E", "S")),
        {"id": "AE", "type": "segment", "points": ["A", "E"], "lockedByTemplate": True},
        {"id": "BX", "type": "segment", "points": ["B", "S"], "lockedByTemplate": True},
    ],
    "relations": [
        {"id": "r-mid", "type": "midpoint", "args": {"point": "E", "endpoints": ["S", "C"], "resultRole": "midpointXC"}, "confirmationStatus": "confirmed", "valueOrigin": "fixture", "lockedByTemplate": True, "evidenceRegion": None},
        {"id": "r-eq", "type": "all_edges_equal", "args": {"body": "body1"}, "confirmationStatus": "confirmed", "valueOrigin": "internal_review", "evidenceRegion": None},
    ],
    "query": {"type": "segment_angle_cosine", "line1": "AE", "line2": "BX", "lockedByTemplate": True},
}


def run_cli(payload):
    completed = subprocess.run(
        [sys.executable, "-m", "geometry_solver.cli"],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=False,
        cwd=Path(__file__).resolve().parents[1],
    )
    if completed.returncode != 0:
        raise AssertionError(completed.stderr or completed.stdout)
    return json.loads(completed.stdout)


class GeometrySolverCliTest(unittest.TestCase):
    def test_verified_golden_problem_returns_exact_answer_and_complete_scene(self):
        result = run_cli(GOLDEN_REQUEST)

        self.assertEqual(result["solverStatus"], "verified")
        self.assertEqual(result["answer"]["displayPlain"], "2√22/11")
        self.assertEqual(result["answer"]["exact"]["op"], "mul")
        self.assertTrue(result["verification"]["answerUnique"])
        self.assertEqual(len(result["scene"]["frameEdges"]), 8)
        element_ids = {element["id"] for element in result["scene"]["elements"]}
        for step in result["derivation"]:
            self.assertTrue(set(step["highlightElementIds"]).issubset(element_ids))

    def test_structurally_different_query_is_safely_rejected(self):
        payload = json.loads(json.dumps(GOLDEN_REQUEST))
        next(entity for entity in payload["entities"] if entity["id"] == "BE")["points"] = ["A", "E"]

        result = run_cli(payload)

        self.assertEqual(result["solverStatus"], "unsupported")
        self.assertNotIn("answer", result)
        self.assertNotIn("scene", result)

    def test_all_one_hundred_small_integer_parameter_pairs_are_verified(self):
        for base_edge in range(1, 11):
            for height in range(1, 11):
                with self.subTest(base_edge=base_edge, height=height):
                    payload = json.loads(json.dumps(GOLDEN_REQUEST))
                    next(item for item in payload["relations"] if item["id"] == "r-base")["args"]["value"]["value"] = base_edge
                    next(item for item in payload["relations"] if item["id"] == "r-height")["args"]["value"]["value"] = height
                    result = solve_geometry(payload)
                    self.assertEqual(result["solverStatus"], "verified")
                    self.assertEqual(result["verification"]["distinctAnswerBranchCount"], 1)

    def test_non_positive_length_never_returns_an_answer(self):
        payload = json.loads(json.dumps(GOLDEN_REQUEST))
        next(item for item in payload["relations"] if item["id"] == "r-height")["args"]["value"]["value"] = 0
        result = solve_geometry(payload)
        self.assertEqual(result["solverStatus"], "contradictory")
        self.assertNotIn("answer", result)

    def test_all_equal_pyramid_returns_cosine_of_angle_between_ae_and_bs(self):
        result = run_cli(ALL_EQUAL_REQUEST)

        self.assertEqual(result["solverStatus"], "verified")
        self.assertEqual(result["answer"]["displayPlain"], "√5/10")
        self.assertTrue(result["verification"]["answerUnique"])
        self.assertEqual(len(result["scene"]["frameEdges"]), 8)
        element_ids = {element["id"] for element in result["scene"]["elements"]}
        for step in result["derivation"]:
            self.assertTrue(set(step["highlightElementIds"]).issubset(element_ids))

    def test_all_equal_pyramid_rejects_wrong_query_or_apex(self):
        payload = json.loads(json.dumps(ALL_EQUAL_REQUEST))
        next(entity for entity in payload["entities"] if entity["id"] == "BX")["points"] = ["C", "S"]
        result = run_cli(payload)
        self.assertEqual(result["solverStatus"], "unsupported")
        self.assertNotIn("answer", result)

    def test_all_equal_pyramid_answer_is_scale_invariant(self):
        payload = json.loads(json.dumps(ALL_EQUAL_REQUEST))
        result = solve_geometry(payload)
        self.assertEqual(result["answer"]["displayPlain"], "√5/10")
        self.assertEqual(result["verification"]["distinctAnswerBranchCount"], 1)


if __name__ == "__main__":
    unittest.main()
