"""The readiness rubric. Claude rates each area; the total is computed here so it is consistent
and can never exceed an area's maximum."""

AREAS = {
    "acceptance_criteria": ("Every flow has testable acceptance criteria", 25),
    "edge_cases": ("Edge and error cases defined", 20),
    "actors_permissions": ("All actors and their permissions defined", 15),
    "dependencies": ("Dependencies listed with owners", 15),
    "no_contradictions": ("No contradictions", 15),
    "out_of_scope": ("Out of scope stated", 10),
}

READY_SCORE = 70


def compute(ratings: list[dict]) -> dict:
    by_area = {rating.get("area"): rating for rating in ratings or []}
    areas = []
    for key, (label, maximum) in AREAS.items():
        rating = by_area.get(key, {})
        try:
            points = round(float(rating.get("points", 0)))
        except (TypeError, ValueError):
            points = 0
        areas.append(
            {
                "area": key,
                "label": label,
                "points": max(0, min(maximum, points)),
                "max": maximum,
                "reason": str(rating.get("reason") or "Not assessed."),
            }
        )
    total = sum(area["points"] for area in areas)
    return {"total": total, "ready": total >= READY_SCORE, "areas": areas}
