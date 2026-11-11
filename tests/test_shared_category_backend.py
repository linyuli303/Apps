"""Offline tests: no GitHub or Google network access."""
import base64
import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))
import category_request as c
import process_category_request as p

A = "UC" + "a" * 22
SHA = "a" * 40
MODEL = {"version": 1, "categories": [{"id": "cat-0", "name": "News"}], "assignments": {A: ["cat-0"]}}

def event():
    body = "### Category request\n\n```json\n" + json.dumps({"baseRevision": SHA, "model": MODEL}) + "\n```\n\n### Confirmation\n\n- [x] " + c.CONFIRMATION
    owner = {"login": "linyuli303", "id": 42029941, "type": "User"}
    return {"action": "opened", "repository": {"full_name": "linyuli303/MyTube", "default_branch": "main", "owner": owner}, "sender": owner,
            "issue": {"number": 123, "title": c.TITLE, "state": "open", "user": owner, "body": body, "updated_at": "2026-01-01T00:00:00Z"}}

def encoded(name, model, sha=SHA):
    return {"path": name, "type": "file", "encoding": "base64", "sha": sha, "content": base64.b64encode(json.dumps(model).encode()).decode()}

class SharedCategoryBackendTests(unittest.TestCase):
    def test_model_and_repository_defaults(self):
        c.validate_model(MODEL, {A})
        c.validate_model(json.loads((ROOT / "categories.json").read_text(encoding="utf-8")))

    def test_invalid_models(self):
        variants = []
        for key, value in [("version", True), ("categories", [{"id": "cat-0", "name": "Uncategorized"}]), ("assignments", {A: ["cat-missing"]})]:
            m = copy.deepcopy(MODEL); m[key] = value; variants.append(m)
        m = copy.deepcopy(MODEL); m["categories"].append({"id": "cat-1", "name": "news"}); variants.append(m)
        for m in variants:
            with self.assertRaises(ValueError): c.validate_model(m)
        with self.assertRaises(ValueError): c.validate_model(MODEL, set())

    def test_authorization_and_strict_form(self):
        self.assertEqual(c.authorize_event(event())[0], 123)
        for mutation in (lambda e: e.update(action="edited"), lambda e: e["issue"].update(title="Other"), lambda e: e["sender"].update(id=123), lambda e: e["issue"].update(body=e["issue"]["body"].replace("[x]", "[ ]"))):
            e = copy.deepcopy(event()); mutation(e)
            with self.assertRaises(ValueError): c.authorize_event(e)
        with self.assertRaises(ValueError): json.loads('{"x":1,"x":2}', object_pairs_hook=c.unique_object)

    def run_process(self, stale=False, edited=False, conflict=False, noop=False):
        e = event(); calls = []
        def call(method, path, payload=None):
            calls.append((method, path, payload))
            if method == "GET" and "/issues/" in path:
                live = copy.deepcopy(e["issue"])
                if edited: live["updated_at"] = "changed"
                return live
            if method == "GET" and "/contents/categories.json" in path:
                old = MODEL if noop else {"version": 1, "categories": [], "assignments": {}}
                return encoded("categories.json", old, "b" * 40 if stale else SHA)
            if method == "GET" and "/contents/channels.json" in path:
                return encoded("channels.json", {"channels": [{"id": A}]})
            if method == "PUT" and conflict: raise RuntimeError("Simulated SHA conflict")
            return {}
        if stale or edited or conflict:
            with self.assertRaises((ValueError, RuntimeError)): p.process(e, call)
        else: p.process(e, call)
        return calls

    def test_only_categories_written_and_reuse_dispatched(self):
        calls = self.run_process()
        puts = [x for x in calls if x[0] == "PUT"]
        self.assertEqual(len(puts), 1)
        self.assertTrue(puts[0][1].endswith("/contents/categories.json"))
        self.assertEqual(puts[0][2]["sha"], SHA)
        self.assertEqual(calls[-1][2], {"ref": "main", "inputs": {"reuse_published_feed": "true"}})

    def test_stale_edited_and_conflict_never_dispatch(self):
        for options in ({"stale": True}, {"edited": True}, {"conflict": True}):
            calls = self.run_process(**options)
            self.assertFalse(any(method == "POST" for method, _, _ in calls))
            if not options.get("conflict"):
                self.assertFalse(any(method == "PUT" for method, _, _ in calls))

    def test_noop_dispatches_without_commit(self):
        calls = self.run_process(noop=True)
        self.assertFalse(any(method == "PUT" for method, _, _ in calls))
        self.assertEqual(calls[-1][0], "POST")

if __name__ == "__main__": unittest.main()
