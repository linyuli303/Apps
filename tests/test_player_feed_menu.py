"""Playback Feed menu checks; actual DOM/iframe behaviour requires browser testing."""
from pathlib import Path
import shutil
import subprocess
import unittest
ROOT=Path(__file__).resolve().parents[1]
class PlayerFeedMenuTests(unittest.TestCase):
    def setUp(self):
        self.js=(ROOT/"site/app.js").read_text(encoding="utf-8")
        self.html=(ROOT/"site/index.html").read_text(encoding="utf-8")
        self.css=(ROOT/"site/style.css").read_text(encoding="utf-8")
    def test_order_and_accessible_collapsed_menu(self):
        self.assertLess(self.html.index('id="player-category-toggle"'),self.html.index('id="player-feed-toggle"'))
        self.assertLess(self.html.index('id="player-feed-toggle"'),self.html.index('id="close"'))
        self.assertIn('aria-controls="player-feed-panel"',self.html)
        self.assertIn('id="player-feed-panel" aria-labelledby="player-feed-heading" hidden',self.html)
        self.assertIn('aria-label="Show feed"',self.html)
    def test_eligibility_and_click_revalidation(self):
        block=self.js.split('function playbackFeedItems()',1)[1].split('function closePlayerFeed(',1)[0]
        for text in ('freshFeed(feed)','draftAllows(video.channelId)','categoryAllows(video.channelId)','membership.get(video.id)','$("player").hidden'):
            self.assertIn(text,block)
        self.assertIn('if (!playbackFeedItems().some(item => item.id === video.id))',self.js)
        self.assertIn('items.slice(state.page * 48, (state.page + 1) * 48)',self.js)
    def test_lifecycle_keyboard_and_focus(self):
        self.assertIn('function openPlayer(id) {\n  closePlayerFeed(false);',self.js)
        self.assertIn('function closePlayer() {\n  closePlayerFeed(false);',self.js)
        self.assertIn('closePlayerFeed(true)',self.js)
        self.assertIn('panel.addEventListener("keydown"',self.js)
        trap=self.js.split('const controls = [',1)[1].split('];',1)[0]
        self.assertIn('$("player-feed-toggle")',trap)
        self.assertIn('$("player-feed-panel").querySelectorAll("button")',trap)
    def test_overlay_without_frame_rules_or_network(self):
        css=self.css.split('/* Playback feed popover:',1)[1]
        self.assertIn('position:fixed',css)
        self.assertNotIn('#frame',css)
        self.assertNotIn('.kino',css)
        js=self.js.split('// Playback Feed menu:',1)[1]
        self.assertNotIn('fetch(',js)
        self.assertNotIn('innerHTML',js)
    @unittest.skipUnless(shutil.which('node'),'Node.js unavailable')
    def test_duration_parser_execution(self):
        code='function playbackDurationSeconds('+self.js.split('function playbackDurationSeconds(',1)[1].split('function playbackFeedItems()',1)[0]
        code+=r"""
for(const [input,seconds,label] of [
 ['PT35S',35,'0:35'],['PT1M',60,'1:00'],['PT1H2M15S',3735,'1:02:15'],
 ['P1DT2H',93600,'26:00:00'],['PT0S',0,'0:00'],['PT0.5S',0.5,'0:00'],
 ['',null,'Unavailable'],['PT',null,'Unavailable'],['bad',null,'Unavailable'],[null,null,'Unavailable']]) {
 if(playbackDurationSeconds(input)!==seconds || playbackDurationLabel(input)!==label)process.exit(1);
}
"""
        result=subprocess.run([shutil.which('node'),'-e',code],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
if __name__=='__main__':unittest.main()
