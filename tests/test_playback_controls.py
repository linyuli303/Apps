"""Playback controls regression checks; actual iframe interaction needs browser tests."""
from pathlib import Path
import shutil
import subprocess
import unittest
ROOT=Path(__file__).resolve().parents[1]
class PlaybackControlsTests(unittest.TestCase):
    def setUp(self):
        self.js=(ROOT/'site/app.js').read_text(encoding='utf-8')
        self.html=(ROOT/'site/index.html').read_text(encoding='utf-8')
    def test_position_and_accessibility(self):
        for name in ('previous','next','loop-video','skip-short-videos'):
            self.assertIn('id="'+name+'"',self.html)
            self.assertIn('$("'+name+'")',self.js.split('const controls = [',1)[1].split('].filter',1)[0])
        self.assertLess(self.html.index('id="skip-short-videos"'),self.html.index('id="player-category-toggle"'))
        self.assertIn('aria-pressed="false"',self.html)
    def test_default_and_filter_coverage(self):
        self.assertIn('let skipShort = true;',self.js)
        self.assertIn('seconds === null || seconds >= 60',self.js)
        self.assertIn('visible = visible.filter(shortVideoAllows);',self.js)
        self.assertIn('group && shortVideoAllows(video)',self.js)
        self.assertIn('shortVideoAllows(video) && safeID(video.id)',self.js)
    def test_loop_and_duration(self):
        block=self.js.split('if (event.data === 0 && !endedHandled)',1)[1].split('onAutoplayBlocked:',1)[0]
        self.assertLess(block.index('if (playbackOptions().loop)'),block.index('if (!autoNextState().enabled)'))
        self.assertIn('state.player.seekTo(0, true)',block)
        self.assertIn('state.player.playVideo()',block)
        self.assertIn('playbackDurationLabel(v.duration)',self.js)
        self.assertIn('playbackDurationLabel(video.duration)',self.js)
    @unittest.skipUnless(shutil.which('node'),'Node.js unavailable')
    def test_navigation_and_skip_execution(self):
        code='function adjacentApprovedID('+self.js.split('function adjacentApprovedID(',1)[1].split('function updatePlaybackNavigation()',1)[0]
        code+='function shortVideoAllows('+self.js.split('function shortVideoAllows(',1)[1].split('function viewsForDuration(',1)[0]
        code+=r"""
function playbackOptions(){return {skipShort:true}}
function playbackDurationSeconds(v){return v}
if(shortVideoAllows({duration:59})||!shortVideoAllows({duration:60})||!shortVideoAllows({duration:null}))process.exit(1);
const list=[{id:'a'},{id:'b'},{id:'c'}];
if(adjacentApprovedID(list,'a',-1,()=>true)!=='c')process.exit(2);
if(adjacentApprovedID(list,'a',1,v=>v.id==='c')!=='c')process.exit(3);
if(adjacentApprovedID([{id:'a'}],'a',1,()=>true)!==null)process.exit(4);
if(adjacentApprovedID(list,'missing',1,()=>true)!=='a')process.exit(5);
"""
        result=subprocess.run([shutil.which('node'),'-e',code],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
if __name__=='__main__':unittest.main()
