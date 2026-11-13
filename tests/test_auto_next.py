"""Auto-next integration checks; actual iframe behaviour needs browser tests."""
from pathlib import Path
import shutil
import subprocess
import unittest
ROOT=Path(__file__).resolve().parents[1]
class AutoNextTests(unittest.TestCase):
    def setUp(self):
        self.js=(ROOT/"site/app.js").read_text(encoding="utf-8")
        self.html=(ROOT/"site/index.html").read_text(encoding="utf-8")
    def test_toggle_position_and_focus(self):
        self.assertLess(self.html.index('id="next"'),self.html.index('id="auto-next"'))
        self.assertLess(self.html.index('id="auto-next"'),self.html.index('id="player-appearance"'))
        self.assertIn('id="auto-next" type="checkbox" role="switch"',self.html)
        trap=self.js.split('const controls = [',1)[1].split('];',1)[0]
        self.assertIn('$("auto-next")',trap)
    def test_default_on_and_private_preference(self):
        block=self.js.split('function autoNextState()',1)[1].split('function nextAutoVideoID(',1)[0]
        self.assertIn('enabled:true',block)
        self.assertNotIn('localStorage',block)
        initializer=self.js.split('(function initializeAutoNext()',1)[1].split('})();',1)[0]
        self.assertIn('state.enabled = toggle.checked',initializer)
        self.assertNotIn('localStorage',initializer)
    def test_end_event_and_stale_frame_guards(self):
        block=self.js.split('function attachSpeedController(',1)[1].split('function reportPlaybackSpeed(',1)[0]
        self.assertIn('event.data === 0 && !endedHandled',block)
        self.assertIn('if (!valid() || !autoNextState().enabled) return;',block)
        self.assertIn('state.player.getPlayerState() !== 0',block)
        self.assertIn('onAutoplayBlocked:',block)
    def test_approval_and_freshness(self):
        block=self.js.split('function advanceAutoNext()',1)[1].split('(function initializeAutoNext()',1)[0]
        for text in ('freshFeed(feed)','draftAllows(video.channelId)','categoryAllows(video.channelId)','feed.channels.some','feed.videos.some','$("player").hidden'):
            self.assertIn(text,block)
        self.assertNotIn('fetch(',block)
    @unittest.skipUnless(shutil.which('node'),'Node.js unavailable')
    def test_executable_nonwrapping_selection(self):
        block='function nextAutoVideoID('+self.js.split('function nextAutoVideoID(',1)[1].split('function advanceAutoNext()',1)[0]
        program=block+r"""
const items=[{id:'a'},{id:'b'},{id:'c'}];
if(nextAutoVideoID(items,'a',()=>true)!=='b')process.exit(1);
if(nextAutoVideoID(items,'c',()=>true)!==null)process.exit(2);
if(nextAutoVideoID(items,'missing',()=>true)!==null)process.exit(3);
if(nextAutoVideoID(items,'a',v=>v.id==='c')!=='c')process.exit(4);
if(nextAutoVideoID(items,'a',()=>false)!==null)process.exit(5);
"""
        result=subprocess.run([shutil.which('node'),'-e',program],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
if __name__=='__main__':unittest.main()
