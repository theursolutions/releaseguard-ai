"""Linear trend forecast. Kept free of AWS calls so it is easy to test."""

from __future__ import annotations

from typing import Optional, Sequence

# Published when a disk is not filling up, so the alarm stays OK instead of going to "no data".
NOT_FILLING_DAYS = 365.0
MIN_POINTS = 24  # at least a day of hourly data
MIN_SPAN_DAYS = 2.0


def linear_slope(xs: Sequence[float], ys: Sequence[float]) -> float:
    """Least-squares slope of y over x."""
    n = len(xs)
    mean_x, mean_y = sum(xs) / n, sum(ys) / n
    variance = sum((x - mean_x) ** 2 for x in xs)
    if variance == 0:
        return 0.0
    return sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / variance


def has_enough_history(days: Sequence[float]) -> bool:
    return len(days) >= MIN_POINTS and (max(days) - min(days)) >= MIN_SPAN_DAYS


def days_until_empty(days: Sequence[float], free_values: Sequence[float]) -> Optional[float]:
    """For a 'free space' metric (RDS FreeStorageSpace): days until free space reaches zero."""
    if not has_enough_history(days):
        return None
    slope = linear_slope(days, free_values)  # bytes per day; negative while filling up
    latest = free_values[-1]
    if slope >= 0:
        return NOT_FILLING_DAYS
    return round(min(max(latest, 0.0) / -slope, NOT_FILLING_DAYS), 1)


def days_until_full(days: Sequence[float], used_percent: Sequence[float]) -> Optional[float]:
    """For a 'used percent' metric (CloudWatch Agent disk_used_percent): days until 100%."""
    if not has_enough_history(days):
        return None
    slope = linear_slope(days, used_percent)  # percentage points per day
    latest = used_percent[-1]
    if slope <= 0:
        return NOT_FILLING_DAYS
    return round(min(max(100.0 - latest, 0.0) / slope, NOT_FILLING_DAYS), 1)
