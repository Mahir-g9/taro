import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, query, where, updateDoc, arrayUnion, arrayRemove, increment, orderBy, limit, startAfter, addDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp({
  apiKey: "AIzaSyCvF2BV5MBU6AMQOByD9Q5g4wZXF0a9W1g",
  authDomain: "movement-player.firebaseapp.com",
  projectId: "movement-player",
  storageBucket: "movement-player.firebasestorage.app",
  messagingSenderId: "55543297155",
  appId: "1:55543297155:web:b8ef612f7041bcab7617b6"
});
const auth = getAuth(app), db = getFirestore(app);

// Set these to your two Render services (see index.js).
const API_URL = 'https://taro-j1g9.onrender.com';      // MODE=api    (SQL, has the DB secrets)
const RUNNER_URL = 'https://taro-runner.onrender.com'; // MODE=runner (Node code, no secrets)
const BUILD = '1.0.0';
// The free Render runner sleeps when idle. Pinging it early wakes it up before the user presses Run.
let lastWake = 0;
const isNodeFile = n => /\.(c|m)?js$/.test(n || '');
const NODE_CODE = /\brequire\s*\(|module\.exports|\bprocess\.(env|argv|version|exit)/; // looks like Node.js code, not browser code
const wakeRunner = () => { if (Date.now() - lastWake < 10 * 60 * 1000) return; lastWake = Date.now(); fetch(RUNNER_URL + '/health', { mode: 'no-cors' }).catch(() => { }); };

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ext = n => (String(n).split('.').pop() || '').toLowerCase();
const base = n => String(n).split('/').filter(Boolean).pop() || n;
const slug = n => n.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
let tt; const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2500); };
const clip = {
  async w(t) { try { await navigator.clipboard.writeText(t); } catch { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); } },
  async r() { try { return await navigator.clipboard.readText(); } catch { toast('Paste blocked: long-press in the editor to paste'); return ''; } }
};
function setFrame(f, html) { f.setAttribute('sandbox', 'allow-scripts allow-modals allow-forms allow-popups'); f.srcdoc = html; }
function download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text])); a.download = base(name); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

/* ---------- settings (localStorage) ---------- */
const DEFAULTS = { theme: 'dracula', showTabs: true, tabMode: 'editor', statusBar: true, textSize: '1', night: true, autocomplete: true, hints: true, cursor: 'default', fontSize: '16', fontWeight: '500', font: 'Fira Code', indentGuide: true, keymap: 'default', lineNumbers: true, printMargin: 'none', activeLine: true, invisibles: false, softTabs: true, tabSize: '2', detectTab: true, wrap: true, launch: 'inapp', console: 'builtin', haptic: true, predictive: false, extraKeys: true, actionBar: true, touchCursors: true, showCmd: true };
let set = { ...DEFAULTS };
try { Object.assign(set, JSON.parse(localStorage.getItem('taro-settings') || '{}')); } catch { }
const saveSettings = () => { try { localStorage.setItem('taro-settings', JSON.stringify(set)); } catch { } };
const FONTS = ['Fira Code', 'JetBrains Mono', 'Courier New'];
const CTL = [['a', 'Select all'], ['c', 'Copy'], ['x', 'Cut'], ['v', 'Paste'], ['z', 'Undo'], ['y', 'Redo'], ['s', 'Save'], ['f', 'Find'], ['d', 'Duplicate line'], ['/', 'Comment'], ['r', 'Run']];
const sel = (k, l, o, tip) => ({ k, l, t: 'select', o, tip });
const tg = (k, l, tip) => ({ k, l, t: 'toggle', tip });
const SCHEMA = [
  { h: 'Appearance', rows: [
    sel('language', 'Language', [['en', 'English']], 'Only English is available for now.'),
    sel('theme', 'Theme', [['dracula', 'Dracula'], ['monokai', 'Monokai'], ['material', 'Material'], ['nord', 'Nord']], 'Editor color theme (used when Night Mode is on).'),
    tg('showTabs', 'Show File Tabs', 'Show open files as tabs at the top.'),
    sel('tabMode', 'File Tab Mode', [['editor', 'Pin on Editor'], ['drawer', 'Drawer only']], 'Keep tabs pinned on the editor, or only use the file drawer.'),
    tg('statusBar', 'Show Encoding Bar', 'Shows line, column and encoding under the editor.'),
    sel('textSize', 'Text Size', [['0.9', 'Small'], ['1', 'Default'], ['1.15', 'Large'], ['1.3', 'Extra large']], 'Scales text, icons and bars together, including this page.'),
    tg('night', 'Night Mode', 'Dark editor. Turn off for a light editor.')] },
  { h: 'Editor', rows: [
    tg('autocomplete', 'Autocomplete/ Check Syntax', 'Underlines JavaScript errors while you type.'),
    tg('hints', 'Show Hints', 'Suggests code completions as you type.'),
    sel('cursor', 'Cursor Style', [['default', 'Default'], ['block', 'Block'], ['underline', 'Underline']]),
    sel('fontSize', 'Font Size', ['12', '13', '14', '15', '16', '18', '20', '24'].map(v => [v, v + 'px'])),
    sel('fontWeight', 'Font Weight', [['400', 'Regular'], ['500', 'Medium'], ['700', 'Bold']]),
    { k: 'font', l: 'Font', t: 'open', tip: 'Choose the code font.' },
    tg('indentGuide', 'Indent Guide', 'Faint vertical guides for indentation.'),
    { k: 'shortcuts', l: 'Keyboard Shortcuts', t: 'open' },
    sel('keymap', 'Keybindings', [['default', 'Default'], ['sublime', 'Sublime'], ['vim', 'Vim'], ['emacs', 'Emacs']]),
    tg('lineNumbers', 'Line Numbers'),
    sel('printMargin', 'Print Margin', [['none', 'None'], ['80', '80'], ['100', '100'], ['120', '120']], 'Draws a vertical line at this column.'),
    tg('activeLine', 'Show Active Line'),
    tg('invisibles', 'Show Invisibles', 'Shows spaces as dots.'),
    tg('softTabs', 'Use Soft Tabs', 'Tab key inserts spaces.'),
    sel('tabSize', 'Tab Size', ['2', '3', '4', '8'].map(v => [v, v])),
    tg('detectTab', 'Detect Tab Size', 'Reads the indentation of the file you open.'),
    tg('wrap', 'Word Wrap')] },
  { h: 'Mobile', rows: [
    sel('launch', 'Launch Browser', [['inapp', 'In-app preview'], ['newtab', 'New tab']], 'Where Run shows your page.'),
    sel('console', 'Console', [['builtin', 'Built-in'], ['eruda', 'Eruda'], ['none', 'None']], 'Eruda adds a full developer console inside your preview.')] },
  { h: 'Touch', rows: [
    tg('haptic', 'Haptic Keypress', 'Vibrate on key bar taps (Android).'),
    tg('predictive', 'Predictive Keyboard', 'Allow autocorrect and suggestions in the editor.'),
    tg('extraKeys', 'Extra Keyboard', 'Shows the coding key bar under the editor.'),
    tg('actionBar', 'Touch Action Bar', 'Shows cut, copy, paste above selected text.'),
    tg('touchCursors', 'Touch Cursors', 'Native selection handles. Applies next time you open a project.'),
    tg('showCmd', 'Show ⌘ Key', 'Tap ⌘, then press c, v, x and more to run shortcuts.')] },
  { h: 'About', rows: [
    { k: 'build', l: 'Build', t: 'val', v: () => BUILD },
    { k: 'browser', l: 'Browser', t: 'val', v: () => { const m = navigator.userAgent.match(/(Edg|Chrome|Firefox|Version)\/(\d+)/); return m ? (m[1] === 'Version' ? 'Safari' : m[1] === 'Edg' ? 'Edge' : m[1]) + ' ' + m[2] : 'Unknown'; } },
    { l: 'Documentation', t: 'link', href: 'https://github.com/mahir-g9/taro' },
    { l: 'Privacy Policy', t: 'link', href: '/privacy.html' },
    { l: 'Terms of Service', t: 'link', href: '/terms.html' },
    { l: 'YouTube', t: 'link', href: 'https://youtube.com/@Mahir_YT99' },
    { k: 'licenses', l: 'Open-Source Licenses', t: 'open' },
    { l: 'Report an Issue', t: 'link', red: true, href: 'https://github.com/mahir-g9/taro/issues' }] }
];
const ROW = {}; SCHEMA.forEach(s => s.rows.forEach(r => { if (r.k) ROW[r.k] = r; }));
function rowHtml(r) {
  if (r.t === 'link') return `<div class="set-row link"><a href="${esc(r.href)}" target="_blank" rel="noopener" class="${r.red ? 'red' : ''}">${esc(r.l)}</a></div>`;
  const v = set[r.k]; let c = '';
  if (r.t === 'select') c = `<select data-set="${r.k}">${r.o.map(([a, b]) => `<option value="${esc(a)}"${String(v) === a ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>`;
  else if (r.t === 'toggle') c = `<div class="tg${v ? ' on' : ''}" data-set="${r.k}" role="switch"></div>`;
  else if (r.t === 'open') c = `<button class="open" data-act="set-open" data-k="${r.k}"><i class="fa fa-up-right-from-square"></i> Open</button>`;
  else c = `<span class="val">${esc(r.v())}</span>`;
  return `<div class="set-row"><span class="lb">${esc(r.l)}</span><span class="info" data-act="set-info" data-k="${r.k}">i</span><div class="ctl">${c}</div></div>`;
}
function renderSettings() {
  const f = ($('#set-search').value || '').toLowerCase(); let h = '';
  SCHEMA.forEach(s => { const rows = s.rows.filter(r => !f || r.l.toLowerCase().includes(f)); if (rows.length) h += `<div class="set-card"><h4>${esc(s.h)}</h4>${rows.map(rowHtml).join('')}</div>`; });
  $('#set-body').innerHTML = h || '<p style="color:#888;padding:1rem">No matching setting.</p>';
}
function setSetting(k, v) { set[k] = v; saveSettings(); applySettings(); }
const cmTheme = () => set.night ? set.theme : 'default';
function applySettings() {
  const r = document.documentElement.style, b = document.body.classList;
  r.setProperty('--ed-font', `'${set.font}'`); r.setProperty('--ed-size', set.fontSize + 'px'); r.setProperty('--ed-weight', set.fontWeight); r.setProperty('--ui-scale', set.textSize);
  b.toggle('light-ed', !set.night); b.toggle('indent-guides', !!set.indentGuide);
  b.toggle('cursor-block', set.cursor === 'block'); b.toggle('cursor-under', set.cursor === 'underline');
  $('#ed-tabs').hidden = !(set.showTabs && set.tabMode === 'editor');
  $('#keybar').hidden = !set.extraKeys; $('#key-cmd').hidden = !set.showCmd;
  const sb = $('#status-bar'); if (sb) sb.hidden = !set.statusBar;
  if (S.cm) applyCM(S.cm);
}

/* ---------- state + views ---------- */
let me = null, postLogin = null;
const S = { proj: null, files: [], entry: 'index.html', tabs: [], active: null, cm: null, docs: {}, dirty: false, explore: false, armed: false, collapsed: new Set(), dt: 0, ct: 0 };
const fileOf = n => S.files.find(f => f.filename === n);
const isFolder = f => f.filename.endsWith('/');
function show(v) {
  for (const id of ['landing-page', 'dashboard-view', 'editor-view']) $('#' + id).hidden = !id.startsWith(v);
  $('#nav').hidden = v === 'editor'; document.body.classList.toggle('ed-open', v === 'editor');
  $('#not-found-view').hidden = true; $('#fullscreen-view').hidden = true;
}
function showNotFound() { ['landing-page', 'dashboard-view', 'editor-view'].forEach(id => $('#' + id).hidden = true); $('#nav').hidden = true; $('#not-found-view').hidden = false; }
function renderNav() {
  $('#buttons').innerHTML = me
    ? `<button class="sq" data-act="open-settings" title="Settings"><i class="fa fa-gear"></i></button><button class="sq" data-act="shorts"><i class="fa fa-infinity"></i></button><button class="sq" data-act="home"><i class="fa fa-home"></i></button><button class="sq" data-act="profile-open"><i class="fas fa-user-circle"></i></button><button id="logout" data-act="logout">Log Out</button>`
    : `<button id="sign" data-act="open-sign">sign in</button><button id="log" data-act="open-log">log in</button>`;
}
(function logo() { const img = $('#logo-img'); const t = i => { if (i > 2) return; const u = ['logo.png', 'logo.jpg', 'logo.jpeg'][i], im = new Image(); im.onload = () => { img.src = u; img.hidden = false; }; im.onerror = () => t(i + 1); im.src = u; }; t(0); })();

/* ---------- modal ---------- */
let modalCb = null;
function openModal(title, ph, ok, cb) {
  $('#modal-title').textContent = title; const i = $('#modal-input'); i.value = ''; i.placeholder = ph; $('#modal-confirm-btn').textContent = ok;
  $('#modal-overlay').hidden = false; $('#modal-box').hidden = false; i.focus(); modalCb = cb;
}
function closeModal() { $('#modal-overlay').hidden = true; $('#modal-box').hidden = true; modalCb = null; }
const modalGo = () => { const v = $('#modal-input').value.trim(); if (modalCb && v) modalCb(v); };
$('#modal-confirm-btn').addEventListener('click', modalGo);
$('#modal-input').addEventListener('keydown', e => { if (e.key === 'Enter') modalGo(); });

/* ---------- profile ---------- */
const loadProfile = async uid => { const s = await getDoc(doc(db, 'users', uid)); return s.exists() ? s.data() : null; };
$('#profile-pic-input').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return; const r = new FileReader();
  r.onload = () => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'), s = Math.min(1, 160 / Math.max(im.width, im.height)); c.width = im.width * s; c.height = im.height * s; c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); $('#profile-pic-preview').src = c.toDataURL('image/jpeg', .8); }; im.src = r.result; };
  r.readAsDataURL(f);
});

/* ---------- dashboard + feed ---------- */
const dashMode = (title, mine) => {
  $('#dash-title').textContent = title; $('#dash-actions').hidden = !mine; $('#albumSearch').hidden = !mine; $('#globalSearch').hidden = mine;
  $('#album-grid').classList.toggle('snap-feed', !mine);
};
function dashMine() { show('dashboard'); dashMode('My Projects', true); loadDashboard(); }
async function loadDashboard() {
  const g = $('#album-grid'); g.innerHTML = '<p style="color:#888;padding:1rem">Loading...</p>';
  try {
    const s = await getDocs(query(collection(db, 'projects'), where('uid', '==', me.uid))); g.innerHTML = '';
    if (s.empty) g.innerHTML = '<div class="empty-state"><i class="fa fa-folder-open"></i><p>No projects yet. Hit <strong>New</strong> to start.</p></div>';
    s.forEach(d => {
      const v = d.data(), c = document.createElement('div'); c.className = 'project-card'; c.dataset.projectId = d.id; c.dataset.name = v.name;
      c.innerHTML = `<div class="project-card-icon"><i class="fa fa-code"></i></div><h3>${esc(v.name)}</h3><p>${(v.files || []).filter(f => !f.filename.endsWith('/')).length} file(s) · ${esc(v.status || 'private')}</p><div class="card-actions"><button class="card-btn card-btn-edit" data-act="p-edit">Edit</button><button class="card-btn card-btn-view" data-act="p-view">View</button><button class="card-btn card-btn-del" data-act="p-del">Del</button></div>`;
      g.appendChild(c);
    });
  } catch { g.innerHTML = '<p style="color:red;padding:1rem">Error loading projects</p>'; }
  $('#skeleton-overlay').style.display = 'none';
}
$('#albumSearch').addEventListener('input', () => {
  const t = $('#albumSearch').value.toLowerCase();
  $$('.project-card').forEach(c => { const n = c.dataset.name || '', h = c.querySelector('h3'), i = n.toLowerCase().indexOf(t);
    if (t && i < 0) { c.hidden = true; return; } c.hidden = false;
    h.innerHTML = t ? esc(n.slice(0, i)) + '<mark>' + esc(n.slice(i, i + t.length)) + '</mark>' + esc(n.slice(i + t.length)) : esc(n); });
});
let feedLast = null, feedLoading = false, feedMore = true, feedTerm = '', feedObs = null;
async function fetchFeed(initial, term = '') {
  if (feedLoading) return; feedLoading = true; const g = $('#album-grid');
  if (initial) { g.innerHTML = '<p style="color:#888;padding:1rem">Loading feed...</p>'; feedLast = null; feedMore = true; }
  try {
    let q = query(collection(db, 'projects'), where('status', '==', 'public'));
    if (term) q = query(q, where('name', '>=', term), where('name', '<=', term + '\uf8ff'));
    q = query(q, orderBy('name'), limit(10)); if (!initial && feedLast) q = query(q, startAfter(feedLast));
    const s = await getDocs(q);
    if (initial) g.innerHTML = '';
    if (s.empty) { feedMore = false; if (initial) g.innerHTML = '<div class="empty-state"><i class="fa fa-rss"></i><p>No projects yet.</p></div>'; return; }
    feedLast = s.docs[s.docs.length - 1];
    const items = s.docs.map(d => ({ d, sc: (d.data().likes || 0) * .3 + (d.data().views || 0) * .2 + (d.data().forks || 0) * .3 + Math.random() * .5 })).sort((a, b) => b.sc - a.sc);
    let last = null;
    for (const { d } of items) last = await feedCard(d.id, d.data());
    feedMore = s.docs.length === 10;
    if (last && feedMore) { feedObs && feedObs.disconnect(); feedObs = new IntersectionObserver(en => { if (en[0].isIntersecting && !feedLoading && feedMore) fetchFeed(false, feedTerm); }, { root: g.classList.contains('snap-feed') ? g : null, rootMargin: '200px' }); feedObs.observe(last); }
  } catch (e) { console.error(e); if (initial) g.innerHTML = '<p style="color:red;padding:1rem">Error loading feed</p>'; }
  finally { feedLoading = false; $('#skeleton-overlay').style.display = 'none'; }
}
async function feedCard(id, v) {
  const p = await loadProfile(v.uid).catch(() => null), name = (p && p.username) || 'anonymous', pic = (p && p.profilePic) || '';
  const c = document.createElement('div'); c.className = 'feed-item'; c.dataset.projectId = id;
  c.innerHTML = `<iframe class="feed-preview"></iframe><div class="feed-actions"><div class="ctl"><div>${pic ? `<img src="${esc(pic)}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:4px">` : '<i class="fa fa-user-circle"></i> '}<span class="profile-username">${esc(name)}</span></div><button class="interact-btn" data-act="like"><i class="fa fa-heart"></i> <span class="like-count">${+v.likes || 0}</span></button><button class="interact-btn" data-act="dislike"><i class="fa fa-thumbs-down"></i> <span class="dislike-count">${+v.dislikes || 0}</span></button><button class="interact-btn" data-act="comments"><i class="fa fa-comment"></i> <span class="comment-count">${+v.commentCount || 0}</span></button><span class="feed-stat"><i class="fa fa-eye"></i> ${+v.views || 0}</span><span class="feed-stat"><i class="fa fa-code-fork"></i> ${+v.forks || 0}</span><button class="card-btn card-btn-fork" data-act="fork">Fork</button><button class="card-btn card-btn-view" data-act="view">View</button></div></div>`;
  setFrame(c.querySelector('iframe'), buildDoc(v.files || [], v.entry || 'index.html', {}));
  $('#album-grid').appendChild(c); paintCard(id, v); return c;
}
function paintCard(id, v) {
  const c = $(`.feed-item[data-project-id="${CSS.escape(id)}"]`); if (!c) return; const u = me && me.uid;
  c.querySelector('.like-count').textContent = +v.likes || 0; c.querySelector('.dislike-count').textContent = +v.dislikes || 0;
  c.querySelector('[data-act=like] i').style.color = u && (v.likesBy || []).includes(u) ? '#e84040' : 'gray';
  c.querySelector('[data-act=dislike] i').style.color = u && (v.dislikesBy || []).includes(u) ? '#00bcd4' : 'gray';
}
async function react(id, type) {
  if (!me) return toast('Login first'); const ref = doc(db, 'projects', id);
  try {
    const d = (await getDoc(ref)).data(), st = (d.likesBy || []).includes(me.uid) ? 'like' : (d.dislikesBy || []).includes(me.uid) ? 'dislike' : null;
    const a = type === 'like' ? ['likes', 'likesBy', 'dislikes', 'dislikesBy'] : ['dislikes', 'dislikesBy', 'likes', 'likesBy'], u = {};
    if (st === type) { u[a[0]] = increment(-1); u[a[1]] = arrayRemove(me.uid); }
    else { u[a[0]] = increment(1); u[a[1]] = arrayUnion(me.uid); if (st) { u[a[2]] = increment(-1); u[a[3]] = arrayRemove(me.uid); } }
    await updateDoc(ref, u); paintCard(id, (await getDoc(ref)).data());
  } catch { toast('Failed, please try again'); }
}
function openFeed(term) {
  show('dashboard'); dashMode(term ? 'Search Results' : 'Shorts Feed', false); const gs = $('#globalSearch'); gs.value = term || ''; feedTerm = (term || '').toLowerCase(); $('#skeleton-overlay').style.display = 'flex'; fetchFeed(true, feedTerm);
}
let gsT; $('#globalSearch').addEventListener('input', e => { clearTimeout(gsT); gsT = setTimeout(() => { const t = e.target.value.trim().toLowerCase(); feedTerm = t.length < 2 ? '' : t; fetchFeed(true, feedTerm); }, 300); });

/* comments */
let cmtId = null;
async function loadComments(id) {
  const l = $('#comments-list'); l.innerHTML = '<p>Loading...</p>';
  try {
    const s = await getDocs(query(collection(db, 'projects', id, 'comments'), orderBy('timestamp', 'asc'))); l.innerHTML = '';
    if (s.empty) { l.innerHTML = '<p>No comments yet.</p>'; return; }
    s.forEach(x => { const c = x.data(), d = document.createElement('div'); d.style.marginBottom = '.5rem';
      d.innerHTML = `${c.profilePic ? `<img src="${esc(c.profilePic)}" style="width:20px;height:20px;border-radius:50%;vertical-align:middle"> ` : ''}<strong>${esc(c.username || 'anonymous')}</strong> <span style="font-size:.8rem;color:#888">${esc(new Date(c.timestamp).toLocaleString())}</span><p style="margin:.2rem 0">${esc(String(c.text || '').split('').reverse().join(''))}</p>`; l.appendChild(d); });
  } catch { l.innerHTML = '<p style="color:red">Failed to load comments</p>'; }
}

/* ---------- project CRUD ---------- */
async function createProject(name) {
  const n = slug(name), ex = await getDocs(query(collection(db, 'projects'), where('name', '==', n), where('uid', '==', me.uid)));
  if (!ex.empty) return toast('Name already taken');
  const id = n + '-' + Date.now();
  await setDoc(doc(db, 'projects', id), { name: n, uid: me.uid, status: 'private', entry: 'index.html', files: [{ filename: 'index.html', content: `<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8">\n  <title>${n}</title>\n</head>\n<body>\n  <h1>Hello World</h1>\n</body>\n</html>` }], likes: 0, dislikes: 0, likesBy: [], dislikesBy: [], forks: 0, createdAt: Date.now(), updatedAt: Date.now() });
  closeModal(); toast('Project created!'); openEditor(id);
}
async function forkProject(srcId) {
  if (!me) { postLogin = { type: 'fork', id: srcId }; return open('log'); }
  const s = await getDoc(doc(db, 'projects', srcId)); if (!s.exists()) return toast('Source project not found'); const v = s.data();
  openModal(`Fork "${v.name}"`, 'my-fork', 'Fork', async name => {
    const n = slug(name), ex = await getDocs(query(collection(db, 'projects'), where('name', '==', n), where('uid', '==', me.uid)));
    if (!ex.empty) return toast('You already have a project with that name');
    const id = n + '-' + Date.now();
    await setDoc(doc(db, 'projects', id), { name: n, uid: me.uid, status: 'private', entry: v.entry || 'index.html', files: v.files || [], likes: 0, dislikes: 0, likesBy: [], dislikesBy: [], forks: 0, createdAt: Date.now(), updatedAt: Date.now(), forkedFrom: srcId });
    updateDoc(doc(db, 'projects', srcId), { forks: increment(1) }).catch(() => { });
    closeModal(); toast('Project forked!'); openEditor(id);
  });
}

/* ---------- preview builder ---------- */
function resolvePath(from, rel) {
  if (!rel || /^([a-z]+:)?\/\//i.test(rel) || /^(data|blob|#)/.test(rel)) return null;
  const out = [], parts = (rel.startsWith('/') ? rel.slice(1) : from.split('/').slice(0, -1).join('/') + '/' + rel).split('/');
  for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); } return out.join('/');
}
const HOOK = `<script>(function(){var p=function(t,a){try{parent.postMessage({taro:1,t:t,m:[].map.call(a,function(x){try{return typeof x==='object'?JSON.stringify(x):String(x)}catch(e){return String(x)}}).join(' ')},'*')}catch(e){}};['log','info','warn','error'].forEach(function(k){var o=console[k];console[k]=function(){p(k,arguments);o.apply(console,arguments)}});addEventListener('error',function(e){p('error',[e.message+' (line '+e.lineno+')'])});addEventListener('unhandledrejection',function(e){p('error',[String(e.reason)])})})()<\/script>`;
function buildDoc(files, entry, o = {}) {
  const fs = files.filter(f => !f.filename.endsWith('/')), get = n => fs.find(f => f.filename === n);
  const main = get(entry) || get('index.html') || fs.find(f => /\.html?$/.test(f.filename));
  if (!main) return '<html><body><h1>Empty project</h1></body></html>';
  const d = new DOMParser().parseFromString(main.content || '', 'text/html'), used = new Set([main.filename]);
  d.querySelectorAll('script[src]').forEach(s => { const f = get(resolvePath(main.filename, s.getAttribute('src'))); if (f) { used.add(f.filename); s.removeAttribute('src'); s.textContent = (f.content || '').replace(/<\/script/gi, '<\\/script'); } });
  d.querySelectorAll('link[rel~=stylesheet][href]').forEach(l => { const f = get(resolvePath(main.filename, l.getAttribute('href'))); if (f) { used.add(f.filename); const st = d.createElement('style'); st.textContent = f.content || ''; l.replaceWith(st); } });
  // Old behaviour kept for simple projects: a root .js file with no <script> tag is added automatically.
  // It is skipped when the page already has its own scripts, and for Node files (require / module.exports / process).
  const ownScript = [...d.querySelectorAll('script')].some(s => !s.getAttribute('src')), NODEISH = /\brequire\s*\(|module\.exports|\bprocess\.(env|argv|version|exit)/;
  fs.filter(f => !used.has(f.filename) && !f.filename.includes('/')).forEach(f => {
    if (f.filename.endsWith('.css')) { const s = d.createElement('style'); s.textContent = f.content || ''; d.head.appendChild(s); }
    else if (f.filename.endsWith('.js') && !ownScript && !NODEISH.test(f.content || '')) { const s = d.createElement('script'); s.textContent = (f.content || '').replace(/<\/script/gi, '<\\/script'); d.body.appendChild(s); }
  });
  if (o.hook) d.head.insertAdjacentHTML('afterbegin', HOOK);
  if (o.eruda) d.body.insertAdjacentHTML('beforeend', '<script src="https://cdn.jsdelivr.net/npm/eruda@3.0.1/eruda.min.js"><\/script><script>eruda.init()<\/script>');
  return '<!DOCTYPE html>\n' + d.documentElement.outerHTML;
}

/* ---------- editor ---------- */
const modeFor = n => ({ html: 'htmlmixed', htm: 'htmlmixed', css: 'css', js: 'javascript', json: { name: 'javascript', json: true }, py: 'python', sql: 'text/x-pgsql' }[ext(n)] || null);
const SPECIAL = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b\u200e\u200f\u2028\u2029\u202d\u202e\u2066\u2067\u2069\ufeff\ufff9-\ufffc]/;
CodeMirror.commands.autocomplete = c => c.showHint({ completeSingle: false });
function applyCM(cm) {
  const o = (k, v) => cm.setOption(k, v);
  o('theme', cmTheme()); o('lineNumbers', !!set.lineNumbers); o('lineWrapping', !!set.wrap); o('styleActiveLine', !!set.activeLine); o('keyMap', set.keymap);
  o('tabSize', +set.tabSize); o('indentUnit', +set.tabSize); o('indentWithTabs', !set.softTabs);
  o('rulers', set.printMargin === 'none' ? [] : [{ column: +set.printMargin, color: '#444' }]);
  o('specialChars', set.invisibles ? new RegExp(SPECIAL.source.slice(0, -1) + ' ]') : SPECIAL);
  o('specialCharPlaceholder', ch => { const s = document.createElement('span'); s.className = 'cm-invis'; s.textContent = ch === ' ' ? '·' : '•'; return s; });
  o('lint', set.autocomplete && ext(S.active || '') === 'js' ? { esversion: 11 } : false);
  const i = cm.getInputField(); i.setAttribute('autocorrect', set.predictive ? 'on' : 'off'); i.setAttribute('autocapitalize', set.predictive ? 'sentences' : 'off'); i.setAttribute('spellcheck', String(!!set.predictive));
  cm.refresh();
}
function ensureChrome() {
  if (!$('#status-bar')) $('#keybar').insertAdjacentHTML('beforebegin', '<div id="status-bar" class="status-bar"><span id="st-pos">Ln 1, Col 1</span><span>UTF-8 · <span id="st-lang"></span></span></div>');
  if (!$('#sel-bar')) $('#ed-main').insertAdjacentHTML('beforeend', '<div id="sel-bar" class="sel-bar" hidden><button data-act="key" data-k="cut"><i class="fa fa-scissors"></i></button><button data-act="key" data-k="copy"><i class="fa fa-copy"></i></button><button data-act="key" data-k="paste"><i class="fa fa-paste"></i></button><button data-act="key" data-k="all"><i class="fa fa-i-cursor"></i></button></div>');
  if (!$('#ctl-panel').children.length) $('#ctl-panel').innerHTML = CTL.map(([c, l]) => `<button data-act="ctl" data-c="${esc(c)}"><b>${esc(c)}</b>${esc(l)}</button>`).join('');
}
function makeCM() {
  const el = $('#ed-code'); el.innerHTML = '';
  const cm = CodeMirror(el, {
    value: '', lineNumbers: true, inputStyle: set.touchCursors ? 'contenteditable' : 'textarea', readOnly: S.explore, smartIndent: true, matchBrackets: true, autoCloseBrackets: true, autoCloseTags: true,
    gutters: ['CodeMirror-linenumbers', 'CodeMirror-lint-markers'], viewportMargin: 20, undoDepth: 300, historyEventDelay: 300,
    extraKeys: {
      'Ctrl-Space': 'autocomplete', 'Ctrl-F': 'findPersistent', 'Ctrl-H': 'replace', 'Ctrl-/': 'toggleComment', 'Ctrl-S': () => saveProject(false), 'Shift-Tab': 'indentLess',
      Tab: c => c.execCommand(c.somethingSelected() ? 'indentMore' : (set.softTabs ? 'insertSoftTab' : 'insertTab'))
    }
  });
  S.cm = cm;
  cm.on('change', () => { const f = fileOf(S.active); if (f && !S.explore) { f.content = cm.getValue(); markDirty(); } undoState(); findLater(); });
  cm.on('beforeChange', (c, ch) => { if (S.armed && ch.origin === '+input') { ch.cancel(); disarm(); runCtl(ch.text.join('').toLowerCase()); } });
  let ht; cm.on('inputRead', (c, ch) => { if (!set.hints || c.state.completionActive || !/^[\w.<]$/.test(ch.text[0] || '')) return; clearTimeout(ht); ht = setTimeout(() => !c.state.completionActive && c.showHint({ completeSingle: false }), 150); });
  cm.on('cursorActivity', c => {
    const p = c.getCursor(); $('#st-pos').textContent = `Ln ${p.line + 1}, Col ${p.ch + 1}`;
    const bar = $('#sel-bar'); if (!set.actionBar || !c.somethingSelected() || !$('#find-bar').hidden) { bar.hidden = true; return; }
    const a = c.cursorCoords(true, 'window'), r = $('#ed-main').getBoundingClientRect(); bar.hidden = false;
    bar.style.left = Math.max(4, Math.min(a.left - r.left, r.width - 170)) + 'px'; bar.style.top = Math.max(4, a.top - r.top - 46) + 'px';
  });
  return cm;
}
const undoState = () => { if (!S.cm) return; const h = S.cm.historySize(); $('#k-undo').disabled = !h.undo; $('#k-redo').disabled = !h.redo; };
function openFile(name) {
  const f = fileOf(name); if (!f || isFolder(f) || !S.cm) return;
  if (!S.tabs.includes(name)) S.tabs.push(name); S.active = name;
  if (!S.docs[name]) S.docs[name] = CodeMirror.Doc(f.content || '', modeFor(name));
  fClear(); S.cm.swapDoc(S.docs[name]); applyCM(S.cm); if (!$('#find-bar').hidden) findRun();
  if (set.detectTab) { const t = f.content || ''; if (/^\t/m.test(t)) S.cm.setOption('indentWithTabs', true); else { const m = t.match(/^ {2,8}(?=\S)/gm); if (m) { const n = Math.min(...m.map(x => x.length)); S.cm.setOption('indentUnit', n); S.cm.setOption('tabSize', n); } } }
  $('#st-lang').textContent = ext(name) || 'text'; renderTabs(); undoState();
}
function renderTabs() {
  $('#ed-tabs').innerHTML = S.tabs.map(n => `<div class="etab${n === S.active ? ' on' : ''}" data-act="tab" data-f="${esc(n)}" data-ext="${esc(ext(n))}"><i class="edot"></i>${esc(base(n))}<i class="fa fa-xmark" data-act="tab-close" data-f="${esc(n)}" style="font-size:.7rem;opacity:.6;padding:6px 0 6px 6px"></i></div>`).join('');
}
function renderDrawer() {
  const q = ($('#file-search').value || '').toLowerCase(); $('#proj-name').textContent = S.proj.name; $('#vis').value = S.proj.status || 'private';
  const hid = p => [...S.collapsed].some(c => p.startsWith(c) && p !== c);
  const rows = [...S.files].sort((a, b) => a.filename.localeCompare(b.filename)).filter(f => (!q || f.filename.toLowerCase().includes(q)) && !hid(f.filename));
  $('#file-list').innerHTML = rows.map(f => {
    const dir = isFolder(f), e = dir ? '' : ext(f.filename), dep = f.filename.replace(/\/$/, '').split('/').length - 1;
    const ic = dir ? `<span class="fi" style="background:none;color:#8aa4f0;font-size:1.1rem"><i class="fa fa-folder${S.collapsed.has(f.filename) ? '' : '-open'}"></i></span>` : `<span class="fi">${esc(e.slice(0, 4))}</span>`;
    return `<div class="frow${dir ? ' dir' : ''}${f.filename === S.active ? ' active' : ''}" data-act="${dir ? 'toggle-dir' : 'open-file'}" data-f="${esc(f.filename)}" data-ext="${esc(e)}" style="padding-left:${(14 + dep * 18) / 16}rem">${ic}<span class="nm">${esc(base(f.filename))}</span>${f.filename === S.entry ? '<i class="fa fa-caret-left entry"></i>' : ''}<button class="ico" data-act="file-menu" data-f="${esc(f.filename)}"><i class="fa fa-ellipsis"></i></button></div>`;
  }).join('') || '<div class="frow" style="color:#888">No files</div>';
}
function popMenu(items, anchor) {
  const m = $('#pop-menu'); m.innerHTML = items.map(([a, ic, t, cls, f]) => `<button class="${cls || ''}" data-act="${a}" data-f="${esc(f || '')}"><i class="fa ${ic}"></i>${esc(t)}</button>`).join(''); m.hidden = false;
  const r = anchor.getBoundingClientRect(); m.style.top = Math.min(r.bottom, innerHeight - 230) + 'px'; m.style.left = Math.max(8, r.right - 240) + 'px';
}

async function openEditor(id, explore = false) {
  const snap = await getDoc(doc(db, 'projects', id)); if (!snap.exists()) return toast('Project not found');
  const d = snap.data(), owner = me && d.uid === me.uid; if (!owner) { if (d.status !== 'public') return toast('Cannot view this project'); explore = true; }
  S.proj = { id, name: d.name, status: d.status || 'private' }; S.explore = explore;
  S.files = (d.files && d.files.length ? d.files : [{ filename: 'index.html', content: '<h1>Hello World</h1>' }]).map(f => ({ filename: f.filename, content: f.content || '' }));
  S.entry = d.entry && fileOf(d.entry) ? d.entry : (fileOf('index.html') ? 'index.html' : (S.files.find(f => !isFolder(f)) || {}).filename);
  if (!explore) { let dr = null; try { dr = JSON.parse(localStorage.getItem('taro-draft-' + id)); } catch { } if (dr && dr.t > (d.updatedAt || 0) && confirm('Restore unsaved changes from this device?')) { S.files = dr.files; S.entry = dr.entry || S.entry; } }
  Object.assign(S, { tabs: [], docs: {}, active: null, dirty: false, collapsed: new Set(), armed: false });
  show('editor'); ensureChrome(); makeCM(); applySettings();
  $('#ed-title b').textContent = d.name; $('#save-state small').hidden = explore; $('#vis').disabled = explore; $('#btn-exit-publish').hidden = explore;
  const b = $('#ed-banner'); b.hidden = !explore; if (explore) b.innerHTML = `You are viewing <strong>${esc(d.name)}</strong>. Changes won't be saved. <a href="#" data-act="fork-current" style="color:#4c2e9e">Fork</a>`;
  setState('saved'); closeSheet(); drawerClose(); findClose(true);
  if (!explore && isNodeFile(S.entry)) wakeRunner(); $('#keys-1').hidden = false; $('#keys-2').hidden = true; $('#ctl-panel').hidden = true;
  openFile(S.entry);
}
const STATES = { saved: 'auto saved', saving: 'saving…', dirty: 'unsaved', err: 'save failed' };
function setState(s) { const b = $('#save-state'); b.className = 'save-state ' + s; b.querySelector('small').textContent = STATES[s]; }
function markDirty() {
  S.dirty = true; setState('dirty'); clearTimeout(S.dt); clearTimeout(S.ct);
  S.dt = setTimeout(() => { try { localStorage.setItem('taro-draft-' + S.proj.id, JSON.stringify({ t: Date.now(), files: S.files, entry: S.entry })); } catch { } }, 500);
  S.ct = setTimeout(() => saveProject(true), 3000);
}
async function saveProject(silent) {
  if (!me || !S.proj || S.explore) return; clearTimeout(S.ct);
  if (JSON.stringify(S.files).length > 900000) { toast('Project is close to the 1 MB limit'); }
  setState('saving');
  try {
    await updateDoc(doc(db, 'projects', S.proj.id), { files: S.files, entry: S.entry, status: S.proj.status || 'private', updatedAt: Date.now() });
    S.dirty = false; setState('saved'); try { localStorage.removeItem('taro-draft-' + S.proj.id); } catch { } if (!silent) toast('Saved!');
  } catch (e) { setState('err'); toast('Save failed: ' + e.message); }
}
async function backToDashboard() {
  if (S.dirty && !S.explore) await saveProject(true);
  S.proj = null; S.cm = null; closeSheet(); drawerClose();
  if (me) dashMine(); else { show('landing'); $('#nav').hidden = false; }
}
const drawerOpen = () => { renderDrawer(); $('#drawer').hidden = false; $('#drawer-shade').hidden = false; };
const drawerClose = () => { $('#drawer').hidden = true; $('#drawer-shade').hidden = true; $('#pop-menu').hidden = true; };
const disarm = () => { S.armed = false; $('#key-cmd').classList.remove('armed'); };
function ensureDirs(p) { const a = p.split('/'); a.pop(); let acc = ''; a.forEach(s => { acc += s + '/'; if (!fileOf(acc)) S.files.push({ filename: acc, content: '' }); }); }
function delFile(n) {
  const dir = n.endsWith('/'), hit = S.files.filter(f => dir ? f.filename.startsWith(n) : f.filename === n);
  if (!dir && S.files.filter(f => !isFolder(f)).length <= 1) return toast("Can't delete the only file");
  if (!confirm(`Delete "${n}"?`)) return;
  S.files = S.files.filter(f => !hit.includes(f)); hit.forEach(f => { delete S.docs[f.filename]; S.tabs = S.tabs.filter(t => t !== f.filename); });
  if (!fileOf(S.entry)) S.entry = (S.files.find(f => /\.html?$/.test(f.filename)) || S.files.find(f => !isFolder(f)) || {}).filename;
  if (!fileOf(S.active)) { S.active = null; if (S.tabs.length) openFile(S.tabs[S.tabs.length - 1]); else if (S.entry) openFile(S.entry); }
  renderTabs(); renderDrawer(); markDirty();
}

/* ---------- run: preview / python / node / sql ---------- */
const PYW = `importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js');
let py;
onmessage=async e=>{
 try{
  if(!py){postMessage({t:'inf',m:'Loading Python…'});py=await loadPyodide({stdout:m=>postMessage({t:'log',m}),stderr:m=>postMessage({t:'error',m})});postMessage({t:'ready'});}
  for(const f of e.data.files){const d=f.p.split('/').slice(0,-1).join('/');if(d)py.FS.mkdirTree('/home/pyodide/'+d);py.FS.writeFile('/home/pyodide/'+f.p,f.c);}
  await py.runPythonAsync(e.data.code);
 }catch(err){postMessage({t:'error',m:String(err.message||err)});}
 postMessage({t:'done'});
};`;
let pyw = null, pyt = 0;
const logOut = (t, m) => { const p = $('#console-out'), s = document.createElement('div'); s.className = t === 'error' || t === 'warn' ? 'err' : t === 'inf' ? 'inf' : ''; s.textContent = m; p.appendChild(s); p.scrollTop = p.scrollHeight; };
function sheetTab(t) { $$('.stab').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); $$('.pane').forEach(p => p.classList.toggle('on', p.dataset.pane === t)); }
const openSheet = t => { $('#ed-sheet').hidden = false; sheetTab(t); }, closeSheet = () => { $('#ed-sheet').hidden = true; };
window.addEventListener('message', e => { const f = $('#preview-frame'); if (e.data && e.data.taro && f && e.source === f.contentWindow) logOut(e.data.t, e.data.m); });
async function api(baseUrl, path, body) {
  if (!me) throw new Error('Log in first'); const tok = await me.getIdToken();
  const r = await fetch(baseUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: 'Bad response from server' })); if (!r.ok) throw new Error(j.error || r.statusText); return j;
}
const srcFiles = () => S.files.filter(f => !isFolder(f));
function run() {
  if (!S.proj) return; const ae = ext(S.active || ''), af = fileOf(S.active), nodeOpen = ae === 'js' && af && NODE_CODE.test(af.content || ''),
    target = (ae === 'py' || ae === 'sql' || nodeOpen) ? S.active : S.entry, e = ext(target); // the open file runs if it is Python, SQL or Node code
  if (e === 'html' || e === 'htm') {
    const h = buildDoc(S.files, target, { hook: set.console === 'builtin', eruda: set.console === 'eruda' });
    if (set.launch === 'newtab') { window.open(URL.createObjectURL(new Blob([h], { type: 'text/html' })), '_blank'); return; }
    $('#console-out').textContent = ''; openSheet('preview'); setFrame($('#preview-frame'), h);
  } else if (e === 'py') runPy(target);
  else if (e === 'sql') runSql(target);
  else if (e === 'js') runNode(target);
  else toast('Nothing to run for .' + e);
}
function runPy(target) {
  $('#console-out').textContent = ''; openSheet('console'); const kill = () => { if (pyw) pyw.terminate(); pyw = null; logOut('error', 'Stopped: the program ran too long.'); };
  if (!pyw) { pyw = new Worker(URL.createObjectURL(new Blob([PYW], { type: 'text/javascript' }))); pyw.onmessage = e => { const d = e.data; if (d.t === 'done') return clearTimeout(pyt); if (d.t === 'ready') { clearTimeout(pyt); pyt = setTimeout(kill, 20000); return; } logOut(d.t, d.m); }; }
  clearTimeout(pyt); pyt = setTimeout(kill, 90000);
  pyw.postMessage({ code: fileOf(target).content || '', files: srcFiles().map(f => ({ p: f.filename, c: f.content || '' })) });
}
/* Real server-start check: polls the runner's /health until it answers (no fake timer). */
let runToken = 0;
function statusLine(text) {
  const p = $('#console-out'), el = document.createElement('div'); el.className = 'inf'; el.textContent = text; p.appendChild(el); p.scrollTop = p.scrollHeight; return el;
}
async function wakeUp(url, label) {
  const my = ++runToken, t0 = Date.now(), FR = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏', el = statusLine('');
  let i = 0, tries = 0, msg = 'Checking the ' + label + '…';
  const secs = () => ((Date.now() - t0) / 1000).toFixed(0) + 's';
  const tick = setInterval(() => { el.textContent = FR[i++ % FR.length] + ' ' + msg + ' ' + secs(); }, 100);
  try {
    while (Date.now() - t0 < 120000) {
      if (my !== runToken) return false; // a newer run started
      tries++;
      const ac = new AbortController(), to = setTimeout(() => ac.abort(), 6000);
      let up = false;
      try { const r = await fetch(url + '/health', { cache: 'no-store', signal: ac.signal }); up = r.ok && !!((await r.json().catch(() => ({}))).ok); } catch { }
      clearTimeout(to);
      if (up) { clearInterval(tick); el.textContent = '✔ ' + label + ' is ready (' + ((Date.now() - t0) / 1000).toFixed(1) + 's' + (tries > 1 ? ', ' + tries + ' checks' : '') + ')'; return true; }
      msg = 'Waking up the ' + label + ' (booting, check ' + tries + ')…' + (Date.now() - t0 > 60000 ? ' still trying. If it never finishes, check the runner on Render.' : '');
      await new Promise(r => setTimeout(r, 1500));
    }
    el.textContent = '✖ The ' + label + ' did not start within 2 minutes.'; el.className = 'err'; return false;
  } finally { clearInterval(tick); }
}
async function runNode(target) {
  $('#console-out').textContent = ''; openSheet('console');
  if (!me) return logOut('error', 'Log in first.');
  if (!(await wakeUp(RUNNER_URL, 'Node server'))) return;
  const t0 = Date.now(), el = statusLine('Running ' + base(target) + '…');
  try {
    const r = await api(RUNNER_URL, '/run', { entry: target, files: srcFiles().map(f => ({ path: f.filename, content: f.content || '' })) });
    el.textContent = '✔ ' + base(target) + ' finished in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's';
    if (r.stdout) logOut('log', r.stdout); if (r.stderr) logOut('error', r.stderr);
    logOut('inf', 'exit code ' + r.code + (r.timedOut ? ' (timed out)' : ''));
  } catch (e) { el.remove(); logOut('error', /failed to fetch|networkerror/i.test(e.message) ? 'Could not reach the Node server. Check RUNNER_URL in main.js and that taro-runner is live on Render.' : e.message); }
}
async function runSql(target) {
  openSheet('sql'); const out = $('#sql-out'); out.textContent = 'Running…';
  const text = target === S.active && S.cm.somethingSelected() ? S.cm.getSelection() : (fileOf(target).content || '');
  try {
    const r = await api(API_URL, '/sql/run', { sql: text });
    out.innerHTML = r.results.map(x => x.fields && x.fields.length ? `<p>${esc(x.command)} · ${x.rowCount} row(s)</p><div style="overflow:auto"><table><tr>${x.fields.map(f => `<th>${esc(f)}</th>`).join('')}</tr>${x.rows.map(row => `<tr>${row.map(c => `<td>${esc(c === null ? 'NULL' : typeof c === 'object' ? JSON.stringify(c) : c)}</td>`).join('')}</tr>`).join('')}</table></div>` : `<p>${esc(x.command)} · ${x.rowCount ?? 0} row(s)</p>`).join('<br>');
  } catch (e) { out.innerHTML = `<p class="err" style="color:#ff6b6b">${esc(e.message)}</p>`; }
}

/* ---------- key bar ---------- */
async function keyAct(k) {
  const cm = S.cm; if (!cm) return; const s = cm.getSelection(), line = () => cm.getLine(cm.getCursor().line);
  switch (k) {
    case 'tab': cm.execCommand(cm.somethingSelected() ? 'indentMore' : (set.softTabs ? 'insertSoftTab' : 'insertTab')); break;
    case 'up': cm.execCommand('goLineUp'); break; case 'down': cm.execCommand('goLineDown'); break;
    case 'left': cm.execCommand('goCharLeft'); break; case 'right': cm.execCommand('goCharRight'); break;
    case 'undo': cm.undo(); break; case 'redo': cm.redo(); break; case 'all': cm.execCommand('selectAll'); break;
    case 'copy': await clip.w(s || line()); toast('Copied'); break;
    case 'cut': if (s) { await clip.w(s); cm.replaceSelection(''); } else { await clip.w(line()); cm.execCommand('deleteLine'); } break;
    case 'paste': { const t = await clip.r(); if (t) cm.replaceSelection(t); break; }
  }
}
function runCtl(c) {
  const m = { a: 'all', c: 'copy', x: 'cut', v: 'paste', z: 'undo', y: 'redo' }; if (m[c]) return keyAct(m[c]);
  if (c === 's') saveProject(false); else if (c === 'f') S.cm.execCommand('findPersistent'); else if (c === 'd') S.cm.execCommand('duplicateLine'); else if (c === '/') S.cm.execCommand('toggleComment'); else if (c === 'r') run();
  S.cm.focus();
}
$('#keybar').addEventListener('pointerdown', e => e.preventDefault());
$('#ed-main').addEventListener('pointerdown', e => { if (e.target.closest('#sel-bar')) e.preventDefault(); });

/* ---------- find / replace ---------- */
const FIND = { regex: false, case: false, word: false };
let fMarks = [], fList = [], fIdx = -1, fTimer = 0;
function fClear() { fMarks.forEach(m => m.clear()); fMarks = []; }
function findRegex() {
  const q = $('#fb-q').value; if (!q) return null;
  let src = FIND.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (FIND.word) src = '\\b(?:' + src + ')\\b';
  try { return new RegExp(src, FIND.case ? 'g' : 'gi'); } catch { return null; }
}
function findRun(keep) {
  const cm = S.cm; if (!cm) return; fClear(); fList = [];
  const re = findRegex(); if (!re) { fIdx = -1; $('#fb-count').textContent = '0/0'; return; }
  const text = cm.getValue(); let m;
  while ((m = re.exec(text)) && fList.length < 5000) { if (!m[0]) { re.lastIndex++; continue; } fList.push([m.index, m.index + m[0].length]); }
  fList.slice(0, 500).forEach(([a, b]) => fMarks.push(cm.markText(cm.posFromIndex(a), cm.posFromIndex(b), { className: 'cm-find' })));
  if (!fList.length) { fIdx = -1; $('#fb-count').textContent = '0/0'; return; }
  if (keep) { fIdx = Math.min(Math.max(fIdx, 0), fList.length - 1); $('#fb-count').textContent = (fIdx + 1) + '/' + fList.length; return; }
  const cur = cm.indexFromPos(cm.getCursor('from')); fIdx = fList.findIndex(x => x[0] >= cur); if (fIdx < 0) fIdx = 0; findShow();
}
function findShow() {
  const cm = S.cm, [a, b] = fList[fIdx], f = cm.posFromIndex(a), t = cm.posFromIndex(b);
  cm.setSelection(f, t); cm.scrollIntoView({ from: f, to: t }, 90); $('#fb-count').textContent = (fIdx + 1) + '/' + fList.length;
}
function findStep(d) { if (!fList.length) return findRun(); fIdx = (fIdx + d + fList.length) % fList.length; findShow(); }
const findLater = () => { if ($('#find-bar').hidden) return; clearTimeout(fTimer); fTimer = setTimeout(() => findRun(true), 250); };
function findClose(quiet) { $('#find-bar').hidden = true; fClear(); fList = []; if (!quiet && S.cm) S.cm.focus(); }
function findToggle() {
  if (!S.cm) return; if (!$('#find-bar').hidden) return findClose();
  $('#find-bar').hidden = false; $('#sel-bar').hidden = true;
  const s = S.cm.getSelection(); if (s && !s.includes('\n') && s.length < 80) $('#fb-q').value = s;
  const q = $('#fb-q'); q.focus(); q.select(); findRun();
}
function findRepText(a, b) {
  const s = S.cm.getRange(S.cm.posFromIndex(a), S.cm.posFromIndex(b)), v = $('#fb-r').value; if (!FIND.regex) return v;
  const re = findRegex(); return re ? s.replace(new RegExp(re.source, re.flags.replace('g', '')), v) : v;
}
function findReplace(all) {
  const cm = S.cm; if (!cm || S.explore || !fList.length) return;
  const items = all ? fList.slice() : [fList[fIdx]], reps = items.map(([a, b]) => findRepText(a, b));
  cm.operation(() => { for (let i = items.length - 1; i >= 0; i--) cm.replaceRange(reps[i], cm.posFromIndex(items[i][0]), cm.posFromIndex(items[i][1])); });
  if (!all) cm.setCursor(cm.posFromIndex(items[0][0] + reps[0].length));
  findRun();
}
$('#fb-q').addEventListener('input', () => findRun());
$('#fb-q').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); } });
$('#find-bar').addEventListener('pointerdown', e => { if (e.target.closest('button')) e.preventDefault(); });

/* ---------- auth + live sites ---------- */
function open(m) { $('#overlay').hidden = false; $('#signer').hidden = m !== 'sign'; $('#loger').hidden = m !== 'log'; }
const closeAll = () => { ['#signer', '#loger', '#overlay'].forEach(s => $(s).hidden = true); };
async function liveSite(name) {
  const s = await getDocs(query(collection(db, 'projects'), where('name', '==', name))), d = s.docs.find(x => x.data().status === 'public' || (me && x.data().uid === me.uid));
  if (!d) { showNotFound(); return true; } updateDoc(d.ref, { views: increment(1) }).catch(() => { });
  const v = d.data(); setFrame($('#fullscreen-iframe'), buildDoc(v.files || [], v.entry || 'index.html', {}));
  $('.fs-close').hidden = true; show('none'); $('#fullscreen-view').hidden = false; $('#nav').hidden = true; return true;
}
async function byName(name) { const s = await getDocs(query(collection(db, 'projects'), where('name', '==', name), where('status', '==', 'public'))); return s.empty ? null : s.docs[0]; }
const paramsU = new URLSearchParams(location.search);
onAuthStateChanged(auth, async u => {
  me = u; renderNav(); $('#skeleton-overlay').style.display = 'none'; let handled = false;
  if (paramsU.get('site')) handled = await liveSite(paramsU.get('site'));
  if (!handled && paramsU.get('view')) { const d = await byName(paramsU.get('view')); if (d) openEditor(d.id, true); else { showNotFound(); } handled = true; }
  if (!handled && paramsU.get('fork')) { const d = await byName(paramsU.get('fork')); if (!d) showNotFound(); else if (u) forkProject(d.id); else { postLogin = { type: 'fork', id: d.id }; show('landing'); open('log'); } handled = true; }
  if (!handled && paramsU.get('search')) { openFeed(paramsU.get('search')); handled = true; }
  if (!handled) { if (u) dashMine(); else show('landing'); }
  if (postLogin && u) { const a = postLogin; postLogin = null; forkProject(a.id); }
});

/* ---------- click router ---------- */
const ACT = {
  'open-sign': () => open('sign'), 'open-log': () => open('log'), 'close-all': closeAll,
  'toggle-pass': el => { const i = $('#' + el.dataset.target); i.type = i.type === 'password' ? 'text' : 'password'; el.classList.toggle('fa-eye'); el.classList.toggle('fa-eye-slash'); },
  signup: async () => { try { await createUserWithEmailAndPassword(auth, $('#sign-email').value, $('#sign-pass').value); closeAll(); toast('Account created!'); } catch (e) { toast(e.message); } },
  login: async () => { try { await signInWithEmailAndPassword(auth, $('#log-email').value, $('#log-pass').value); closeAll(); toast('Welcome back!'); } catch (e) { toast(e.message); } },
  logout: async () => { await signOut(auth); location.href = location.pathname; },
  'modal-close': closeModal,
  'new-project': () => openModal('New Project', 'e.g. my-portfolio', 'Create', createProject),
  guide: () => { const g = $('#custom-guide-box'); if (g) return g.remove(); document.body.insertAdjacentHTML('beforeend', `<div id="custom-guide-box"><h3>Quick Guide</h3><p style="font-size:14px;color:#444;margin:10px 0">To view your site live, use this link:</p><code>taro.page.gd/?site=${esc(S.proj ? S.proj.name : 'your-site-name')}</code><p style="font-size:13px;color:#888;margin-bottom:10px">Connect with us:</p><p style="margin-bottom:18px"><a href="https://github.com/mahir-g9/taro" target="_blank" rel="noopener" style="margin:0 10px;color:#333;font-size:20px"><i class="fab fa-github"></i></a><a href="https://youtube.com/@Mahir_YT99" target="_blank" rel="noopener" style="margin:0 10px;color:#f00;font-size:20px"><i class="fab fa-youtube"></i></a></p><button data-act="guide">Got it!</button></div>`); },
  home: () => { if (!me) return location.href = '/'; $('#fullscreen-view').hidden = true; dashMine(); },
  shorts: () => openFeed(''),
  'p-edit': el => openEditor(el.closest('.project-card').dataset.projectId),
  'p-view': async el => { const s = await getDoc(doc(db, 'projects', el.closest('.project-card').dataset.projectId)); if (!s.exists()) return; const v = s.data(); setFrame($('#fullscreen-iframe'), buildDoc(v.files || [], v.entry || 'index.html', {})); $('.fs-close').hidden = false; $('#fullscreen-view').hidden = false; },
  'p-del': async el => { const c = el.closest('.project-card'); if (!confirm(`Delete "${c.dataset.name}"?`)) return; await deleteDoc(doc(db, 'projects', c.dataset.projectId)); toast('Deleted'); loadDashboard(); },
  'fs-close': () => { $('#fullscreen-view').hidden = true; },
  like: el => react(el.closest('.feed-item').dataset.projectId, 'like'), dislike: el => react(el.closest('.feed-item').dataset.projectId, 'dislike'),
  comments: el => { cmtId = el.closest('.feed-item').dataset.projectId; $('#comment-modal').hidden = false; $('#comment-input').value = ''; loadComments(cmtId); },
  'comments-close': () => { $('#comment-modal').hidden = true; cmtId = null; },
  'comment-post': async () => {
    const i = $('#comment-input'), t = i.value.trim().split('').reverse().join(''); if (!t || !me || !cmtId) return toast('Login to comment');
    try { const p = await loadProfile(me.uid); await addDoc(collection(db, 'projects', cmtId, 'comments'), { uid: me.uid, username: (p && p.username) || 'anonymous', profilePic: (p && p.profilePic) || '', text: t, timestamp: Date.now() }); i.value = ''; loadComments(cmtId);
      const n = (await getDocs(collection(db, 'projects', cmtId, 'comments'))).size, c = $(`.feed-item[data-project-id="${CSS.escape(cmtId)}"] .comment-count`); if (c) c.textContent = n; } catch { toast('Failed to post comment'); }
  },
  fork: el => forkProject(el.closest('.feed-item').dataset.projectId),
  view: async el => { const id = el.closest('.feed-item').dataset.projectId, s = await getDoc(doc(db, 'projects', id)); if (s.exists() && s.data().status === 'public') openEditor(id, true); },
  'fork-current': () => forkProject(S.proj.id),
  'profile-open': async () => { const p = (await loadProfile(me.uid)) || {}; $('#profile-name-input').value = p.name || ''; $('#profile-username-input').value = p.username || ''; $('#profile-pic-preview').src = p.profilePic || ''; $('#profile-modal').hidden = false; },
  'profile-close': () => { $('#profile-modal').hidden = true; },
  'pic-pick': () => $('#profile-pic-input').click(),
  'profile-save': async () => { const username = $('#profile-username-input').value.trim(); if (!username) return toast('Username required'); await setDoc(doc(db, 'users', me.uid), { name: $('#profile-name-input').value.trim(), username, profilePic: $('#profile-pic-preview').getAttribute('src') || '' }, { merge: true }); toast('Profile saved'); $('#profile-modal').hidden = true; },
  /* editor */
  menu: drawerOpen, 'drawer-close': drawerClose, run, 'save-now': () => saveProject(false),
  'sheet-tab': el => sheetTab(el.dataset.tab), 'sheet-close': closeSheet,
  tab: el => openFile(el.dataset.f),
  'tab-close': el => { const n = el.dataset.f; S.tabs = S.tabs.filter(t => t !== n); if (S.active === n) { S.active = null; if (S.tabs.length) openFile(S.tabs[S.tabs.length - 1]); else S.cm.swapDoc(CodeMirror.Doc('', null)); } renderTabs(); },
  'open-file': el => { openFile(el.dataset.f); drawerClose(); }, 'toggle-dir': el => { const f = el.dataset.f; S.collapsed.has(f) ? S.collapsed.delete(f) : S.collapsed.add(f); renderDrawer(); },
  'file-menu': (el, e) => { e.stopPropagation(); const f = el.dataset.f; popMenu(f.endsWith('/') ? [['del-file', 'fa-trash', 'Delete folder', 'del', f]] : [['copy-code', 'fa-copy', 'Copy full code in this file', '', f], ['download', 'fa-download', 'Download', '', f], ['set-entry', 'fa-circle-play', 'Launch as default', '', f], ['del-file', 'fa-trash', 'Delete', 'del', f]].filter(x => !S.explore || x[0] !== 'del-file' && x[0] !== 'set-entry'), el); },
  'copy-code': async el => { await clip.w((fileOf(el.dataset.f) || {}).content || ''); toast('Copied'); $('#pop-menu').hidden = true; },
  download: el => { const f = fileOf(el.dataset.f); if (f) download(f.filename, f.content || ''); $('#pop-menu').hidden = true; },
  'set-entry': el => { S.entry = el.dataset.f; markDirty(); renderDrawer(); if (isNodeFile(S.entry)) wakeRunner(); toast('Default launch file: ' + base(S.entry)); $('#pop-menu').hidden = true; },
  'del-file': el => { $('#pop-menu').hidden = true; delFile(el.dataset.f); },
  'new-file': () => { if (S.explore) return; openModal('New file', 'e.g. main.py or src/app.js', 'Add', n => { if (!/^[\w\-.]+(\/[\w\-.]+)*\.(html|css|js|py|sql|json|md|txt)$/i.test(n) || n.includes('..')) return toast('Use a name like main.js or src/app.py'); if (fileOf(n)) return toast('File already exists'); S.files.push({ filename: n, content: '' }); ensureDirs(n); closeModal(); markDirty(); renderDrawer(); openFile(n); }); },
  'new-folder': () => { if (S.explore) return; openModal('New folder', 'e.g. src', 'Add', n => { if (!/^[\w\-]+(\/[\w\-]+)*$/.test(n)) return toast('Use letters, numbers, - and _'); if (fileOf(n + '/')) return toast('Folder already exists'); S.files.push({ filename: n + '/', content: '' }); ensureDirs(n + '/x'); closeModal(); markDirty(); renderDrawer(); }); },
  'proj-menu': el => popMenu([['copy-link', 'fa-link', 'Copy live link'], ...(S.explore ? [] : [['rename-proj', 'fa-pen', 'Rename project'], ['del-proj', 'fa-trash', 'Delete project', 'del']])], el),
  'copy-link': async () => { await clip.w(`https://taro.page.gd/?site=${S.proj.name}`); toast(S.proj.status === 'public' ? 'Link copied' : 'Link copied (project is private)'); $('#pop-menu').hidden = true; },
  'rename-proj': () => { $('#pop-menu').hidden = true; openModal('Rename project', S.proj.name, 'Rename', async n => { const nn = slug(n), ex = await getDocs(query(collection(db, 'projects'), where('name', '==', nn), where('uid', '==', me.uid))); if (!ex.empty) return toast('Name already taken'); await updateDoc(doc(db, 'projects', S.proj.id), { name: nn }); S.proj.name = nn; $('#ed-title b').textContent = nn; renderDrawer(); closeModal(); }); },
  'del-proj': async () => { $('#pop-menu').hidden = true; if (!confirm(`Delete project "${S.proj.name}"?`)) return; await deleteDoc(doc(db, 'projects', S.proj.id)); S.dirty = false; toast('Deleted'); backToDashboard(); },
  'exit-publish': async () => { if (S.explore) return; S.proj.status = 'public'; $('#vis').value = 'public'; await saveProject(true); toast('Published: taro.page.gd/?site=' + S.proj.name); backToDashboard(); },
  key: el => keyAct(el.dataset.k), 'key-cmd': el => { S.armed = !S.armed; el.classList.toggle('armed', S.armed); },
  'keys-more': () => { $('#keys-1').hidden = true; $('#keys-2').hidden = false; }, 'keys-back': () => { $('#keys-2').hidden = true; $('#keys-1').hidden = false; $('#ctl-panel').hidden = true; },
  'ctl-panel': () => { const p = $('#ctl-panel'); p.hidden = !p.hidden; }, ctl: el => { $('#ctl-panel').hidden = true; runCtl(el.dataset.c); },
  'find-toggle': findToggle, 'find-close': () => findClose(),
  'find-opt': el => { const o = el.dataset.o; FIND[o] = !FIND[o]; el.classList.toggle('on', FIND[o]); findRun(); },
  'find-next': () => findStep(1), 'find-prev': () => findStep(-1),
  'find-replace-toggle': () => { const r = $('#fb-rrow'); r.hidden = !r.hidden; if (!r.hidden) $('#fb-r').focus(); },
  'find-rep': () => findReplace(false), 'find-repall': () => findReplace(true),
  /* settings */
  'open-settings': () => { drawerClose(); $('#set-search').value = ''; renderSettings(); $('#settings-view').hidden = false; },
  'settings-back': () => { $('#settings-view').hidden = true; },
  'set-info': el => { const row = el.closest('.set-row'), nx = row.nextElementSibling; if (nx && nx.classList.contains('set-tip')) return nx.remove(); const r = ROW[el.dataset.k] || {}; row.insertAdjacentHTML('afterend', `<div class="set-tip">${esc(r.tip || r.l || '')}</div>`); },
  'set-open': el => {
    const row = el.closest('.set-row'), nx = row.nextElementSibling; if (nx && nx.classList.contains('set-tip')) return nx.remove(); const k = el.dataset.k; let h = '';
    if (k === 'font') h = FONTS.map(f => `<button class="open" data-act="set-font" data-v="${esc(f)}" style="margin:3px;height:38px;font-family:'${esc(f)}'">${esc(f)}</button>`).join('');
    else if (k === 'shortcuts') h = CTL.map(([c, l]) => `<div><b>⌘ ${esc(c)}</b> &nbsp;${esc(l)}</div>`).join('');
    else h = 'CodeMirror, Font Awesome, Firebase, Pyodide, Eruda, JSHint';
    row.insertAdjacentHTML('afterend', `<div class="set-tip">${h}</div>`);
  },
  'set-font': el => { setSetting('font', el.dataset.v); renderSettings(); }
};
document.addEventListener('click', e => {
  if (!e.target.closest('#pop-menu,[data-act=file-menu],[data-act=proj-menu]')) $('#pop-menu').hidden = true;
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (set.haptic && el.closest('#keybar') && navigator.vibrate) navigator.vibrate(8);
  const f = ACT[el.dataset.act]; if (f) { if (el.tagName === 'A') e.preventDefault(); f(el, e); }
});
$('#vis').addEventListener('change', e => { if (S.explore) return; S.proj.status = e.target.value; markDirty(); toast('Project is now ' + e.target.value); });
$('#file-search').addEventListener('input', () => S.proj && renderDrawer());
$('#set-search').addEventListener('input', renderSettings);
$('#set-body').addEventListener('change', e => { const k = e.target.dataset.set; if (k) setSetting(k, e.target.value); });
$('#set-body').addEventListener('click', e => { const t = e.target.closest('.tg[data-set]'); if (t) { const k = t.dataset.set; setSetting(k, !set[k]); t.classList.toggle('on', !!set[k]); } });

/* ---------- autosave safety net ---------- */
document.addEventListener('visibilitychange', () => { if (document.hidden && S.dirty && S.proj && !S.explore) saveProject(true); });
window.addEventListener('beforeunload', e => { if (S.dirty && !S.explore) { e.preventDefault(); e.returnValue = ''; } });
applySettings();
