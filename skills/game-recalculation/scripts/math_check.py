"""Independent arithmetic check. Input uses confirmed whole seconds; no network or writes."""
import argparse
import json
import math
from fractions import Fraction
from pathlib import Path


def seconds(value):
    if type(value) is not int or value < 0:
        raise ValueError("Expected confirmed non-negative whole seconds")
    return value


def calculate(data):
    times = [seconds(v) for v in data["timesSeconds"]]
    if not times:
        raise ValueError("No normally completed teams: arithmetic mean is undefined")
    total = sum(times)
    if total > 2**53 - 1:
        raise ValueError("Sum exceeds exact range of the floating point cross-check")
    assert math.fsum(times) == total
    mean = Fraction(total, len(times))
    rows = []
    for row in data.get("targets", []):
        current = seconds(row["currentSeconds"])
        target = seconds(row["targetSeconds"])
        delta = target - current
        rows.append({"key": row["key"], "currentSeconds": current,
                     "targetSeconds": target, "bonusSeconds": max(0, -delta),
                     "penaltySeconds": max(0, delta)})
    return {"sumSeconds": total, "count": len(times), "exactMean": str(mean),
            "meanSeconds": float(mean), "roundingRequired": mean.denominator != 1,
            "rows": rows, "applied": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(calculate(json.loads(args.input.read_text(encoding="utf-8"))), ensure_ascii=False))
    except (ValueError, KeyError, TypeError) as error:
        parser.exit(1, json.dumps({"error": str(error)}, ensure_ascii=False) + "\n")
