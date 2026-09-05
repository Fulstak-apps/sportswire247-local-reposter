import sys, unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
from sportswire_local.ranking import (
    SPORT_POLICIES, apply_history_penalties, classify, score, select_best
)
from sportswire_local.qa import evaluate

NOW = datetime(2026, 9, 4, 20, 0, tzinfo=timezone.utc)
BASE = {
    "shortcode": "CLIP1",
    "sourceHandle": "houseofhighlights",
    "sourceUrl": "https://www.instagram.com/houseofhighlights/reel/CLIP1/",
    "sourcePublishedAt": "2026-09-04T18:00:00Z",
    "localVideoPath": "/tmp/sportswire-v2-test.mp4",
}

class SportsWireV2RankingTests(unittest.TestCase):
    def ranked(self, caption, views=50_000, shortcode="CLIP1"):
        return score({**BASE, "shortcode": shortcode, "sourceCaption": caption, "sourceViewCount": views}, NOW)

    def test_sport_posting_floors_follow_user_priority(self):
        self.assertLess(SPORT_POLICIES["basketball"]["score_floor"], SPORT_POLICIES["football"]["score_floor"])
        self.assertLess(SPORT_POLICIES["football"]["score_floor"], SPORT_POLICIES["mlb"]["score_floor"])
        self.assertLess(SPORT_POLICIES["mlb"]["score_floor"], SPORT_POLICIES["hockey"]["score_floor"])

    def test_lower_ranked_sport_requires_better_highlight(self):
        basketball = self.ranked("NBA dunk", 20_000)
        football = self.ranked("NFL touchdown", 20_000)
        baseball = self.ranked("MLB home run", 20_000)
        self.assertTrue(basketball["eligibleForAutoPost"])
        self.assertFalse(football["eligibleForAutoPost"])
        self.assertFalse(baseball["eligibleForAutoPost"])
        self.assertLess(basketball["highlightFloor"], football["highlightFloor"])
        self.assertLess(football["highlightFloor"], baseball["highlightFloor"])

    def test_elite_hockey_can_beat_weak_basketball(self):
        hockey = self.ranked("NHL overtime winner goalie robbery goes wild", 500_000, "HOCKEY")
        basketball = self.ranked("NBA routine game clip", 1_000, "BASKET")
        self.assertTrue(hockey["eligibleForAutoPost"])
        self.assertFalse(basketball["eligibleForAutoPost"])
        self.assertGreater(hockey["deterministicScore"], basketball["deterministicScore"])
        self.assertEqual(select_best([basketball, hockey])[0]["shortcode"], "HOCKEY")

    def test_weak_hockey_highlight_is_held_even_when_total_score_is_decent(self):
        hockey = self.ranked("NHL regular season goal", 50_000)
        self.assertGreaterEqual(hockey["deterministicScore"], hockey["postingFloor"])
        self.assertLess(hockey["highlightQuality"], hockey["highlightFloor"])
        self.assertFalse(hockey["eligibleForAutoPost"])

    def test_wnba_does_not_get_misclassified_as_nba_substring(self):
        self.assertEqual(classify("WNBA buzzer beater"), "wnba")

    def test_non_target_sport_is_not_autoposted(self):
        soccer = self.ranked("Premier League viral goal", 20_000_000)
        self.assertEqual(soccer["sportCategory"], "other")
        self.assertFalse(soccer["eligibleForAutoPost"])

    def test_near_duplicate_gets_penalized(self):
        item = self.ranked("NBA Steph Curry game winner from the logo", 2_000_000, "NEW")
        history = [{"shortcode": "OLD", "sourceCaption": "Steph Curry NBA game winner from the logo"}]
        penalized = apply_history_penalties([item], history)[0]
        self.assertEqual(penalized["duplicateOf"], "OLD")
        self.assertLess(penalized["deterministicScore"], item["deterministicScore"])

    def test_same_shortcode_is_not_penalized_against_itself(self):
        item = self.ranked("NBA Steph Curry game winner from the logo", 2_000_000, "SAME")
        history = [{"shortcode": "SAME", "sourceCaption": "NBA Steph Curry game winner from the logo"}]
        penalized = apply_history_penalties([item], history)[0]
        self.assertNotIn("duplicateOf", penalized)
        self.assertEqual(penalized["deterministicScore"], item["deterministicScore"])

    def test_v2_score_is_explainable(self):
        item = self.ranked("NFL wild one-handed catch touchdown", 1_000_000)
        for field in ("viralScore", "highlightQuality", "postingFloor", "highlightFloor", "priority", "contentKind", "sportRank", "scoreReasons", "rankingVersion"):
            self.assertIn(field, item)
        self.assertEqual(item["rankingVersion"], "sportswire-newsroom-v2")

    @patch("sportswire_local.qa.media_probe", return_value=(True, "ok"))
    def test_serious_story_requires_reporting_verification(self, _):
        item = self.ranked("NBA player in critical condition after medical emergency", 3_000_000)
        item["publishCaption"] = "NBA player in critical condition after medical emergency."
        result = evaluate(item, {"houseofhighlights"})
        self.assertIn("serious/legal reporting not verified", result["reasons"])

if __name__ == "__main__":
    unittest.main()
