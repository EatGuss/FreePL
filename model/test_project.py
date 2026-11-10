"""Tests for model/project.py's pure parts. Run: python -m unittest discover model"""

import unittest
from datetime import datetime, timezone

from project import last5, next_deadline


class Last5(unittest.TestCase):
    def test_averages_the_last_five_settled_gameweeks(self):
        points = {gw: {1: gw} for gw in range(1, 8)}  # player 1 scored gw points in each gw
        self.assertEqual(last5([1], points), {1: 5.0})  # GWs 3-7: (3+4+5+6+7) / 5

    def test_counts_a_blank_or_a_missed_match_as_zero(self):
        points = {1: {1: 6}, 2: {1: 0}, 3: {1: 3}}
        self.assertEqual(last5([1], points), {1: 3.0})

    def test_skips_gameweeks_before_a_player_was_added(self):
        points = {1: {1: 2}, 2: {1: 2, 9: 8}, 3: {1: 2, 9: 4}}
        self.assertEqual(last5([1, 9], points), {1: 2.0, 9: 6.0})

    def test_gives_zero_without_history(self):
        self.assertEqual(last5([5], {}), {5: 0.0})
        self.assertEqual(last5([5], {1: {1: 3}}), {5: 0.0})

    def test_rounds_to_three_decimals(self):
        self.assertEqual(last5([1], {1: {1: 1}, 2: {1: 1}, 3: {1: 2}}), {1: 1.333})


class NextDeadline(unittest.TestCase):
    events = [
        {"id": 10, "deadline_time": "2026-11-06T18:30:00Z"},
        {"id": 11, "deadline_time": "2026-11-21T11:00:00Z"},
        {"id": 12, "deadline_time": None},
    ]

    def test_finds_the_earliest_deadline_after_now(self):
        now = datetime(2026, 11, 10, tzinfo=timezone.utc)
        gw, deadline = next_deadline(self.events, now)
        self.assertEqual((gw, deadline.isoformat()), (11, "2026-11-21T11:00:00+00:00"))

    def test_none_after_the_last_deadline(self):
        self.assertIsNone(next_deadline(self.events, datetime(2027, 6, 1, tzinfo=timezone.utc)))


if __name__ == "__main__":
    unittest.main()
