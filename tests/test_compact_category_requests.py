"""Compact category changes preserve unrelated data. No live network calls."""
import copy
import json
from pathlib import Path
import shutil
import subprocess
import sys
import unittest
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT/"scripts") not in sys.path: sys.path.insert(0,str(ROOT/"scripts"))
import category_request as c
import process_category_request as p
from test_shared_category_backend import event, encoded, SHA
A="UC"+"a"*22
B="UC"+"b"*22
C="UC"+"c"*22
MODEL={"version":1,"categories":[{"id":"cat-0","name":"News"},{"id":"cat-3","name":"Music"}],"assignments":{B:["cat-0"],C:["cat-3"]}}
def request(operations): return {"baseRevision":SHA,"operations":operations}
def operation(cid=A,tags=None): return {"op":"setChannelCategories","channelId":cid,"categoryIds":["cat-3"] if tags is None else tags}
class CompactCategoryTests(unittest.TestCase):
    def test_single_assignment_preserves_everything_else(self):
        original=copy.deepcopy(MODEL)
        result=c.apply_request(MODEL,request([operation()]),{A,B})
        self.assertEqual(result["assignments"],{**MODEL["assignments"],A:["cat-3"]})
        self.assertEqual(result["categories"],MODEL["categories"])
        self.assertEqual(MODEL,original)
    def test_clear_assignment_and_delete_category(self):
        result=c.apply_request(MODEL,request([operation(B,[])]),{A,B})
        self.assertNotIn(B,result["assignments"])
        definitions=[{"id":"cat-3","name":"Music & Audio"}]
        result=c.apply_request(MODEL,request([{"op":"setCategories","categories":definitions}]),{A,B})
        self.assertNotIn(B,result["assignments"])
        self.assertEqual(result["assignments"][C],["cat-3"])
    def test_invalid_operations_fail_closed(self):
        for ops in ([],[operation(),operation()], [{"op":"deleteWhitelist"}], [operation("bad")], [operation(tags=["cat-missing"])], [operation(C)]):
            with self.subTest(ops=ops):
                with self.assertRaises(ValueError): c.apply_request(MODEL,request(ops),{A,B})
    def test_operations_issue_end_to_end_and_reuse(self):
        e=event(); req=request([operation()])
        e["issue"]["body"]="### Category request\n\n```json\n"+json.dumps(req)+"\n```\n\n### Confirmation\n\n- [x] "+c.CONFIRMATION
        self.assertEqual(c.authorize_event(e)[1],req)
        calls=[]
        def call(method,path,payload=None):
            calls.append((method,path,payload))
            if "/issues/" in path: return copy.deepcopy(e["issue"])
            if method=="GET" and "/contents/categories.json" in path: return encoded("categories.json",MODEL)
            if method=="GET" and "/contents/channels.json" in path: return encoded("channels.json",{"channels":[{"id":A},{"id":B}]})
            return {}
        p.process(e,call)
        puts=[x for x in calls if x[0]=="PUT"]
        self.assertEqual(len(puts),1)
        import base64
        saved=json.loads(base64.b64decode(puts[0][2]["content"]))
        self.assertEqual(saved["assignments"][B],MODEL["assignments"][B])
        self.assertEqual(calls[-1][2]["inputs"],{"reuse_published_feed":"true"})
    def test_compact_review_wiring(self):
        js=(ROOT/"site/app.js").read_text(encoding="utf-8")
        html=(ROOT/"site/index.html").read_text(encoding="utf-8")
        self.assertIn('id="category-review-details"',html)
        self.assertIn('id="category-review-changes"',html)
        self.assertNotIn('id="category-review-details" open',html)
        block=js.split('function prepareSharedCategoryRequest()',1)[1].split('(function initializeSharedCategoryControls()',1)[0]
        self.assertIn('baseRevision:state.baseRevision,operations',block)
        self.assertNotIn('model:state.model',block)
    @unittest.skipUnless(shutil.which("node"),"Node.js unavailable")
    def test_executable_frontend_diff(self):
        js=(ROOT/"site/app.js").read_text(encoding="utf-8")
        code=js.split('function compactCategoryOperations(',1)[1].split('function categoryChangeSummary(',1)[0]
        code='function compactCategoryOperations('+code
        code+='\nconst before='+json.dumps(MODEL)+';\n'
        code+='const after=JSON.parse(JSON.stringify(before));after.assignments['+json.dumps(A)+']=["cat-3"];\n'
        code+='const ops=compactCategoryOperations(before,after);if(ops.length!==1 || ops[0].channelId!=='+json.dumps(A)+')process.exit(1);\n'
        code+='const same=JSON.parse(JSON.stringify(before));if(compactCategoryOperations(before,same).length)process.exit(2);\n'
        result=subprocess.run([shutil.which("node"),"-e",code],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
if __name__=="__main__":unittest.main()
