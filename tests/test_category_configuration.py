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
        parser=IDs();parser.feed(self.html)
        self.assertEqual(len(parser.ids),len(set(parser.ids)))
        for name in ('category-tabs','category-filter','category-menu','configuration-toggle','configuration-dialog','whitelist-dialog','refresh','whitelist-manager'):
            self.assertIn(name,parser.ids)
        header=self.html.split('<header>',1)[1].split('</header>',1)[0]
        self.assertNotIn('id="refresh"',header)
        self.assertLess(self.html.index('id="category-tabs"'),self.html.index('id="configuration-toggle"'))
        self.assertLess(self.html.index('id="configuration-toggle"'),self.html.index('id="refresh"'))
    def test_existing_nodes_and_saving_preserved(self):
        self.assertIn('$("whitelist-dialog-content").append(manager)',self.js)
        self.assertIn('manager.open = true',self.js)
        self.assertIn('select.dispatchEvent(new Event("change", {bubbles:true}))',self.js)
        self.assertIn('select.replaceChildren(new Option("All", "all"))',self.js)
        self.assertIn('aria-label="Filter by category"',self.html)
        self.assertNotIn('innerHTML',self.js)
    def test_labels_and_title(self):
        self.assertIn('placeholder="Search by channel name or UC channel ID"',self.html)
        self.assertIn('placeholder="UC channel ID or YouTube channel URL"',self.html)
        self.assertIn('<title>MyTube</title>',self.html)
        self.assertIn('<h1 id="title">MyTube</h1>',self.html)
    def test_dialog_and_focus_guards(self):
        self.assertIn('$("configuration-dialog")?.open || $("whitelist-dialog")?.open',self.js)
        self.assertIn('$("configuration-toggle").focus()',self.js)
        self.assertIn('dialog.addEventListener("keydown", event => event.stopPropagation())',self.js)
        css=(ROOT/'site/style.css').read_text(encoding='utf-8').split('/* Category browsing tabs',1)[1]
        self.assertNotIn('#player',css)
        self.assertNotIn('#frame',css)
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
