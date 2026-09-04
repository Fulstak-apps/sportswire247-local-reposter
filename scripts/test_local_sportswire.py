import sys, unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
from sportswire_local.ranking import classify, fingerprint, score
from sportswire_local.qa import evaluate
from sportswire_local.ollama import generate

BASE = {
    "shortcode": "SPORT1", "sourceHandle": "houseofhighlights",
    "sourceUrl": "https://www.instagram.com/houseofhighlights/reel/SPORT1/",
    "sourceCaption": "Steph hit the game winner from the logo.",
    "publishCaption": "Steph hit the game winner from the logo.\n\nSource: @houseofhighlights",
    "localVideoPath": "/tmp/sportswire-test.mp4"
}

class SportsWireTests(unittest.TestCase):
    @patch("sportswire_local.qa.media_probe", return_value=(True, "video/audio verified"))
    def test_complete_video_can_be_ready(self, _):
        self.assertTrue(evaluate({**score(BASE), "publishCaption": BASE["publishCaption"]}, {"houseofhighlights"})["ready"])

    @patch("sportswire_local.qa.media_probe", return_value=(False, "missing media"))
    def test_missing_media_never_ready(self, _):
        self.assertFalse(evaluate(score(BASE), {"houseofhighlights"})["ready"])

    @patch("sportswire_local.qa.media_probe", return_value=(True, "ok"))
    def test_unsupported_source_rejected(self, _):
        self.assertIn("unsupported source", evaluate(score(BASE), {"sportscenter"})["reasons"])

    @patch("sportswire_local.qa.media_probe", return_value=(True, "ok"))
    def test_serious_injury_tone_protected(self, _):
        item = {**score({**BASE, "sourceCaption": "Player in critical condition."}), "publishCaption": "Player in critical condition 😂"}
        self.assertIn("serious-content tone violation", evaluate(item, {"houseofhighlights"})["reasons"])

    @patch("sportswire_local.qa.media_probe", return_value=(True, "ok"))
    def test_injury_overclaim_rejected(self, _):
        item = {**score({**BASE, "sourceCaption": "Player is questionable."}), "publishCaption": "Player has a torn ACL."}
        self.assertIn("injury claim exceeds evidence", evaluate(item, {"houseofhighlights"})["reasons"])

    def test_viral_clip_ranks_above_routine_item(self):
        now = datetime(2026, 9, 3, tzinfo=timezone.utc)
        viral = score({**BASE, "sourceViewCount": 15_000_000, "sourcePublishedAt": "2026-09-03T00:00:00Z"}, now)
        routine = score({**BASE, "sourceCaption": "Routine roster update", "sourceViewCount": None}, now)
        self.assertGreater(viral["deterministicScore"], routine["deterministicScore"])

    def test_league_and_fingerprint(self):
        self.assertEqual(classify("NBA game winner"), "nba")
        self.assertEqual(fingerprint("Same! Highlight"), fingerprint("same highlight"))

    @patch("sportswire_local.ollama.subprocess.run", side_effect=OSError("offline"))
    def test_ollama_unavailable_fails_to_caller_fallback(self, _):
        with self.assertRaises(OSError): generate({"ollama": {"url": "http://127.0.0.1:11434", "model": "qwen3:4b"}}, BASE)

if __name__ == "__main__": unittest.main()
