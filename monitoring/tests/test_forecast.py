from storage_forecast.forecast import NOT_FILLING_DAYS, days_until_empty, days_until_full, linear_slope

HOURS_14_DAYS = [h / 24 for h in range(14 * 24)]


def test_linear_slope():
    assert linear_slope([0, 1, 2, 3], [10, 8, 6, 4]) == -2
    assert linear_slope([1, 1, 1], [5, 6, 7]) == 0.0


def test_free_space_shrinking_two_gib_a_day():
    gib = 1024**3
    free = [50 * gib - 2 * gib * day for day in HOURS_14_DAYS]  # ends at about 22 GiB
    assert days_until_empty(HOURS_14_DAYS, free) == round(free[-1] / (2 * gib), 1)


def test_disk_percent_growing_one_point_a_day():
    used = [60 + day for day in HOURS_14_DAYS]
    expected = round((100 - used[-1]) / 1, 1)
    assert days_until_full(HOURS_14_DAYS, used) == expected


def test_stable_or_shrinking_usage_is_not_filling():
    assert days_until_full(HOURS_14_DAYS, [70.0] * len(HOURS_14_DAYS)) == NOT_FILLING_DAYS
    assert days_until_empty(HOURS_14_DAYS, [100.0 + d for d in HOURS_14_DAYS]) == NOT_FILLING_DAYS


def test_result_is_capped_at_one_year():
    used = [10 + 0.001 * day for day in HOURS_14_DAYS]
    assert days_until_full(HOURS_14_DAYS, used) == NOT_FILLING_DAYS


def test_not_enough_history_returns_none():
    assert days_until_full([0, 0.04, 0.08], [50, 51, 52]) is None
    one_day = [h / 24 for h in range(30)]  # 30 points but only ~1.2 days
    assert days_until_full(one_day, [50 + d for d in one_day]) is None


def test_already_full_disk_reports_zero_days():
    used = [90 + day for day in HOURS_14_DAYS]  # passes 100%
    assert days_until_full(HOURS_14_DAYS, used) == 0.0
