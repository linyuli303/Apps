
"use strict";
function fixture(initial) {
  let location = new URL(initial);
  const MYAPPS_ROOT = new URL("https://linyuli303.github.io/Apps/");
  const nodes = new Map();
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, {
      hidden:true, attrs:{},
      setAttribute(key,value) { this.attrs[key]=value; },
      removeAttribute(key) { delete this.attrs[key]; }
    });
    return nodes.get(id);
  };
  let rendered=0, closed=0;
  function renderPodcasts() { rendered++; }
  function closePlayer() { closed++; $("player").hidden=true; }
  const entries=[location.href];
  let position=0;
  const history={
    state:null,
    pushState(state,title,url) {
      entries.splice(position+1);
      entries.push(new URL(url,location).href);
      position++;
      location=new URL(entries[position]);
    },
    replaceState(state,title,url) {
      location=new URL(url,location);
      entries[position]=location.href;
    }
  };
/* CURRENT_MYAPPS_ROUTING */

  return {
    route, navigate, nodes, $,
    url:()=>location.href,
    rendered:()=>rendered,
    closed:()=>closed,
    back() {
      if(position>0)position--;
      location=new URL(entries[position]);route();
    },
    forward() {
      if(position+1<entries.length)position++;
      location=new URL(entries[position]);route();
    }
  };
}
const results=[];
function assert(value) {
  if(!value)throw new Error("Assertion failed");
}
function selected(f,section) {
  for(const [name,page,nav] of [
    ["tube","tube-page","myapps-tube"],
    ["podcasts","podcast-page","myapps-podcasts"],
    ["spotify","spotify-page","myapps-spotify"]
  ]) {
    assert(f.$(page).hidden === (name!==section));
    assert((f.$(nav).attrs["aria-current"]==="page") === (name===section));
  }
  assert(f.$("rss-catalogue").hidden === (section!=="tube"));
}
function test(name,run) {
  try{run();results.push("PASS: "+name);}
  catch{results.push("FAIL: "+name);}
}

test("Root and direct MyTube URLs select MyTube",()=>{
  for(const path of ["","MyTube/"]) {
    const f=fixture("https://linyuli303.github.io/Apps/"+path);
    f.route();selected(f,"tube");
  }
});
test("Direct podcast URL selects podcasts and renders catalogue",()=>{
  const f=fixture("https://linyuli303.github.io/Apps/MyPodcasts/");
  f.route();selected(f,"podcasts");assert(f.rendered()===1);
});
test("Spotify hash selects Spotify even on a podcast path",()=>{
  for(const path of ["","MyPodcasts/"]) {
    const f=fixture("https://linyuli303.github.io/Apps/"+path+"#/spotify");
    f.route();selected(f,"spotify");assert(f.rendered()===0);
  }
});
test("Legacy section links normalize and preserve query",()=>{
  for(const [hash,section,path] of [
    ["podcasts","podcasts","MyPodcasts/"],["tube","tube","MyTube/"]
  ]) {
    const f=fixture("https://linyuli303.github.io/Apps/?view=phone#/"+hash);
    f.route();selected(f,section);
    assert(f.url()==="https://linyuli303.github.io/Apps/"+path+"?view=phone");
  }
});
test("Navigation away from Spotify supports Back and Forward",()=>{
  const f=fixture("https://linyuli303.github.io/Apps/?view=phone#/spotify");
  f.route();selected(f,"spotify");
  f.navigate("MyPodcasts");selected(f,"podcasts");
  f.back();selected(f,"spotify");
  f.forward();selected(f,"podcasts");
  assert(f.url().endsWith("/MyPodcasts/?view=phone"));
});
test("Spotify closes open video but routing never starts media",()=>{
  const f=fixture("https://linyuli303.github.io/Apps/#/spotify");
  f.$("player").hidden=false;
  f.route();selected(f,"spotify");assert(f.closed()===1);
});

const failed=results.filter(x=>x.startsWith("FAIL:")).length;
document.getElementById("results").textContent=
  results.join("\n")+"\n\n"+
  (failed?failed+" failed":"6 passed; 0 failed");
