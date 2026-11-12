// Run from repository root: node tests/spotify_embed_player_regression.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname,"../site/app.js"),"utf8");
const start = source.indexOf("function createSpotifyEmbedPlayer(host) {");
const end = source.indexOf("function createSpotifyPlaylistView(",start);
assert(start >= 0 && end > start);
class Node {
 constructor(tag) {this.tag=tag;this.children=[];this.attrs={};this.events={};this.dataset={};this.hidden=false;this.isConnected=true;}
 append(...items) {for(const n of items){n.parent=this;this.children.push(n);}}
 replaceChildren(...items) {this.children=[];this.append(...items);}
 setAttribute(k,v){this.attrs[k]=v;} getAttribute(k){return this.attrs[k];}
 addEventListener(k,f){this.events[k]=f;} removeEventListener(k){delete this.events[k];}
 focus(){this.focused=true;} scrollIntoView(){} remove(){this.removed=true;}
}
let callback, disconnected=false;
const page=new Node("section");
const document={createElement:tag=>new Node(tag)};
const element=(tag,cl,text)=>{const n=new Node(tag);n.className=cl;n.textContent=text;return n;};
class Observer {constructor(cb){callback=cb;}observe(){} disconnect(){disconnected=true;}}
const create = new Function("element","document","$","MutationObserver",source.slice(start,end)+";return createSpotifyEmbedPlayer;")(element,document,()=>page,Observer);
const host=new Node("section"); const api=create(host); const panel=host.children[0];
const heading=panel.children[0],content=panel.children[1],frames=content.children[1];
const toggle=heading.children[1],close=heading.children[2],restore=panel.children[2],trigger=new Node("button");
assert.equal(panel.hidden,true);assert.equal(frames.children.length,0);
api.open({id:"../escape",name:"Bad"},trigger);assert.equal(frames.children.length,0);
const item={id:"A".repeat(22),name:"OST"};api.open(item,trigger);
assert.equal(panel.hidden,false);const first=frames.children[0];
assert.equal(first.src,"https://open.spotify.com/embed/playlist/"+item.id);
assert(!first.src.includes("autoplay"));assert(!first.src.includes("token"));
toggle.events.click();assert.equal(content.hidden,true);assert.equal(toggle.getAttribute("aria-expanded"),"false");assert.equal(frames.children[0],first);
assert.equal(heading.hidden,true);assert.equal(restore.hidden,false);assert.equal(restore.focused,true);
assert.equal(panel.dataset.collapsed,"true");
restore.events.click();assert.equal(content.hidden,false);assert.equal(frames.children[0],first);
assert.equal(heading.hidden,false);assert.equal(restore.hidden,true);assert.equal(toggle.focused,true);
api.open(item,trigger);assert.equal(frames.children[0],first);
api.open({id:"B".repeat(22),name:"Next"},trigger);assert.notEqual(frames.children[0],first);assert.equal(frames.children.length,1);
close.events.click();assert.equal(frames.children.length,0);assert.equal(panel.hidden,true);assert.equal(trigger.focused,true);
api.open(item,trigger);page.hidden=true;callback();assert.equal(frames.children.length,0);
api.open(item,trigger);api.dispose();assert.equal(frames.children.length,0);assert.equal(disconnected,true);assert.equal(panel.removed,true);
console.log("PASS: no eager iframe, invalid IDs rejected, fixed embed origin, no token/autoplay URL, side dock/restore preserves iframe and moves focus, same playlist reuse, replacement, close, tab exit and disposal.");
