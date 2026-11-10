// For enforced anti-framing, use the documented HTTP response headers on a capable host.
'use strict';
const $ = id => document.getElementById(id);
let feed = null, visible = [], current = null, returnFocus = null;
let page = 0, enabledIDs = new Set();
const PAGE_SIZE = 48, MAX_FEED_AGE_MS = 24 * 60 * 60 * 1000;
const safeID = value => typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value);
const dateLabel = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}); };
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
async function load() {
  $('refresh').disabled = true;
  $('status').textContent = 'Loading approved feed…';
  try {
    const response = await fetch('data/feed.json', {cache:'no-store'});
    if (!response.ok) throw new Error('Feed unavailable');
    const raw = await response.text();
    if (raw.length > 25000000) throw new Error('Feed too large');
    const data = JSON.parse(raw);
    if (!freshFeed(data)) throw new Error('Expired feed');
    if (!Array.isArray(data.channels) || !Array.isArray(data.videos) || data.channels.length > 1000 || data.videos.length > 50000 || typeof data.title !== 'string' || typeof data.generatedAt !== 'string') throw new Error('Invalid feed');
    if (data.channels.some(c => !c || typeof c.id !== 'string' || !/^UC[A-Za-z0-9_-]{22}$/.test(c.id) || typeof c.title !== 'string')) throw new Error('Invalid channels');
    const allowed = new Set(data.channels.map(c => c.id));
    // Enforce whitelist again in the browser; never fall back to an unfiltered feed.
    data.videos = data.videos.filter(v => v && allowed.has(v.channelId) && safeID(v.id) && typeof v.title === 'string' && typeof v.publishedAt === 'string');
    feed = data;
    initializeDraft(data);
    $('title').textContent = data.title || 'My Channels';
    document.title = data.title || 'My Channels';
    const previous = $('channel').value;
    $('channel').replaceChildren(new Option('All approved channels',''));
    data.channels.filter(c => draftAllows(c.id)).forEach(c => $('channel').append(new Option(c.title,c.id)));
    if (allowed.has(previous)) $('channel').value = previous;
    closePlayer();
    render();
    renderManager();
  } catch (error) {
    closePlayer(); feed = null; visible = [];
    $('grid').replaceChildren(); $('empty').hidden = true; renderManager();
    $('status').textContent = 'Feed unavailable, invalid, or expired (24-hour limit). Run the GitHub publish workflow, check its logs, then refresh. Playback is blocked; no fallback is loaded.';
  } finally { $('refresh').disabled = false; }
}
function render() {
  if (!feed) return;
  if (!freshFeed(feed)) { expireFeed(); return; }
  const query = $('search').value.trim().toLocaleLowerCase();
  const channels = new Map(feed.channels.map(c => [c.id,c.title]));
  visible = feed.videos.filter(v => draftAllows(v.channelId) && (!$('channel').value || v.channelId === $('channel').value) &&
    `${v.title} ${channels.get(v.channelId)}`.toLocaleLowerCase().includes(query));
  visible.sort((a,b) => $('sort').value === 'title' ? a.title.localeCompare(b.title) :
    $('sort').value === 'old' ? a.publishedAt.localeCompare(b.publishedAt) : b.publishedAt.localeCompare(a.publishedAt));
  const fragment = document.createDocumentFragment();
  page = Math.min(page, Math.max(0, Math.ceil(visible.length / PAGE_SIZE)-1));
  visible.slice(page * PAGE_SIZE, (page+1) * PAGE_SIZE).forEach(v => {
    const card = element('button','card'); card.type = 'button'; card.dataset.video = v.id;
    const img = element('img'); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
    img.src = $('thumbnails').checked ? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` : 'icon.svg';
    const body = element('span','card-body');
    body.append(element('span','card-title',v.title),element('span','meta',`${channels.get(v.channelId)} · ${dateLabel(v.publishedAt)}`));
    card.append(img,body); card.addEventListener('click',() => openPlayer(v.id)); fragment.append(card);
  });
  $('grid').replaceChildren(fragment);
  $('page-prev').disabled = page === 0;
  $('page-next').disabled = (page+1)*PAGE_SIZE >= visible.length;
  $('page-status').textContent = `Page ${page+1} of ${Math.max(1,Math.ceil(visible.length/PAGE_SIZE))}`;
  $('empty').hidden = visible.length > 0;
  if (!feed.channels.length) {
    $('empty').textContent = 'Your whitelist is empty. Convert your Takeout CSV locally, review channels.json, commit only that JSON, and run the publish workflow.';
  } else $('empty').textContent = 'No matching playable videos in this snapshot. Try another filter or wait for the next refresh.';
  $('status').textContent = `${visible.length} videos · ${feed.channels.filter(c => draftAllows(c.id)).length} enabled published channels · Feed built ${dateLabel(feed.generatedAt)} ${new Date(feed.generatedAt).toLocaleTimeString()}`;
}
function openPlayer(id) {
  const video = feed && feed.videos.find(v => v.id === id && feed.channels.some(c => c.id === v.channelId));
  if (!feed || !freshFeed(feed)) {expireFeed(); return;}
  if (!video || !safeID(id) || !draftAllows(video.channelId)) return;
  if ($('player').hidden) returnFocus = document.activeElement;
  current = id; $('playing-title').textContent = video.title;
  $('official').href = `https://www.youtube.com/watch?v=${id}`;
  const iframe = document.createElement('iframe');
  const params = new URLSearchParams({autoplay:'1',rel:'0',playsinline:'1',origin:location.origin});
  iframe.src = `https://www.youtube-nocookie.com/embed/${id}?${params}`;
  iframe.title = video.title;
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  $('frame').replaceChildren(iframe);
  $('player').hidden = false;
  document.querySelector('header').inert = true; document.querySelector('main').inert = true;
  document.body.style.overflow = 'hidden'; $('close').focus();
  $('next').disabled = visible.length < 2;
}
function closePlayer() {
  const wasOpen = !$('player').hidden;
  $('frame').replaceChildren(); $('player').hidden = true; current = null;
  document.querySelector('header').inert = false; document.querySelector('main').inert = false;
  document.body.style.overflow = '';
  if (wasOpen && returnFocus && returnFocus.isConnected) returnFocus.focus();
}
$('close').addEventListener('click',closePlayer);
$('next').addEventListener('click',() => {
  if (!visible.length) return;
  const index = visible.findIndex(v => v.id === current);
  openPlayer(visible[(index+1)%visible.length].id);
});
$('refresh').addEventListener('click',load);
$('search').addEventListener('input',()=>{page=0;render();});
$('channel').addEventListener('change',()=>{page=0;render();});
$('sort').addEventListener('change',()=>{page=0;render();});
$('thumbnails').addEventListener('change',render);
document.addEventListener('keydown',event => {
  if (!$('player').hidden) {
    if (event.key === 'Escape' || event.key === 'BrowserBack' || event.keyCode === 10009 || event.keyCode === 461) {event.preventDefault();closePlayer();}
    if (event.key === 'Tab') {
      const controls = [$('close'),$('frame').querySelector('iframe'),$('official'),$('next')].filter(el => el && !el.disabled);
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault();controls[controls.length-1].focus(); }
      else if (!event.shiftKey && document.activeElement === controls[controls.length-1]) { event.preventDefault();controls[0].focus(); }
    }
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key) && document.activeElement.tagName !== 'IFRAME') {
      event.preventDefault();
      if (event.key === 'ArrowDown') $('frame').querySelector('iframe')?.focus();
      else if (event.key === 'ArrowUp' || $('next').disabled) $('close').focus();
      else (document.activeElement === $('close') ? $('next') : $('close')).focus();
    }
    return;
  }
  const card = document.activeElement.closest('.card');
  if (!card || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const cards = Array.from($('grid').children);
  const index = cards.indexOf(card);
  const rect = card.getBoundingClientRect();
  let best = null, score = Infinity;
  for (let i=0;i<cards.length;i++) {
    if (i===index) continue;
    const r = cards[i].getBoundingClientRect(); const dx=r.left-rect.left, dy=r.top-rect.top;
    const horizontal = event.key==='ArrowLeft'||event.key==='ArrowRight';
    const forward = event.key==='ArrowLeft'?dx< -5:event.key==='ArrowRight'?dx>5:event.key==='ArrowUp'?dy< -5:dy>5;
    if (!forward) continue;
    const s = horizontal ? Math.abs(dx)+Math.abs(dy)*10 : Math.abs(dy)+Math.abs(dx)*2;
    if (s<score) {score=s;best=cards[i];}
  }
  if (best) {best.focus();best.scrollIntoView({block:'nearest'});}
});

// Local draft only: no credential storage, write API, or public mutation endpoint.
const STORAGE_SCOPE = encodeURIComponent(location.pathname.replace(/[^/]*$/, ''));
const DRAFT_KEY = 'approved-yt-whitelist-v2:' + STORAGE_SCOPE;
const REPO_KEY = 'approved-yt-repository-v2:' + STORAGE_SCOPE;
let draft = null, baseSignature = '', managerNotice = '';
function parseChannel(value) {
  if (typeof value !== 'string' || value.length > 240) throw new Error('Invalid channel input.');
  let input = value.trim();
  if (/^https?:\/\//i.test(input)) {
    let url;
    try {url = new URL(input);} catch {throw new Error('Invalid channel URL.');}
    if (!['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(url.hostname) || url.username || url.password || url.port || url.search || url.hash || !['https:','http:'].includes(url.protocol)) throw new Error('Use a plain YouTube channel URL without query parameters.');
    let path;
    try {path = decodeURIComponent(url.pathname).replace(/\/$/,'');} catch {throw new Error('Invalid URL encoding.');}
    if (/^\/channel\/UC[A-Za-z0-9_-]{22}$/.test(path)) input = path.slice(9);
    else if (/^\/@[^/]+$/.test(path)) throw new Error('Resolve this handle locally and review its immutable channel ID first.');
    else throw new Error('Use /channel/UC… or /@handle, not a video or playlist URL.');
  }
  if (/^UC[A-Za-z0-9_-]{22}$/.test(input)) return {id:input};
  if (input.startsWith('@')) throw new Error('Resolve the handle locally, verify its identity, then add the channel ID.');
  throw new Error('Enter a full 24-character immutable channel ID.');
}
function entryKey(entry) {return entry.id || entry.handle.toLocaleLowerCase();}
function validDraft(list) {
  if (!Array.isArray(list) || list.length > 1000) throw new Error('Invalid saved draft.');
  const seen = new Set();
  return list.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).length !== 1 || Object.keys(entry)[0] !== 'id') throw new Error('Invalid draft entry.');
    const parsed = parseChannel(entry.id || entry.handle);
    if ((entry.id && !parsed.id) || (entry.handle && !parsed.handle)) throw new Error('Invalid draft entry.');
    const key = entryKey(parsed); if (seen.has(key)) throw new Error('Duplicate draft entry.'); seen.add(key); return parsed;
  });
}
function draftAllows(id) {return enabledIDs.has(id);}
function indexDraft() {enabledIDs = new Set((draft || []).map(c=>c.id));}
function initializeDraft(data) {
  const signature = JSON.stringify(data.channels.map(c=>c.id).sort());
  if (draft !== null && baseSignature === signature) return;
  baseSignature = signature;
  draft = data.channels.map(c=>({id:c.id}));
  managerNotice = '';
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw && raw.length <= 200000) {
      const saved = JSON.parse(raw);
      if (saved.base === signature) {draft = validDraft(saved.channels); $('remember-draft').checked = true;}
      else {localStorage.removeItem(DRAFT_KEY); managerNotice = 'Published channels changed: the local draft was reset to the published list. Export unfinished drafts before a deployment.';}
    } else if (raw) throw new Error('Oversized saved draft');
  } catch {managerNotice = 'Saved draft unavailable or invalid. Using the published whitelist.';}
  if ($('remember-draft').checked) {try {$('repo-name').value = localStorage.getItem(REPO_KEY) || '';} catch {}}
  indexDraft();
}
function saveDraft() {
  indexDraft(); page = 0;
  if (!$('remember-draft').checked) {
    try {localStorage.removeItem(DRAFT_KEY); localStorage.removeItem(REPO_KEY);} catch {}
    managerNotice = 'Session-only draft. Export before closing this page. Shared publication still requires a reviewed GitHub commit.'; return;
  }
  try {localStorage.setItem(DRAFT_KEY, JSON.stringify({base:baseSignature,channels:draft})); managerNotice = 'Draft saved on this browser only. Publish the exported JSON to update all devices.';}
  catch {managerNotice = 'Browser storage unavailable. Changes last only until this page closes; export now to keep them.';}
}
function updateAfterEdit() {
  closePlayer();
  saveDraft();
  const previous = $('channel').value;
  $('channel').replaceChildren(new Option('All enabled published channels',''));
  feed.channels.filter(c=>draftAllows(c.id)).forEach(c=>$('channel').append(new Option(c.title,c.id)));
  if (draftAllows(previous)) $('channel').value = previous;
  render(); renderManager();
}
function renderManager() {
  const ready = Boolean(feed && draft);
  ['add-channel','export-whitelist','reset-whitelist'].forEach(id=>$(id).disabled=!ready);
  $('whitelist-list').replaceChildren();
  if (!ready) {$('manager-status').textContent='Published feed unavailable. Reload it before editing. No draft has been published.'; return;}
  const names = new Map(feed.channels.map(c=>[c.id,c.title]));
  const fragment = document.createDocumentFragment();
  draft.forEach((entry,index)=>{
    const li = element('li');
    const text = element('span','',entry.id ? (names.get(entry.id) || entry.id) : entry.handle);
    text.append(element('small','',entry.id && names.has(entry.id) ? entry.id : 'Pending: no videos until GitHub publication; handles resolve during the build.'));
    const remove = element('button','','Remove'); remove.type='button';
    remove.setAttribute('aria-label',`Remove ${entry.id || entry.handle}`);
    remove.addEventListener('click',()=>{draft.splice(index,1);updateAfterEdit();$('new-channel').focus();});
    li.append(text,remove);fragment.append(li);
  });
  $('whitelist-list').append(fragment);
  $('manager-status').textContent=`${draft.length} draft channels. ${managerNotice || 'No changes published from this editor.'}`;
}
function addDraftChannel() {
  if (!feed || !draft) return;
  try {
    const entry = parseChannel($('new-channel').value);
    if (draft.length >= 1000) throw new Error('At most 1000 channels are supported.');
    if (draft.some(c=>entryKey(c)===entryKey(entry))) throw new Error('This entry is already in your draft.');
    draft.push(entry);$('new-channel').value='';updateAfterEdit();$('new-channel').focus();
  } catch (error) {$('manager-status').textContent=error.message;}
}
$('add-channel').addEventListener('click',addDraftChannel);
$('new-channel').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();addDraftChannel();}});
$('export-whitelist').addEventListener('click',()=>{
  if (!feed || !draft) return;
  try {
    const config = {title:feed.title.slice(0,120),max_videos_per_channel:15,channels:validDraft(draft)};
    const blob = new Blob([JSON.stringify(config,null,2)+'\n'],{type:'application/json'});
    const url=URL.createObjectURL(blob);const a=element('a');a.href=url;a.download='channels.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    $('manager-status').textContent='Exported draft, not yet published. Replace channels.json in GitHub, review and commit. Some TV browsers may not support file downloads; use a phone or laptop.';
  } catch {$('manager-status').textContent='Export failed. Try a modern laptop/phone browser.';}
});
$('reset-whitelist').addEventListener('click',()=>{
  if (!feed || !confirm('Discard this browser’s draft and restore the published whitelist?')) return;
  draft=feed.channels.map(c=>({id:c.id}));updateAfterEdit();
});
$('github-edit').addEventListener('click',()=>{
  const repo=$('repo-name').value.trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/.test(repo) || ['.','..'].includes(repo.split('/')[1])) {
    $('manager-status').textContent='Enter owner/repository, not a URL or a token.'; return;
  }
  if ($('remember-draft').checked) {try {localStorage.setItem(REPO_KEY,repo);} catch {}}
  window.open(`https://github.com/${repo}/edit/main/channels.json`,'_blank','noopener,noreferrer');
});
function freshFeed(data, now = Date.now()) {
  const timestamp = Date.parse(data && data.generatedAt);
  return Number.isFinite(timestamp) && now - timestamp <= MAX_FEED_AGE_MS && timestamp - now <= 300000;
}
function expireFeed() {
  closePlayer(); feed = null; visible = []; enabledIDs.clear();
  $('grid').replaceChildren(); $('empty').hidden=true;
  $('page-prev').disabled=true; $('page-next').disabled=true;
  $('status').textContent='Feed unavailable or more than 24 hours old. Run a successful GitHub refresh and reload. Playback is blocked until a fresh feed is loaded.';
  renderManager();
}
$('remember-draft').addEventListener('change',()=>{if(feed && draft) {saveDraft(); renderManager();}});
$('forget-draft').addEventListener('click',()=>{
  $('remember-draft').checked=false; $('repo-name').value='';
  try {localStorage.removeItem(DRAFT_KEY);localStorage.removeItem(REPO_KEY);localStorage.removeItem('approved-yt-whitelist-draft-v1');localStorage.removeItem('approved-yt-repository-v1');} catch {}
  if(feed) {draft=feed.channels.map(c=>({id:c.id}));updateAfterEdit();}
});
$('page-prev').addEventListener('click',()=>{if(page>0){page--;render();$('grid').querySelector('button')?.focus();}});
$('page-next').addEventListener('click',()=>{if((page+1)*PAGE_SIZE<visible.length){page++;render();$('grid').querySelector('button')?.focus();}});
setInterval(()=>{if(feed && !freshFeed(feed))expireFeed();},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden && feed && !freshFeed(feed))expireFeed();});
renderManager();
load();
