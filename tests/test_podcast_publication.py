"""Offline guards for podcast collection in the existing publication job."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]

class PodcastPublicationTests(unittest.TestCase):
    def workflow(self):
        return (ROOT / '.github/workflows/publish.yml').read_text(encoding='utf-8')

    def test_collection_between_youtube_and_packaging(self):
        source = self.workflow()
        youtube = source.index('run: python scripts/build_feed.py')
        podcast = source.index('run: python scripts/build_podcasts.py --fetch --output site/data/podcasts.json')
        packaging = source.index('run: python scripts/prepare_site.py')
        upload = source.index('- name: Upload Pages artifact')
        self.assertLess(youtube, podcast)
        self.assertLess(podcast, packaging)
        self.assertLess(packaging, upload)

    def test_podcast_step_has_no_secrets_or_failure_bypass(self):
        source = self.workflow()
        step = source.split('      - name: Collect approved podcast RSS metadata (no audio downloads)',1)[1].split('      - name:',1)[0]
        self.assertNotIn('secrets.', step)
        self.assertNotIn('env:', step)
        self.assertNotIn('continue-on-error', step)
        self.assertNotIn('||', step)
        self.assertIn('--fetch --output site/data/podcasts.json', step)

    def test_api_key_stays_on_youtube_step(self):
        source = self.workflow()
        self.assertEqual(source.count('YOUTUBE_API_KEY:'),1)
        step = source.split('      - name: Fetch approved-channel snapshot',1)[1].split('      - name:',1)[0]
        self.assertIn('YOUTUBE_API_KEY: ${{ secrets.YOUTUBE_API_KEY }}',step)
        self.assertIn('run: python scripts/build_feed.py',step)

    def test_published_asset_boundary_retained(self):
        source = (ROOT / 'scripts/prepare_site.py').read_text(encoding='utf-8')
        self.assertIn('ASSETS=("index.html","style.css","app.js","icon.svg","data/feed.json")',source)
        self.assertIn('package_podcasts(ROOT, public_js)',source)

    def test_scheduled_gate_and_diagnostics_still_present(self):
        source = self.workflow()
        self.assertIn('  schedule-diagnostics:',source)
        self.assertIn("github.event.schedule",source)
        self.assertIn('vars.YOUTUBE_REFRESH_HOURS_UTC',source)
        self.assertEqual(len(re.findall(r'^    - cron:',source,re.M)),24)
