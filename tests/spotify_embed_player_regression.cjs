"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(
  path.join(__dirname, "../site/app.js"), "utf8"
);
const matches = [...source.matchAll(
  /^function createSpotifyEmbedPlayer\([\s\S]*?^\}/gm
)];
assert.equal(matches.length, 1);

class Node {
  constructor(tag) {
    this.tag=tag; this.children=[]; this.attrs={};
    this.events={}; this.dataset={}; this.hidden=false;
    this.isConnected=true;
  }
  append(...nodes) {
    for(const node of nodes) {
      node.parent=this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {this.children=[]; this.append(...nodes);}
  setAttribute(key,value) {this.attrs[key]=value;}
  getAttribute(key) {return this.attrs[key];}
  addEventListener(name,fn) {this.events[name]=fn;}
  removeEventListener(name) {delete this.events[name];}
  focus() {this.focused=true;}
  getClientRects() {return this.visible===false?[]:[{}];}
  remove() {
    this.removed=true;
    if(this.parent) {
      this.parent.children=this.parent.children.filter(n=>n!==this);
    }
  }
}
const body=new Node("body");
const document={
  body,createElement:tag=>new Node(tag),
  events:{},
  addEventListener(name,fn,capture) {
    assert.equal(capture,true);
    this.events[name]=fn;
  },
  removeEventListener(name,fn,capture) {
    assert.equal(capture,true);
    if(this.events[name]===fn) delete this.events[name];
  },
};
const element=(tag,cl,text)=>{
  const node=new Node(tag);
  node.className=cl; node.textContent=text;
  return node;
};
const create=new Function("element","document",
  matches[0][0]+"\nreturn createSpotifyEmbedPlayer;"
)(element,document);

const host=new Node("section");
const api=create(host);
assert.equal(host.children.length,0);
assert.equal(body.children.length,1);

const panel=body.children[0];
// Panel offers no dock modes: only a title, Expand (compact state) and Close.
assert.equal(panel.children.length,2);
const [heading,content]=panel.children;
assert.equal(heading.children.length,3);
const [title,expand,close]=heading.children;
assert.equal(expand.textContent,"Expand");
assert.equal(close.textContent,"Close");
for(const label of ["Bottom dock","Side dock"]) {
  assert(!matches[0][0].includes(label));
}
assert(!matches[0][0].includes("spotify-embed-restore"));
const inside=new Node("button");
panel.contains=node=>node===panel||node===inside||node.parent===heading;
const frames=content.children[1];
const trigger=new Node("button");
assert(panel.hidden);
assert.equal(frames.children.length,0);

api.open({id:"../escape",name:"Bad"},trigger);
assert.equal(frames.children.length,0);

const item={id:"A".repeat(22),name:"Sample"};
api.open(item,trigger);
const original=frames.children[0];
assert.equal(original.src,
  "https://open.spotify.com/embed/playlist/"+item.id);
// Opens expanded by default; Expand is only offered once compacted.
assert.equal(panel.dataset.presentation,"expanded");
assert(!content.hidden);
assert(!heading.hidden);
assert(expand.hidden);
assert(close.focused);

// Clicks inside the player never compact it.
document.events.pointerdown({target:inside});
assert.equal(panel.dataset.presentation,"expanded");

// Click-away compacts the same iframe without moving focus.
expand.focused=false;
document.events.pointerdown({target:new Node("main")});
assert.equal(panel.dataset.presentation,"compact");
assert(!panel.hidden);
assert(!content.hidden);
assert(!expand.hidden);
assert(!expand.focused);
assert.equal(frames.children[0],original);

expand.events.click();
assert.equal(panel.dataset.presentation,"expanded");
assert(expand.hidden);
assert.equal(frames.children[0],original);

document.events.pointerdown({target:new Node("main")});
title.events.click();
assert.equal(panel.dataset.presentation,"expanded");
assert.equal(frames.children[0],original);

// Opening another item from a compact player restores the expanded view.
document.events.pointerdown({target:new Node("main")});
api.open(item,trigger);
assert.equal(panel.dataset.presentation,"expanded");
assert.equal(frames.children[0],original);

// No section observer removes the player during navigation.
host.hidden=true;
assert.equal(panel.parent,body);
assert(!panel.hidden);
assert.equal(frames.children[0],original);

api.open(item,trigger);
assert.equal(frames.children[0],original);
let previous=original;
for(const type of ["album","track","playlist"]) {
  api.open({id:item.id,name:"Typed",type},trigger);
  const frame=frames.children[0];
  assert.notEqual(frame,previous);
  assert.equal(frame.src,
    "https://open.spotify.com/embed/"+type+"/"+item.id);
  assert.equal(frame.title,"Spotify "+type+": Typed");
  assert.equal(frame.getAttribute("referrerpolicy"),"no-referrer");
  assert(!frame.src.includes("token"));
  assert(!frame.src.includes("autoplay"));
  api.open({id:item.id,name:"Typed",type},trigger);
  assert.equal(frames.children[0],frame);
  previous=frame;
}
for(const type of ["artist","episode","../track","TRACK","",null,{},42]) {
  api.open({id:item.id,name:"Rejected",type},trigger);
  assert.equal(frames.children[0],previous);
  assert.equal(title.textContent,"Typed");
}

close.events.click();
assert(panel.hidden);
assert.equal(frames.children.length,0);
assert(trigger.focused);

api.open(item,trigger);
panel.events.keydown({key:"Escape",stopPropagation(){}});
assert.equal(panel.dataset.presentation,"compact");
assert.equal(frames.children.length,1);
panel.events.keydown({key:"Escape",stopPropagation(){}});
assert(panel.hidden);
assert.equal(frames.children.length,0);
api.open(item,trigger);
assert.equal(panel.dataset.presentation,"expanded");

api.dispose();
api.dispose();
assert.equal(frames.children.length,0);
assert(panel.removed);
assert.equal(body.children.length,0);
api.open(item,trigger);
assert.equal(frames.children.length,0);
assert.equal(expand.events.click,undefined);
assert.equal(title.events.click,undefined);
assert.equal(document.events.pointerdown,undefined);
console.log("PASS: no eager iframe; fixed typed URLs; opens expanded; click-away compacts and Expand/title restore without remounting; no dock modes; root attachment preserves navigation; invalid types rejected; close, two-step Escape and idempotent disposal.");

// spotify-media-handoff-regression-v1
{
  let podcastPauses = 0;
  let videoCloses = 0;
  const video = {hidden:false};
  const fakeWindow = {
    MyAppsPodcastPlayer:{
      pauseForVideo() { podcastPauses++; }
    }
  };

  const createWithHandoff = new Function(
    "element", "document", "window", "$", "closePlayer",
    matches[0][0] + "\nreturn createSpotifyEmbedPlayer;"
  )(
    element,
    document,
    fakeWindow,
    id => {
      assert.equal(id, "player");
      return video;
    },
    () => {
      videoCloses++;
      video.hidden = true;
    }
  );

  const player = createWithHandoff(new Node("section"));
  const registry = fakeWindow.MyAppsSpotifyPlayer;
  const panel = body.children[body.children.length - 1];
  const frames = panel.children[1].children[1];
  const trigger = new Node("button");

  // Construction must not interrupt other media or load an iframe.
  assert.equal(podcastPauses, 0);
  assert.equal(videoCloses, 0);
  assert.equal(frames.children.length, 0);
  assert.equal(typeof registry.closeForMedia, "function");

  // Invalid selections must not interrupt current media.
  player.open({id:"../escape", name:"Invalid"}, trigger);
  player.open({
    id:"Z".repeat(22), name:"Unsupported", type:"artist"
  }, trigger);
  assert.equal(podcastPauses, 0);
  assert.equal(videoCloses, 0);
  assert.equal(frames.children.length, 0);

  // A valid explicit selection hands playback over to Spotify.
  player.open({
    id:"Z".repeat(22), name:"Sample track", type:"track"
  }, trigger);
  assert.equal(podcastPauses, 1);
  assert.equal(videoCloses, 1);
  assert.equal(frames.children.length, 1);

  // Another media source can stop Spotify without disposing the UI.
  registry.closeForMedia();
  assert(panel.hidden);
  assert.equal(frames.children.length, 0);
  assert.equal(fakeWindow.MyAppsSpotifyPlayer, registry);

  // Closing repeatedly is harmless, and the player can be opened again.
  registry.closeForMedia();
  player.open({
    id:"Y".repeat(22), name:"Sample album", type:"album"
  }, trigger);
  assert.equal(podcastPauses, 2);
  assert.equal(videoCloses, 1); // Already-hidden video is not closed again.
  assert.equal(frames.children.length, 1);

  player.dispose();
  assert.equal(frames.children.length, 0);
  assert.equal(fakeWindow.MyAppsSpotifyPlayer, undefined);

  // An old player's disposal must not erase a newer player's registry.
  const older = createWithHandoff(new Node("section"));
  const newer = createWithHandoff(new Node("section"));
  const newerRegistry = fakeWindow.MyAppsSpotifyPlayer;
  older.dispose();
  assert.equal(fakeWindow.MyAppsSpotifyPlayer, newerRegistry);
  newer.dispose();
  assert.equal(fakeWindow.MyAppsSpotifyPlayer, undefined);

  console.log("PASS: media handoff is explicit, invalid selections do not interrupt playback, other media closes Spotify, registry cleanup is ownership-safe.");
}
