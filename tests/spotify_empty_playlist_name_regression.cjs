// Run from repository root: node tests/spotify_empty_playlist_name_regression.cjs
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname,"../site/app.js"),"utf8");
const start = source.indexOf("function validateSpotifyPlaylistPage(page) {");
const end = source.indexOf("// Playlist UI receives reduced data only",start);
if (start < 0 || end < 0) throw new Error("Playlist validator not found");
const validateSpotifyPlaylistPage = new Function(source.slice(start,end)+";return validateSpotifyPlaylistPage;")();

const assert = require("node:assert/strict");
function record(name = "Example") {
  return {id:"A".repeat(22), name, owner:{id:"test-user",display_name:"Example user"},
    collaborative:false, items:{total:4}, images:[{height:null,width:null}]};
}
function page(items) {return {status:"received",offset:0,total:30,items};}
function rejects(item) {assert.throws(()=>validateSpotifyPlaylistPage(page([item])));}
assert.equal(validateSpotifyPlaylistPage(page([record("")])).items[0].name,"Untitled playlist");
assert.equal(validateSpotifyPlaylistPage(page([record("   ")])).items[0].name,"Untitled playlist");
assert.equal(validateSpotifyPlaylistPage(page([record(" OST ")])).items[0].name,"OST");
assert.equal(validateSpotifyPlaylistPage(page([record("落日大道")])).items[0].name,"落日大道");
rejects(record(null));rejects(record(42));rejects(record("x".repeat(301)));rejects(record("bad\nname"));
rejects({...record(),id:"invalid"});
assert.throws(()=>validateSpotifyPlaylistPage(page([record(),record()])));
const batch=Array.from({length:20},(_,i)=>({...record(i===17?"":"Playlist "+i),id:String(i).padStart(22,"0")}));
const checked=validateSpotifyPlaylistPage(page(batch));
assert.equal(checked.items.length,20);assert.equal(checked.nextOffset,20);
assert.equal(checked.items[17].name,"Untitled playlist");
assert.equal(checked.items[0].spotifyURL,"https://open.spotify.com/playlist/"+batch[0].id);
assert.ok(!("images" in checked.items[0]));
assert.ok(Object.isFrozen(checked.items));
console.log("PASS: empty/whitespace names, normal and Unicode labels, current items metadata, 20-row page and pagination; invalid labels/IDs and duplicates still rejected.");
