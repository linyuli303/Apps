
"use strict";
/* CURRENT_SPOTIFY_PLAYLIST_METADATA */
const results = [];
function assert(value) {
  if (!value) throw new Error("Assertion failed");
}
function rejects(run) {
  let rejected = false;
  try { run(); } catch { rejected = true; }
  assert(rejected);
}
function item(index = 0) {
  return {
    id:String(index).padStart(22, "0"),
    name:" Sample playlist ",
    owner:{id:"sample-owner", display_name:" Sample owner "},
    collaborative:false
  };
}
function page(items = [item()], offset = 0, total = items.length) {
  return {status:"received", offset, total, items};
}
function test(name, run) {
  try { run(); results.push("PASS: " + name); }
  catch { results.push("FAIL: " + name); }
}

test("Valid records reduced to immutable display data", () => {
  const input = page();
  const output = validateSpotifyPlaylistPage(input);
  assert(output.items[0].name === "Sample playlist");
  assert(output.items[0].ownerName === "Sample owner");
  assert(Object.isFrozen(output));
  assert(Object.isFrozen(output.items));
  assert(Object.isFrozen(output.items[0]));
  input.items[0].name = "changed";
  assert(output.items[0].name === "Sample playlist");
});

test("Provider links, descriptions and artwork are discarded", () => {
  const source = item();
  source.external_urls = {spotify:"https://untrusted.example/"};
  source.description = "<img src=x onerror=alert(1)>";
  source.images = [{url:"https://untrusted.example/image"}];
  const output = validateSpotifyPlaylistPage(page([source])).items[0];
  assert(output.spotifyURL ===
    "https://open.spotify.com/playlist/" + source.id);
  assert(Object.keys(output).sort().join(",") ===
    "collaborative,id,name,ownerId,ownerName,spotifyURL");
});

test("Duplicate IDs and malformed records fail closed", () => {
  rejects(() => validateSpotifyPlaylistPage(page([item(), item()])));
  for (const changes of [
    {id:"../escape"}, {name:" "}, {name:"x\n"},
    {name:"x".repeat(301)}, {owner:null},
    {owner:{id:""}}, {collaborative:"true"}
  ]) {
    rejects(() => validateSpotifyPlaylistPage(
      page([{...item(), ...changes}])
    ));
  }
});

test("Missing display name uses fixed label; ownership grants no access", () => {
  for (const display_name of [undefined, null, " "]) {
    const source = item();
    source.owner.display_name = display_name;
    const output = validateSpotifyPlaylistPage(page([source])).items[0];
    assert(output.ownerName === "Spotify user");
    assert(!("canReadTracks" in output));
  }
});

test("Pagination is bounded and empty or short pages stop", () => {
  const full = Array.from({length:20}, (_, i) => item(i));
  assert(validateSpotifyPlaylistPage(page(full, 0, 40)).nextOffset === 20);
  assert(validateSpotifyPlaylistPage(page(full, 20, 40)).nextOffset === null);
  assert(validateSpotifyPlaylistPage(page([], 20, 40)).nextOffset === null);
  assert(validateSpotifyPlaylistPage(page([item()], 0, 40)).nextOffset === null);
  assert(validateSpotifyPlaylistPage(
    page(full, 10000, 100000)
  ).nextOffset === null);
});

test("Invalid page containers, counts and offsets rejected", () => {
  for (const value of [
    null, [], {},
    {...page(), status:"restricted"},
    {...page(), offset:-1},
    {...page(), offset:1},
    {...page(), total:Infinity},
    {...page(), total:100001},
    {...page(), items:Array.from({length:21}, (_, i) => item(i))}
  ]) {
    rejects(() => validateSpotifyPlaylistPage(value));
  }
});

const failed = results.filter(line => line.startsWith("FAIL:")).length;
document.getElementById("results").textContent =
  results.join("\n") + "\n\n" +
  (failed ? failed + " failed" : "6 passed; 0 failed");
