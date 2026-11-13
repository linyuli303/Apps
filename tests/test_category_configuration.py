"""Category tabs/configuration wiring; real browser checks remain necessary."""
from pathlib import Path
from html.parser import HTMLParser
import shutil
import subprocess
import unittest
ROOT=Path(__file__).resolve().parents[1]
class IDs(HTMLParser):
    def __init__(self):super().__init__();self.ids=[]
    def handle_starttag(self,tag,attrs):
        for key,value in attrs:
            if key=='id':self.ids.append(value)
class CategoryConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.js=(ROOT/'site/app.js').read_text(encoding='utf-8')
        self.html=(ROOT/'site/index.html').read_text(encoding='utf-8')
    def test_unique_ids_and_toolbar_order(self):
        parser = IDs()
        parser.feed(self.html)
        self.assertEqual(len(parser.ids), len(set(parser.ids)))
        for name in (
            "title", "search", "video-source", "channel", "sort",
            "category-tabs", "category-filter", "category-menu",
            "configuration-toggle", "configuration-dialog",
            "whitelist-dialog", "refresh", "whitelist-manager",
        ):
            self.assertIn(name, parser.ids)
        toolbar = self.html.split(
            '<section class="toolbar landing-toolbar"', 1
        )[1].split("</section>", 1)[0]
        self.assertNotIn('class="landing-brand"', toolbar)
        self.assertNotIn('id="title"', toolbar)
        order = (
            "search", "channel", "video-source", "sort",
            "refresh", "configuration-toggle",
        )
        positions = [toolbar.index(f'id="{name}"') for name in order]
        self.assertEqual(positions, sorted(positions))
        self.assertIn('class="apps-filter-controls"', toolbar)
        actions = toolbar.split(
            '<div class="category-toolbar-actions">', 1
        )[1].split("</div>", 1)[0]
        self.assertIn('id="configuration-toggle"', actions)
        self.assertIn('id="refresh"', actions)
        self.assertIn(
            'document.querySelector(".myapps-header-actions")', self.js
        )
        self.assertIn(
            "actions.append(picker, appearanceToggle, announce); "
            "header.prepend(actions);", self.js
        )
        self.assertLess(
            self.html.index('id="refresh"'),
            self.html.index('id="category-tabs"'),
        )
    def test_compact_branding_and_filter_labels(self):
        header = self.html.split(
            '<div class="myapps-header" role="banner">', 1
        )[1].split('<section class="toolbar landing-toolbar"', 1)[0]
        self.assertIn('src="icon.svg" width="42" height="42"', header)
        self.assertIn(
            '<h1 id="title">MyApps</h1><sup>Yuli</sup>', header
        )
        self.assertIn('aria-label="Applications"', header)
        for app in ("MyTube", "MySpotify", "MyPodcasts"):
            self.assertIn(app, header)
        toolbar = self.html.split(
            '<section class="toolbar landing-toolbar"', 1
        )[1].split("</section>", 1)[0]
        for caption in ("Search your feed", "Channel", "Sort", "Video source"):
            self.assertIn(
                f'<span class="sr-only">{caption}</span>', toolbar
            )
        css = (ROOT / "site/style.css").read_text(encoding="utf-8")
        self.assertIn(
            "grid-template-columns:minmax(0,1fr) minmax(0,1fr)", css
        )
        self.assertIn(
            'const heading = element("span", "sr-only");', self.js
        )
        self.assertIn(
            'appearanceToggle.setAttribute("aria-label",', self.js
        )

    def test_feed_notices_collapsed_and_preserved(self):
        opening='<details class="feed-information">'
        self.assertIn(opening,self.html)
        details=self.html.split(opening,1)[1].split('</details>',1)[0]
        summary=details.split('<summary>',1)[1].split('</summary>',1)[0]
        self.assertIn('id="status" role="status"',summary)
        self.assertIn('Playback, refresh schedule &amp; API quota',summary)
        for name in ('playback-notice','refresh-schedule-notice','api-quota-notice'):
            self.assertIn(f'class="{name}"',details)
            self.assertNotIn(f'class="{name}"',summary)

    def test_player_background_uses_existing_main_not_removed_header(self):
        self.assertNotIn('document.querySelector("header")',self.js)
        for value in ('true','false'):
            self.assertIn(f'document.querySelector("main").inert = {value};',self.js)
            self.assertIn(f'$("rss-catalogue").inert = {value};',self.js)
        main=self.html.split('<main>',1)[1].split('</main>',1)[0]
        self.assertIn('class="landing-brand"',main)

    def test_existing_nodes_and_saving_preserved(self):
        self.assertIn('$("whitelist-dialog-content").append(manager)',self.js)
        self.assertIn('manager.open = true',self.js)
        self.assertIn('select.dispatchEvent(new Event("change", {bubbles:true}))',self.js)
        self.assertIn('select.replaceChildren(new Option("All", "all"))',self.js)
        self.assertIn('aria-label="Filter by category"',self.html)
        self.assertNotIn('innerHTML',self.js)
    def test_labels_and_title(self):
        self.assertIn(
            'placeholder="Search by channel name or UC channel ID"',
            self.html,
        )
        self.assertIn(
            'placeholder="UC channel ID or YouTube channel URL"',
            self.html,
        )
        self.assertIn("<title>MyApps</title>", self.html)
        self.assertIn('<h1 id="title">MyApps</h1>', self.html)
        self.assertIn(
            'document.title = "MyApps";', self.js
        )
    def test_dialog_and_focus_guards(self):
        self.assertIn(
            '$("configuration-dialog")?.open || $("whitelist-dialog")?.open',
            self.js,
        )
        self.assertIn('$("configuration-toggle").focus()', self.js)
        self.assertIn(
            'dialog.addEventListener("keydown", event => event.stopPropagation())',
            self.js,
        )

        source = (ROOT / 'site/style.css').read_text(encoding='utf-8')
        start = '/* Category browsing tabs'
        end = '/* Consistent configuration and management typography. */'

        self.assertEqual(source.count(start), 1)
        self.assertEqual(source.count(end), 1)
        first = source.index(start)
        last = source.index(end, first)
        css = source[first:last]

        self.assertNotIn('#player', css)
        self.assertNotIn('#frame', css)
    @unittest.skipUnless(shutil.which('node'),'Node.js unavailable')
    def test_executable_tabs(self):
        function='function renderCategoryTabs('+self.js.split('function renderCategoryTabs(',1)[1].split('(function initializeConfiguration()',1)[0]
        program=r"""
const document={activeElement:null};
function Event(type){this.type=type}
function element(){return {dataset:{},attrs:{},setAttribute(k,v){this.attrs[k]=v},addEventListener(k,fn){this[k]=fn},focus(){document.activeElement=this}}}
const select={value:'all',options:[{value:'all',textContent:'All'},{value:'cat-0',textContent:'Music'},{value:'uncategorized',textContent:'Uncategorized'}],dispatchEvent(){}};
const tabs={children:[],scrollLeft:0,contains(el){return this.children.includes(el)},replaceChildren(){this.children=[]},append(el){this.children.push(el)}};
const $=id=>id==='category-filter'?select:tabs;
"""+function+r"""
renderCategoryTabs();
if(tabs.children.length!==3||tabs.children[0].textContent!=='All'||tabs.children[0].attrs['aria-pressed']!=='true')process.exit(1);
tabs.children[1].click();
if(select.value!=='cat-0'||tabs.children[1].attrs['aria-pressed']!=='true')process.exit(2);
select.options.splice(1,1);select.value='all';renderCategoryTabs();
if(tabs.children.length!==2||tabs.children[0].attrs['aria-pressed']!=='true')process.exit(3);
"""
        result=subprocess.run([shutil.which('node'),'-e',program],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
if __name__=='__main__':unittest.main()
