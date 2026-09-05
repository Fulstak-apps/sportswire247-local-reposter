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
    def ranked(self, caption, views=50_000, shortcode="CLIP1", source_url=None, likes=0, comments=0):
        return score({
            **BASE,
            "shortcode": shortcode,
            "sourceCaption": caption,
            "sourceViewCount": views,
            "sourceLikeCount": likes,
            "sourceCommentCount": comments,
            "sourceUrl": source_url or BASE["sourceUrl"],
        }, NOW)

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

    def test_player_name_can_identify_sport_when_caption_omits_league(self):
        item = self.ranked("Steph hit the game winner from the logo", 2_000_000)
        self.assertEqual(item["league"], "nba")
        self.assertEqual(item["sportCategory"], "basketball")
        self.assertTrue(item["eligibleForAutoPost"])

    def test_source_url_can_identify_college_football(self):
        item = self.ranked(
            "Rocky Beers got UP for this TD",
            0,
            source_url="https://www.instagram.com/br_cfb/p/example/",
        )
        self.assertEqual(item["league"], "ncaa_football")
        self.assertEqual(item["sportCategory"], "football")

    def test_engagement_rescues_viral_signal_when_views_are_hidden(self):
        quiet = self.ranked("NFL touchdown", views=0, shortcode="QUIET")
        hot = self.ranked(
            "NFL touchdown",
            views=0,
            shortcode="HOT",
            likes=180_000,
            comments=12_000,
        )
        self.assertGreater(hot["engagementScore"], 0)
        self.assertGreater(hot["deterministicScore"], quiet["deterministicScore"])
        self.assertGreater(hot["highlightQuality"], quiet["highlightQuality"])
        self.assertTrue(hot["eligibleForAutoPost"])

    def test_engagement_is_bounded_when_views_are_already_available(self):
        no_engagement = self.ranked("NBA dunk", views=2_000_000, shortcode="A")
        with_engagement = self.ranked(
            "NBA dunk", views=2_000_000, shortcode="B", likes=300_000, comments=20_000
        )
        self.assertGreater(with_engagement["deterministicScore"], no_engagement["deterministicScore"])
        self.assertLess(with_engagement["engagementScore"], 12)

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

    def test_elite_clips_keep_rank_separation_above_100(self):
        monster = self.ranked("NBA game winner poster dunk in Game 7 goes viral", 20_000_000, "MONSTER")
        great = self.ranked("NBA game winner dunk", 2_000_000, "GREAT")
        self.assertEqual(monster["viralScore"], 100.0)
        self.assertGreater(monster["deterministicScore"], 100.0)
        self.assertGreater(monster["deterministicScore"], great["deterministicScore"])
        self.assertEqual(select_best([great, monster])[0]["shortcode"], "MONSTER")

    def test_v2_score_is_explainable(self):
        item = self.ranked("NFL wild one-handed catch touchdown", 1_000_000)
        for field in (
            "viralScore", "rawScore", "engagementScore", "highlightQuality", "postingFloor", "highlightFloor",
            "scoreMargin", "priority", "contentKind", "sportRank", "scoreReasons", "rankingVersion"
        ):
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
