'use strict';

/* =========================================================
 * 設定（GASをデプロイしたら GAS_URL を書き換える）
 * ========================================================= */
const CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbwfuR-m17cQY-i27U12rLRMjZMEz2roXuF8gMBxzdm9H_VyqBJMuvtLYa6LmN70WoNihw/exec',
  SESSION_KEY: 'nagarakiki_session',
  PREFS_KEY: 'nagarakiki_prefs',
};

const PRESETS = [
  '作業に集中できるジャズ',
  '70〜80年代の落ち着く邦楽',
  '朝の散歩に合う爽やかな曲',
  '雨の日に聴きたいボサノバ',
  '寝る前のやさしいピアノ',
];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  token: null,
  user: null,
  favorites: [],
  history: [],
  playlists: [],   // [{id, name, items:[{id, videoId, title, channel}]}]
  plMax: 10,
  plMaxItems: 200,
  plOpen: null,    // 開いているプレイリストのID
  plLoaded: false,
  pickItems: [],   // 「プレイリストに追加」で追加しようとしている曲
  pickSuggest: '',
  ai: null,
  queue: [],      // [{videoId, title, channel}]
  order: [],      // 再生順（queue のインデックス）
  pos: -1,        // order 内の現在位置
  source: '',     // 'favorites' | 'ai' | 'history' | 'pl:<ID>'
  sourceLabel: '',
  shuffle: false,
  repeat: 'all',  // 'off' | 'all' | 'one'
  player: null,
  playerReady: false,
  pendingVideo: null,
  lastLogged: null,
  seeking: false,
  errorStreak: 0,
  reorderTimer: null,
  plReorderTimer: null,
};

/* =========================================================
 * ユーティリティ
 * ========================================================= */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function extractVideoId(input) {
  const s = String(input || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[1];
  }
  return '';
}

function extractPlaylistId(input) {
  const s = String(input || '').trim();
  const m = s.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  if (/^(PL|OL|UU|FL|RDCLAK)[A-Za-z0-9_-]{10,}$/.test(s)) return s;
  return '';
}

/** 読み込めないリスト（自動生成ミックス・個人用リスト）か */
function isUnimportableList(listId) {
  return (/^RD/.test(listId) && !/^RDCLAK/.test(listId)) || /^(LL|WL|LM)$/.test(listId);
}

/** 全角→半角・空白除去（iPhoneの自動変換やコピー時の空白対策） */
function normPw(v) {
  return String(v || '').normalize('NFKC').replace(/\s+/g, '');
}
function normEmail(v) {
  return String(v || '').normalize('NFKC').trim();
}

function shuffleArr(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function thumb(videoId) {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
}

let toastTimer;
function toast(msg, type = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.dataset.type = type;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), type === 'error' ? 5000 : 3200);
}

async function withBusy(btn, fn) {
  if (btn && btn.disabled) return;
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '処理中…'; }
  try {
    return await fn();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

function storageGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
}
function storageSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* プライベートモード等 */ }
}
function storageRemove(key) {
  try { localStorage.removeItem(key); } catch (e) { /* noop */ }
}

/* =========================================================
 * API（GAS） — text/plain で送信し、302リダイレクトは fetch が追従
 * ========================================================= */
async function api(action, data = {}) {
  const body = JSON.stringify(Object.assign({ action, token: state.token }, data));
  let res;
  try {
    res = await fetch(CONFIG.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      redirect: 'follow',
    });
  } catch (e) {
    throw new Error('サーバーに接続できませんでした。通信状況を確認してください');
  }
  if (!res.ok) throw new Error(`サーバーエラー（${res.status}）`);

  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw new Error('サーバーの応答を読み取れませんでした（GASのデプロイ設定を確認してください）');
  }
  if (!json.ok) {
    if (json.code === 'AUTH') {
      clearSession();
      $('#app').hidden = true;
      showAuth('login');
    } else if (json.code === 'MUST_CHANGE_PASSWORD') {
      showAuth('setpw');
    }
    const err = new Error(json.error || 'エラーが発生しました');
    err.code = json.code;
    throw err;
  }
  return json;
}

/* =========================================================
 * セッション
 * ========================================================= */
function saveSession(token, expiresAt) {
  state.token = token;
  storageSet(CONFIG.SESSION_KEY, { token, expiresAt });
}
function loadSession() {
  const s = storageGet(CONFIG.SESSION_KEY);
  if (s && s.token && s.expiresAt > Date.now()) return s;
  storageRemove(CONFIG.SESSION_KEY);
  return null;
}
function clearSession() {
  state.token = null;
  state.user = null;
  storageRemove(CONFIG.SESSION_KEY);
  $('#accountMenu').hidden = true;
}

/* =========================================================
 * 認証画面
 * ========================================================= */
function showAuth(panel) {
  const modal = $('#authModal');
  const loggedIn = !!(state.user && state.user.status === 'active' && !$('#app').hidden);
  modal.classList.toggle('overlay', loggedIn);
  modal.hidden = false;
  $$('.auth-panel').forEach(p => { p.hidden = p.dataset.panel !== panel; });

  if (panel === 'setpw') {
    const isChange = !!(state.user && state.user.status === 'active');
    $('#setpwCurrentWrap').hidden = !isChange;
    $('#setpwCurrent').required = isChange;
    $('#setpwTitle').textContent = isChange ? 'パスワードを変更' : '新しいパスワードを設定';
    $('#setpwLead').textContent = isChange
      ? '現在のパスワードと、新しいパスワードを入力してください。'
      : '仮パスワードでログインしました。これから使うパスワードを決めてください。';
    $('#setpwCancel').hidden = !isChange;
    $('#setpwLogout').hidden = isChange;
  }
  const first = $(`.auth-panel[data-panel="${panel}"] input:not([hidden])`);
  if (first && !first.value) setTimeout(() => first.focus(), 50);
}

function hideAuth() {
  $('#authModal').hidden = true;
}

async function enterApp() {
  hideAuth();
  $('#app').hidden = false;
  $('#accountMenu').hidden = false;
  $('#userName').textContent = state.user.nickname || state.user.email;
  const results = await Promise.allSettled([refreshFavorites(), refreshPlaylists()]);
  const failed = results.find(r => r.status === 'rejected');
  if (failed && failed.reason.code !== 'AUTH' && failed.reason.code !== 'MUST_CHANGE_PASSWORD') {
    toast(failed.reason.message, 'error');
  }
}

function bindAuth() {
  // 画面切り替えリンク
  $$('[data-go]').forEach(btn => btn.addEventListener('click', () => {
    const to = btn.dataset.go;
    const email = $('#loginEmail').value || $('#forgotEmail').value || $('#regEmail').value;
    if (to === 'forgot' && email) $('#forgotEmail').value = email;
    if (to === 'reset' && email && !$('#resetEmail').value) $('#resetEmail').value = email;
    showAuth(to);
  }));

  // パスワード表示／非表示
  $$('.pw-toggle').forEach(btn => btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'パスワードを隠す' : 'パスワードを表示');
  }));

  $('#formLogin').addEventListener('submit', e => {
    e.preventDefault();
    withBusy(e.submitter, async () => {
      const r = await api('login', {
        email: normEmail($('#loginEmail').value),
        password: normPw($('#loginPassword').value),
      });
      saveSession(r.token, r.expiresAt);
      state.user = r.user;
      $('#loginPassword').value = '';
      if (r.mustChangePassword) {
        showAuth('setpw');
      } else {
        toast(`おかえりなさい、${r.user.nickname}さん`, 'ok');
        await enterApp();
      }
    });
  });

  $('#formRegister').addEventListener('submit', e => {
    e.preventDefault();
    withBusy(e.submitter, async () => {
      const email = normEmail($('#regEmail').value);
      const r = await api('register', { email, nickname: $('#regNickname').value });
      $('#loginEmail').value = email;
      showAuth('login');
      toast(r.message, 'ok');
    });
  });

  $('#formForgot').addEventListener('submit', e => {
    e.preventDefault();
    withBusy(e.submitter, async () => {
      const email = normEmail($('#forgotEmail').value);
      const r = await api('forgot_password', { email });
      $('#resetEmail').value = email;
      showAuth('reset');
      toast(r.message, 'ok');
    });
  });

  $('#formReset').addEventListener('submit', e => {
    e.preventDefault();
    withBusy(e.submitter, async () => {
      const email = normEmail($('#resetEmail').value);
      const r = await api('reset_password', {
        email,
        code: normPw($('#resetCode').value),
        newPassword: normPw($('#resetPassword').value),
      });
      $('#resetCode').value = '';
      $('#resetPassword').value = '';
      $('#loginEmail').value = email;
      showAuth('login');
      toast(r.message, 'ok');
    });
  });

  $('#formSetPw').addEventListener('submit', e => {
    e.preventDefault();
    const newPw = normPw($('#setpwNew').value);
    if (newPw !== normPw($('#setpwConfirm').value)) {
      toast('確認用のパスワードが一致しません', 'error');
      return;
    }
    withBusy(e.submitter, async () => {
      const r = await api('set_password', {
        currentPassword: normPw($('#setpwCurrent').value),
        newPassword: newPw,
      });
      ['#setpwCurrent', '#setpwNew', '#setpwConfirm'].forEach(s => { $(s).value = ''; });
      const wasInApp = !$('#app').hidden;
      state.user = r.user;
      toast(r.message, 'ok');
      if (wasInApp) hideAuth(); else await enterApp();
    });
  });

  $('#setpwCancel').addEventListener('click', hideAuth);
  $('#setpwLogout').addEventListener('click', logout);
  $('#btnLogout').addEventListener('click', logout);
  $('#btnChangePw').addEventListener('click', () => {
    $('#accountMenu').open = false;
    showAuth('setpw');
  });
}

async function logout() {
  $('#accountMenu').open = false;
  try { await api('logout'); } catch (e) { /* 失敗してもローカルは消す */ }
  clearSession();
  if (state.playerReady) state.player.stopVideo();
  Object.assign(state, {
    favorites: [], history: [], ai: null, queue: [], order: [], pos: -1, source: '',
    playlists: [], plOpen: null, plLoaded: false, pickItems: [],
  });
  $('#aiResult').innerHTML = '';
  closeDialogs();
  renderPlaylists();
  updateNowPlaying();
  $('#app').hidden = true;
  showAuth('login');
}

/* =========================================================
 * YouTube プレイヤー
 * ========================================================= */
function loadYouTubeApi() {
  const s = document.createElement('script');
  s.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(s);
}

window.onYouTubeIframeAPIReady = function () {
  state.player = new YT.Player('ytPlayer', {
    width: '100%',
    height: '100%',
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
    events: {
      onReady: () => {
        state.playerReady = true;
        if (state.pendingVideo) {
          state.player.loadVideoById(state.pendingVideo);
          state.pendingVideo = null;
        }
      },
      onStateChange: onPlayerStateChange,
      onError: onPlayerError,
    },
  });
};

function onPlayerStateChange(e) {
  const S = YT.PlayerState;
  const playing = e.data === S.PLAYING || e.data === S.BUFFERING;
  $('#btnPlay').dataset.playing = String(playing);
  $('#playLabel').textContent = playing ? '一時停止' : '再生';

  if (e.data === S.PLAYING) {
    state.errorStreak = 0;
    $('#screenEmpty').hidden = true;
    const item = currentItem();
    if (item && state.lastLogged !== item.videoId) {
      state.lastLogged = item.videoId;
      api('add_history', { videoId: item.videoId, title: item.title }).catch(() => {});
    }
  } else if (e.data === S.ENDED) {
    next(true);
  }
}

function onPlayerError(e) {
  // 2:無効なID 5:HTML5エラー 100:見つからない 101/150:埋め込み不可
  state.errorStreak++;
  const item = currentItem();
  if (state.errorStreak >= Math.max(1, state.queue.length)) {
    toast('再生できる曲がありませんでした', 'error');
    return;
  }
  toast(`「${item ? item.title : 'この動画'}」は再生できないため、次の曲へ進みます`, 'error');
  setTimeout(() => next(true, true), 1200);
}

function currentItem() {
  return state.pos >= 0 && state.pos < state.order.length ? state.queue[state.order[state.pos]] : null;
}

function buildOrder(startIndex) {
  const n = state.queue.length;
  const idx = [...Array(n).keys()];
  if (state.shuffle) {
    const rest = shuffleArr(idx.filter(i => i !== startIndex));
    state.order = startIndex >= 0 ? [startIndex, ...rest] : rest;
    state.pos = startIndex >= 0 ? 0 : -1;
  } else {
    state.order = idx;
    state.pos = startIndex;
  }
}

function playList(list, startIndex, source, label) {
  if (!list.length) return;
  state.queue = list.map(x => ({ videoId: x.videoId, title: x.title, channel: x.channel || '' }));
  state.source = source;
  state.sourceLabel = label;
  state.errorStreak = 0;
  buildOrder(startIndex);
  playCurrent();
}

function playCurrent() {
  const item = currentItem();
  if (!item) return;
  state.lastLogged = null;
  updateNowPlaying();
  renderFavorites();
  renderPlaylists();
  renderAi();
  renderHistory();
  if (state.playerReady) state.player.loadVideoById(item.videoId);
  else state.pendingVideo = item.videoId;
}

function next(auto = false, skipRepeatOne = false) {
  if (!state.queue.length) return;
  if (auto && !skipRepeatOne && state.repeat === 'one' && currentItem()) {
    state.player.seekTo(0, true);
    state.player.playVideo();
    return;
  }
  if (state.pos < state.order.length - 1) {
    state.pos++;
  } else if (!auto || state.repeat !== 'off') {
    if (state.shuffle) buildOrder(Math.floor(Math.random() * state.queue.length));
    else state.pos = 0;
  } else {
    toast('最後の曲まで再生しました');
    return;
  }
  playCurrent();
}

function prev() {
  if (!state.queue.length) return;
  const t = state.playerReady && state.player.getCurrentTime ? state.player.getCurrentTime() : 0;
  if (t > 3 && currentItem()) {
    state.player.seekTo(0, true);
    return;
  }
  state.pos = state.pos > 0 ? state.pos - 1 : state.order.length - 1;
  playCurrent();
}

function togglePlay() {
  if (!state.queue.length || !currentItem()) {
    const pl = state.playlists.find(p => p.id === state.plOpen && p.items.length);
    if (pl && !$('#panel-pl').hidden) playPlaylist(pl, 0);
    else if (state.favorites.length) playList(state.favorites, 0, 'favorites', 'お気に入り');
    else toast('まずお気に入りに曲を追加してください');
    return;
  }
  if (!state.playerReady) return;
  const st = state.player.getPlayerState();
  if (st === YT.PlayerState.PLAYING || st === YT.PlayerState.BUFFERING) state.player.pauseVideo();
  else state.player.playVideo();
}

function toggleShuffle() {
  state.shuffle = !state.shuffle;
  if (state.queue.length) {
    const cur = state.pos >= 0 ? state.order[state.pos] : -1;
    buildOrder(cur);
    updateNowPlaying();
  }
  savePrefs();
  updateModeButtons();
  toast(state.shuffle ? 'シャッフル：オン' : 'シャッフル：オフ');
}

function cycleRepeat() {
  state.repeat = { off: 'all', all: 'one', one: 'off' }[state.repeat];
  savePrefs();
  updateModeButtons();
}

function updateModeButtons() {
  $('#btnShuffle').setAttribute('aria-pressed', String(state.shuffle));
  $('#btnRepeat').setAttribute('aria-pressed', String(state.repeat !== 'off'));
  $('#repeatLabel').textContent = { off: 'リピートなし', all: '全曲リピート', one: '1曲リピート' }[state.repeat];
}

/** リストの変更を、再生中のキューへ反映 */
function syncQueue(source, list) {
  if (state.source !== source || !state.queue.length) return;
  const cur = currentItem();
  state.queue = list.map(f => ({ videoId: f.videoId, title: f.title, channel: f.channel || '' }));
  if (!state.queue.length) { state.order = []; state.pos = -1; updateNowPlaying(); return; }
  const idx = cur ? state.queue.findIndex(q => q.videoId === cur.videoId) : -1;
  if (idx >= 0) {
    buildOrder(idx);
  } else {
    // 再生中の曲が削除された：この曲はそのまま流し、次から新しいリストへ
    buildOrder(0);
    state.pos = -1;
  }
  updateNowPlaying();
}

function syncQueueFromFavorites() {
  syncQueue('favorites', state.favorites);
}

function syncQueueFromPlaylists() {
  if (!state.source.startsWith('pl:')) return;
  const pl = findPlaylist(state.source.slice(3));
  if (!pl) {
    // 再生中のプレイリストが削除された：今の曲はそのまま、以後はキューなし扱い
    state.source = '';
    state.sourceLabel = '（削除されたプレイリスト）';
    updateNowPlaying();
    return;
  }
  state.sourceLabel = `プレイリスト「${pl.name}」`;
  syncQueue(state.source, pl.items);
}

function updateNowPlaying() {
  const item = currentItem();
  if (item) {
    $('#nowTitle').textContent = item.title;
    $('#nowSub').textContent = item.channel;
    $('#queueInfo').textContent = `${state.sourceLabel}　${state.pos + 1} / ${state.order.length}曲目`;
    document.title = `${item.title} | ながら聴き`;
    $('#btnNowToPl').hidden = false;
  } else if (!state.queue.length) {
    $('#btnNowToPl').hidden = true;
    $('#nowTitle').textContent = '再生していません';
    $('#nowSub').textContent = '';
    $('#queueInfo').textContent = '';
    document.title = 'ながら聴き';
  }
}

/* シーク（選局ダイヤル） */
function setDial(ratio) {
  const pct = Math.min(100, Math.max(0, ratio * 100));
  $('#needle').style.left = pct + '%';
  $('#dialFill').style.width = pct + '%';
}

function tick() {
  if (!state.playerReady || state.seeking || !state.player.getDuration) return;
  const d = state.player.getDuration() || 0;
  const c = state.player.getCurrentTime() || 0;
  const ratio = d ? c / d : 0;
  setDial(ratio);
  $('#seek').value = Math.round(ratio * 1000);
  $('#seek').setAttribute('aria-valuetext', `${fmtTime(c)} / ${fmtTime(d)}`);
  $('#tCur').textContent = fmtTime(c);
  $('#tDur').textContent = fmtTime(d);
}

function bindPlayer() {
  $('#btnPlay').addEventListener('click', togglePlay);
  $('#btnNext').addEventListener('click', () => next(false));
  $('#btnPrev').addEventListener('click', prev);
  $('#btnShuffle').addEventListener('click', toggleShuffle);
  $('#btnRepeat').addEventListener('click', cycleRepeat);

  const seek = $('#seek');
  seek.addEventListener('input', () => {
    state.seeking = true;
    const ratio = seek.value / 1000;
    setDial(ratio);
    const d = state.playerReady && state.player.getDuration ? state.player.getDuration() : 0;
    $('#tCur').textContent = fmtTime(d * ratio);
  });
  seek.addEventListener('change', () => {
    const d = state.playerReady && state.player.getDuration ? state.player.getDuration() : 0;
    if (d) state.player.seekTo(d * (seek.value / 1000), true);
    state.seeking = false;
  });

  setInterval(tick, 500);

  // 対応ブラウザではメディアキー（ヘッドホンのボタン等）で曲送り
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('nexttrack', () => next(false));
      navigator.mediaSession.setActionHandler('previoustrack', prev);
    } catch (e) { /* 非対応 */ }
  }
}

/* =========================================================
 * お気に入り
 * ========================================================= */
async function refreshFavorites() {
  const r = await api('get_favorites');
  state.favorites = r.favorites;
  renderFavorites();
  syncQueueFromFavorites();
}

function isCurrent(videoId) {
  const cur = currentItem();
  return !!(cur && cur.videoId === videoId);
}

function renderFavorites() {
  const ul = $('#favList');
  const n = state.favorites.length;
  $('#favCount').textContent = n ? `${n}曲` : '';
  $('#btnPlayFav').disabled = !n;
  $('#btnShufflePlayFav').disabled = !n;
  if (!n) {
    ul.innerHTML = '<li class="empty">まだお気に入りがありません。上の欄にYouTubeのURLを貼るか、「AI選曲」で曲を探して追加してください。</li>';
    return;
  }
  ul.innerHTML = state.favorites.map((f, i) => `
    <li class="track ${isCurrent(f.videoId) ? 'is-current' : ''}" data-i="${i}">
      <button type="button" class="track-main" data-act="play" aria-label="${esc(f.title)} を再生">
        <img class="thumb" src="${thumb(f.videoId)}" alt="" loading="lazy">
        <span class="track-text">
          <span class="track-title">${esc(f.title)}</span>
          <span class="track-sub">${esc(f.channel)}</span>
        </span>
      </button>
      <div class="track-tools grid2">
        <button type="button" class="icon-btn" data-act="up" aria-label="上へ移動" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="icon-btn" data-act="down" aria-label="下へ移動" ${i === n - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="icon-btn" data-act="to-pl" aria-label="プレイリストに追加">＋</button>
        <button type="button" class="icon-btn danger" data-act="delete" aria-label="削除">削除</button>
      </div>
    </li>`).join('');
}

function moveFavorite(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= state.favorites.length) return;
  const arr = state.favorites;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  renderFavorites();
  syncQueueFromFavorites();
  const btn = $(`#favList .track[data-i="${j}"] [data-act="${dir < 0 ? 'up' : 'down'}"]`);
  if (btn && !btn.disabled) btn.focus();

  clearTimeout(state.reorderTimer);
  state.reorderTimer = setTimeout(() => {
    api('reorder_favorites', { ids: state.favorites.map(f => f.id) })
      .catch(e => toast('並び順を保存できませんでした：' + e.message, 'error'));
  }, 900);
}

async function deleteFavorite(i) {
  const f = state.favorites[i];
  if (!f || !confirm(`「${f.title}」をお気に入りから削除しますか？`)) return;
  try {
    const r = await api('delete_favorite', { id: f.id });
    state.favorites = r.favorites;
    renderFavorites();
    syncQueueFromFavorites();
    toast('削除しました');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function addFavorites(items) {
  const r = await api('save_favorite', { items });
  state.favorites = r.favorites;
  renderFavorites();
  syncQueueFromFavorites();
  renderAi();
  renderHistory();
  if (r.added.length && !r.skipped.length) {
    toast(r.added.length === 1 ? `「${r.added[0].title}」を追加しました` : `${r.added.length}曲を追加しました`, 'ok');
  } else if (r.added.length) {
    toast(`${r.added.length}曲を追加しました（${r.skipped.length}件は追加できませんでした）`, 'ok');
  } else if (r.skipped.length) {
    toast(r.skipped[0].reason, 'error');
  }
  return r;
}

async function importPlaylist(url) {
  const r = await api('import_playlist', { url });
  state.favorites = r.favorites;
  renderFavorites();
  syncQueueFromFavorites();
  renderAi();
  renderHistory();
  const notes = [];
  if (r.duplicated) notes.push(`登録済み${r.duplicated}曲`);
  if (r.unavailable) notes.push(`再生できない${r.unavailable}曲`);
  const tail = notes.length ? `（${notes.join('、')}は除外）` : '';
  if (r.added.length) toast(`${r.added.length}曲を追加しました${tail}`, 'ok');
  else toast(`追加できる曲がありませんでした${tail}`, 'error');
  return r;
}

function inFavorites(videoId) {
  return state.favorites.some(f => f.videoId === videoId);
}

function bindFavorites() {
  $('#formAdd').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#addUrl');
    const val = input.value.trim();
    const vid = extractVideoId(val);
    const listId = extractPlaylistId(val);
    const btn = e.submitter;

    // プレイリストURL
    if (listId && !isUnimportableList(listId)) {
      const msg = vid
        ? 'このURLにはプレイリストが含まれています。\n\n「OK」→ プレイリストの曲をまとめて追加\n「キャンセル」→ この1曲だけ追加'
        : 'このプレイリストの曲を、まとめてお気に入りに追加しますか？（最大200曲）';
      if (confirm(msg)) {
        withBusy(btn, async () => {
          if (btn) btn.textContent = '読み込み中…';
          toast('プレイリストを読み込んでいます…');
          const r = await importPlaylist(val);
          if (r) input.value = '';
        });
        return;
      }
      if (!vid) return;
    } else if (listId && !vid) {
      toast('「ミックス」や「後で見る」などの自動・個人用リストは読み込めません。通常のプレイリストか、動画のURLを貼ってください', 'error');
      return;
    }

    if (!vid) {
      toast('YouTubeの動画またはプレイリストのURLを貼り付けてください', 'error');
      return;
    }
    withBusy(btn, async () => {
      const r = await addFavorites([{ url: vid }]);
      if (r.added.length) input.value = '';
    });
  });

  $('#favList').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const i = Number(btn.closest('.track').dataset.i);
    const act = btn.dataset.act;
    if (act === 'play') playList(state.favorites, i, 'favorites', 'お気に入り');
    else if (act === 'up') moveFavorite(i, -1);
    else if (act === 'down') moveFavorite(i, 1);
    else if (act === 'delete') deleteFavorite(i);
    else if (act === 'to-pl') openPicker([state.favorites[i]]);
  });

  $('#btnPlayFav').addEventListener('click', () => {
    if (state.shuffle) toggleShuffle();
    playList(state.favorites, 0, 'favorites', 'お気に入り');
  });
  $('#btnShufflePlayFav').addEventListener('click', () => {
    if (!state.shuffle) toggleShuffle();
    playList(state.favorites, Math.floor(Math.random() * state.favorites.length), 'favorites', 'お気に入り');
  });
}

/* =========================================================
 * AI選曲
 * ========================================================= */
function aiPlayable() {
  return state.ai ? state.ai.items.filter(it => it.videoId) : [];
}

function aiAsTrack(it) {
  return {
    videoId: it.videoId,
    title: it.ytTitle || [it.title, it.artist].filter(Boolean).join(' / '),
    channel: it.channel || it.artist || '',
  };
}

function renderAi() {
  const box = $('#aiResult');
  if (!state.ai) { box.innerHTML = ''; return; }
  const { playlistTitle, comment, items, searchEnabled } = state.ai;
  const playable = aiPlayable();
  const notAdded = playable.filter(it => !inFavorites(it.videoId));

  box.innerHTML = `
    <div class="ai-head">
      <h3>${esc(playlistTitle)}</h3>
      <p>${esc(comment)}</p>
      ${playable.length ? `
        <div class="ai-actions">
          <button type="button" class="btn primary" data-act="ai-playall">この選曲で再生（${playable.length}曲）</button>
          <button type="button" class="btn" data-act="ai-addall" ${notAdded.length ? '' : 'disabled'}>
            ${notAdded.length ? `まとめてお気に入りに追加（${notAdded.length}曲）` : 'すべて追加済み'}
          </button>
          <button type="button" class="btn" data-act="ai-allpl">まとめてプレイリストへ</button>
        </div>` : ''}
      ${!searchEnabled ? '<p class="note">動画の自動検索が未設定です。「YouTubeで探す」から動画を開き、URLを「お気に入り」の欄に貼り付けてください。</p>' : ''}
    </div>
    <ul class="list">
      ${items.map((it, i) => {
        const has = !!it.videoId;
        const added = has && inFavorites(it.videoId);
        const searchUrl = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(it.query);
        return `
        <li class="track ${has && isCurrent(it.videoId) ? 'is-current' : ''}" data-i="${i}">
          <${has ? 'button type="button" data-act="ai-play"' : 'div'} class="track-main ${has ? '' : 'static'}">
            ${has ? `<img class="thumb" src="${thumb(it.videoId)}" alt="" loading="lazy">` : '<span class="thumb none">未検索</span>'}
            <span class="track-text">
              <span class="track-title">${esc(it.title)}</span>
              <span class="track-sub">${esc(it.artist)}${has && it.ytTitle ? `（${esc(it.ytTitle)}）` : ''}</span>
              ${it.reason ? `<span class="track-reason">${esc(it.reason)}</span>` : ''}
            </span>
          </${has ? 'button' : 'div'}>
          <div class="track-tools">
            ${has
              ? `<button type="button" class="icon-btn" data-act="ai-add" ${added ? 'disabled' : ''}>${added ? '追加済み' : '追加'}</button>
                 <button type="button" class="icon-btn" data-act="ai-topl" aria-label="プレイリストに追加">＋</button>`
              : `<a class="icon-btn btn small" href="${searchUrl}" target="_blank" rel="noopener">YouTubeで探す</a>`}
          </div>
        </li>`;
      }).join('')}
    </ul>`;
}

function bindAi() {
  $('#aiChips').innerHTML = PRESETS.map(p => `<button type="button" class="chip">${esc(p)}</button>`).join('');
  $('#aiChips').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    $('#aiPrompt').value = chip.textContent;
    $('#formAi').requestSubmit();
  });

  $('#formAi').addEventListener('submit', e => {
    e.preventDefault();
    const prompt = $('#aiPrompt').value.trim();
    if (!prompt) return;
    const btn = $('#btnAi');
    withBusy(btn, async () => {
      btn.textContent = '選曲しています…';
      $('#aiResult').innerHTML = '<p class="empty">AIが選曲しています。10〜20秒ほどお待ちください。</p>';
      try {
        const r = await api('gemini_recommend', { prompt });
        state.ai = r;
        renderAi();
      } catch (err) {
        $('#aiResult').innerHTML = '';
        throw err;
      }
    });
  });

  $('#aiResult').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn || !state.ai) return;
    const act = btn.dataset.act;
    const playable = aiPlayable();
    const label = `AI選曲「${state.ai.playlistTitle}」`;

    if (act === 'ai-playall') {
      playList(playable.map(aiAsTrack), state.shuffle ? Math.floor(Math.random() * playable.length) : 0, 'ai', label);
    } else if (act === 'ai-addall') {
      const items = playable.filter(it => !inFavorites(it.videoId)).map(aiAsTrack);
      withBusy(btn, () => addFavorites(items));
    } else if (act === 'ai-allpl') {
      openPicker(playable.map(aiAsTrack), state.ai.playlistTitle);
    } else {
      const it = state.ai.items[Number(btn.closest('.track').dataset.i)];
      if (act === 'ai-play') {
        playList(playable.map(aiAsTrack), playable.indexOf(it), 'ai', label);
      } else if (act === 'ai-add') {
        withBusy(btn, () => addFavorites([aiAsTrack(it)]));
      } else if (act === 'ai-topl') {
        openPicker([aiAsTrack(it)]);
      }
    }
  });
}

/* =========================================================
 * プレイリスト（1人10個まで）
 * ========================================================= */
const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4.5v15l12-7.5z"/></svg>';

function findPlaylist(id) {
  return state.playlists.find(p => p.id === id) || null;
}

function applyPlaylists(r) {
  state.playlists = r.playlists || [];
  if (r.max) state.plMax = r.max;
  if (r.maxItems) state.plMaxItems = r.maxItems;
  state.plLoaded = true;
  if (state.plOpen && !findPlaylist(state.plOpen)) state.plOpen = null;
  renderPlaylists();
  syncQueueFromPlaylists();
}

async function refreshPlaylists() {
  const r = await api('pl_list');
  applyPlaylists(r);
}

function playPlaylist(pl, startIndex) {
  if (!pl || !pl.items.length) {
    toast('このプレイリストにはまだ曲がありません');
    return;
  }
  playList(pl.items, startIndex, 'pl:' + pl.id, `プレイリスト「${pl.name}」`);
}

function coverHtml(pl) {
  const ids = pl.items.slice(0, 4).map(it => it.videoId);
  if (!ids.length) return '<span class="pl-cover"><span class="blank">まだ曲がありません</span></span>';
  if (ids.length < 4) return `<span class="pl-cover one"><img src="${thumb(ids[0])}" alt="" loading="lazy"></span>`;
  return `<span class="pl-cover">${ids.map(id => `<img src="${thumb(id)}" alt="" loading="lazy">`).join('')}</span>`;
}

function renderPlaylists() {
  const n = state.playlists.length;
  $('#plTabCount').textContent = n ? `${n}` : '';
  const open = state.plOpen ? findPlaylist(state.plOpen) : null;
  $('#plIndex').hidden = !!open;
  $('#plDetail').hidden = !open;

  // 一覧
  const rest = state.plMax - n;
  $('#plLimit').textContent = `${n} / ${state.plMax} 個`;
  $('#btnPlNew').disabled = rest <= 0;
  const cards = state.playlists.map(pl => `
    <li class="pl-card ${state.source === 'pl:' + pl.id ? 'is-playing' : ''}" data-id="${esc(pl.id)}">
      <button type="button" class="pl-open" data-act="pl-open" aria-label="${esc(pl.name)} を開く">
        ${coverHtml(pl)}
        <span class="pl-meta">
          <span class="pl-meta-name">${esc(pl.name)}</span>
          <span class="pl-meta-sub">${pl.items.length}曲${state.source === 'pl:' + pl.id ? '・再生中' : ''}</span>
        </span>
      </button>
      ${pl.items.length ? `<button type="button" class="pl-play" data-act="pl-play" aria-label="${esc(pl.name)} を再生">${PLAY_ICON}</button>` : ''}
    </li>`).join('');
  const slot = rest > 0
    ? `<li class="pl-slot">${n ? `あと${rest}個つくれます` : '「＋ 新しいプレイリスト」から<br>最大' + state.plMax + '個までつくれます'}</li>`
    : '';
  $('#plGrid').innerHTML = !state.plLoaded ? '<li class="empty">読み込んでいます…</li>' : cards + slot;

  // 中身
  if (!open) return;
  $('#plName').textContent = open.name;
  $('#plCount').textContent = `${open.items.length} / ${state.plMaxItems}曲`;
  $('#btnPlPlay').disabled = !open.items.length;
  $('#btnPlShuffle').disabled = !open.items.length;
  const ul = $('#plItems');
  const m = open.items.length;
  if (!m) {
    ul.innerHTML = '<li class="empty">まだ曲がありません。上の欄にURLを貼るか、「お気に入りから追加」を押してください。お気に入り・AI選曲・履歴の「＋」ボタンからも追加できます。</li>';
    return;
  }
  ul.innerHTML = open.items.map((it, i) => `
    <li class="track ${isCurrent(it.videoId) && state.source === 'pl:' + open.id ? 'is-current' : ''}" data-i="${i}">
      <button type="button" class="track-main" data-act="pi-play" aria-label="${esc(it.title)} を再生">
        <img class="thumb" src="${thumb(it.videoId)}" alt="" loading="lazy">
        <span class="track-text">
          <span class="track-title">${esc(it.title)}</span>
          <span class="track-sub">${esc(it.channel)}</span>
        </span>
      </button>
      <div class="track-tools grid2">
        <button type="button" class="icon-btn" data-act="pi-up" aria-label="上へ移動" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="icon-btn" data-act="pi-down" aria-label="下へ移動" ${i === m - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="icon-btn" data-act="pi-topl" aria-label="ほかのプレイリストにも追加">＋</button>
        <button type="button" class="icon-btn danger" data-act="pi-remove" aria-label="このプレイリストから外す">外す</button>
      </div>
    </li>`).join('');
}

function openPlaylist(id) {
  state.plOpen = id;
  renderPlaylists();
  window.scrollTo({ top: $('.tabs').offsetTop - 8, behavior: 'smooth' });
}

function askName(defaultName) {
  const v = prompt(`プレイリストの名前（${30}文字まで）`, defaultName || '');
  if (v === null) return null;
  const name = v.replace(/\s+/g, ' ').trim();
  if (!name) { toast('名前を入力してください', 'error'); return null; }
  if (name.length > 30) { toast('名前は30文字以内にしてください', 'error'); return null; }
  return name;
}

function nextDefaultName() {
  for (let i = 1; i <= 99; i++) {
    const n = `プレイリスト${i}`;
    if (!state.playlists.some(p => p.name === n)) return n;
  }
  return '';
}

function toastAddResult(r, plName) {
  const added = (r.added || []).length;
  const skipped = r.skipped || [];
  if (added && !skipped.length) {
    toast(added === 1 ? `「${plName}」に「${r.added[0].title}」を追加しました` : `「${plName}」に${added}曲を追加しました`, 'ok');
  } else if (added) {
    toast(`「${plName}」に${added}曲を追加しました（${skipped.length}件は追加できませんでした）`, 'ok');
  } else if (skipped.length) {
    toast(skipped.length === 1 ? skipped[0].reason : `追加できませんでした（${skipped[0].reason}）`, 'error');
  }
}

async function createPlaylist(name, items) {
  const r = await api('pl_create', { name, items: items || [] });
  applyPlaylists(r);
  if (items && items.length) toastAddResult(r, name);
  else toast(`「${name}」を作りました`, 'ok');
  return r;
}

async function addToPlaylist(pl, items) {
  const r = await api('pl_add', { id: pl.id, items });
  applyPlaylists(r);
  toastAddResult(r, pl.name);
  return r;
}

function movePlItem(pl, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= pl.items.length) return;
  [pl.items[i], pl.items[j]] = [pl.items[j], pl.items[i]];
  renderPlaylists();
  syncQueueFromPlaylists();
  const btn = $(`#plItems .track[data-i="${j}"] [data-act="${dir < 0 ? 'pi-up' : 'pi-down'}"]`);
  if (btn && !btn.disabled) btn.focus();

  clearTimeout(state.plReorderTimer);
  const id = pl.id;
  state.plReorderTimer = setTimeout(() => {
    const cur = findPlaylist(id);
    if (!cur) return;
    api('pl_reorder', { id, itemIds: cur.items.map(x => x.id) })
      .catch(e => toast('並び順を保存できませんでした：' + e.message, 'error'));
  }, 900);
}

async function removePlItem(pl, i) {
  const it = pl.items[i];
  if (!it || !confirm(`「${it.title}」を「${pl.name}」から外しますか？\n（お気に入りには影響しません）`)) return;
  try {
    applyPlaylists(await api('pl_remove', { id: pl.id, itemId: it.id }));
    toast('外しました');
  } catch (e) {
    toast(e.message, 'error');
  }
}

function bindPlaylists() {
  $('#btnPlNew').addEventListener('click', e => {
    if (state.playlists.length >= state.plMax) {
      toast(`プレイリストは${state.plMax}個までです`, 'error');
      return;
    }
    const name = askName(nextDefaultName());
    if (!name) return;
    withBusy(e.currentTarget, async () => {
      const r = await createPlaylist(name);
      openPlaylist(r.createdId);
    });
  });

  $('#plGrid').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const pl = findPlaylist(btn.closest('.pl-card').dataset.id);
    if (!pl) return;
    if (btn.dataset.act === 'pl-open') openPlaylist(pl.id);
    else if (btn.dataset.act === 'pl-play') {
      playPlaylist(pl, state.shuffle ? Math.floor(Math.random() * pl.items.length) : 0);
    }
  });

  $('#btnPlBack').addEventListener('click', () => {
    state.plOpen = null;
    renderPlaylists();
  });

  $('#btnPlPlay').addEventListener('click', () => {
    const pl = findPlaylist(state.plOpen);
    if (!pl) return;
    if (state.shuffle) toggleShuffle();
    playPlaylist(pl, 0);
  });
  $('#btnPlShuffle').addEventListener('click', () => {
    const pl = findPlaylist(state.plOpen);
    if (!pl) return;
    if (!state.shuffle) toggleShuffle();
    playPlaylist(pl, Math.floor(Math.random() * pl.items.length));
  });

  $('#btnPlRename').addEventListener('click', e => {
    const pl = findPlaylist(state.plOpen);
    if (!pl) return;
    const name = askName(pl.name);
    if (!name || name === pl.name) return;
    withBusy(e.currentTarget, async () => {
      applyPlaylists(await api('pl_rename', { id: pl.id, name }));
      toast('名前を変更しました', 'ok');
    });
  });

  $('#btnPlDelete').addEventListener('click', e => {
    const pl = findPlaylist(state.plOpen);
    if (!pl) return;
    if (!confirm(`プレイリスト「${pl.name}」（${pl.items.length}曲）を削除しますか？\n元に戻せません。お気に入りには影響しません。`)) return;
    withBusy(e.currentTarget, async () => {
      applyPlaylists(await api('pl_delete', { id: pl.id }));
      state.plOpen = null;
      renderPlaylists();
      toast('削除しました');
    });
  });

  $('#formPlAdd').addEventListener('submit', e => {
    e.preventDefault();
    const pl = findPlaylist(state.plOpen);
    if (!pl) return;
    const input = $('#plAddUrl');
    const val = input.value.trim();
    const vid = extractVideoId(val);
    const listId = extractPlaylistId(val);
    const btn = e.submitter;

    // YouTubeのプレイリストURL → まとめて取り込み
    if (listId && !isUnimportableList(listId)) {
      const room = state.plMaxItems - pl.items.length;
      const msg = vid
        ? `このURLにはプレイリストが含まれています。\n\n「OK」→ プレイリストの曲をまとめて「${pl.name}」に追加\n「キャンセル」→ この1曲だけ追加`
        : `このプレイリストの曲を、まとめて「${pl.name}」に追加しますか？（あと${room}曲まで入ります）`;
      if (confirm(msg)) {
        withBusy(btn, async () => {
          if (btn) btn.textContent = '読み込み中…';
          toast('プレイリストを読み込んでいます…');
          const r = await api('pl_import', { id: pl.id, url: val });
          applyPlaylists(r);
          const notes = [];
          if (r.duplicated) notes.push(`登録済み${r.duplicated}曲`);
          if (r.unavailable) notes.push(`再生できない${r.unavailable}曲`);
          if (r.full) notes.push(`上限を超えた${r.full}曲`);
          const tail = notes.length ? `（${notes.join('、')}は除外）` : '';
          if (r.added.length) {
            toast(`「${pl.name}」に${r.added.length}曲を追加しました${tail}`, 'ok');
            input.value = '';
          } else {
            toast(`追加できる曲がありませんでした${tail}`, 'error');
          }
        });
        return;
      }
      if (!vid) return;
    } else if (listId && !vid) {
      toast('「ミックス」や「後で見る」などの自動・個人用リストは読み込めません。通常のプレイリストか、動画のURLを貼ってください', 'error');
      return;
    }

    if (!vid) {
      toast('YouTubeの動画またはプレイリストのURLを貼り付けてください', 'error');
      return;
    }
    withBusy(btn, async () => {
      const r = await api('pl_add', { id: pl.id, url: vid });
      applyPlaylists(r);
      toastAddResult(r, pl.name);
      if ((r.added || []).length) input.value = '';
    });
  });

  $('#plItems').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const pl = findPlaylist(state.plOpen);
    if (!pl) return;
    const i = Number(btn.closest('.track').dataset.i);
    const act = btn.dataset.act;
    if (act === 'pi-play') playPlaylist(pl, i);
    else if (act === 'pi-up') movePlItem(pl, i, -1);
    else if (act === 'pi-down') movePlItem(pl, i, 1);
    else if (act === 'pi-remove') removePlItem(pl, i);
    else if (act === 'pi-topl') openPicker([pl.items[i]]);
  });

  $('#btnPlFromFav').addEventListener('click', openFavPicker);

  $('#btnNowToPl').addEventListener('click', () => {
    const it = currentItem();
    if (it) openPicker([it]);
  });
}

/* ---------- ダイアログ：どのプレイリストに入れるか ---------- */
function openPicker(items, suggestName) {
  items = (items || []).filter(it => it && it.videoId)
    .map(it => ({ videoId: it.videoId, title: it.title, channel: it.channel || '' }));
  if (!items.length) return;
  if (!state.plLoaded) {
    refreshPlaylists().then(() => openPicker(items, suggestName)).catch(e => toast(e.message, 'error'));
    return;
  }
  state.pickItems = items;
  state.pickSuggest = suggestName || '';
  $('#pickLead').textContent = items.length === 1
    ? `「${items[0].title}」を追加するプレイリストを選んでください`
    : `${items.length}曲を追加するプレイリストを選んでください`;
  renderPicker();
  showDialog($('#dlgPick'));
}

function renderPicker() {
  const items = state.pickItems;
  const rows = state.playlists.map(pl => {
    const have = new Set(pl.items.map(x => x.videoId));
    const fresh = items.filter(it => !have.has(it.videoId)).length;
    const room = state.plMaxItems - pl.items.length;
    let note = `${pl.items.length}曲`;
    if (!fresh) note = items.length === 1 ? '追加済み' : 'すべて追加済み';
    else if (room <= 0) note = '満杯';
    const disabled = !fresh || room <= 0;
    const cover = pl.items.length
      ? `<img class="thumb" src="${thumb(pl.items[0].videoId)}" alt="" loading="lazy">`
      : '<span class="thumb none">空</span>';
    return `<li><button type="button" class="pick-item" data-id="${esc(pl.id)}" ${disabled ? 'disabled' : ''}>
      ${cover}<span class="pick-name">${esc(pl.name)}</span><span class="pick-note">${note}</span>
    </button></li>`;
  }).join('');
  const canNew = state.playlists.length < state.plMax;
  $('#pickList').innerHTML = rows + (canNew
    ? `<li><button type="button" class="pick-item new" data-new="1">＋ 新しいプレイリストを作って追加（あと${state.plMax - state.playlists.length}個）</button></li>`
    : `<li class="hint">プレイリストは${state.plMax}個までです。新しく作るには、不要なプレイリストを削除してください。</li>`);
}

/* ---------- ダイアログ：お気に入りから選ぶ ---------- */
function openFavPicker() {
  const pl = findPlaylist(state.plOpen);
  if (!pl) return;
  if (!state.favorites.length) {
    toast('お気に入りがまだありません');
    return;
  }
  const have = new Set(pl.items.map(x => x.videoId));
  $('#favPickTitle').textContent = `「${pl.name}」にお気に入りから追加`;
  $('#favPickList').innerHTML = state.favorites.map((f, i) => {
    const done = have.has(f.videoId);
    return `<li><label class="check-row ${done ? 'is-done' : ''}">
      <input type="checkbox" value="${i}" ${done ? 'checked disabled' : ''}>
      <img class="thumb" src="${thumb(f.videoId)}" alt="" loading="lazy">
      <span class="track-text">
        <span class="track-title">${esc(f.title)}</span>
        <span class="track-sub">${done ? '追加済み' : esc(f.channel)}</span>
      </span>
    </label></li>`;
  }).join('');
  updateFavPickCount();
  showDialog($('#dlgFav'));
}

function favPickBoxes() {
  return $$('#favPickList input[type="checkbox"]:not(:disabled)');
}

function updateFavPickCount() {
  const pl = findPlaylist(state.plOpen);
  const boxes = favPickBoxes();
  const n = boxes.filter(b => b.checked).length;
  const room = pl ? state.plMaxItems - pl.items.length : 0;
  $('#favPickCount').textContent = `${n}曲を選択中（あと${room}曲入ります）`;
  $('#favPickOk').disabled = !n;
  $('#favPickAll').textContent = boxes.length && boxes.every(b => b.checked) ? '選択を解除' : 'すべて選ぶ';
  $('#favPickAll').hidden = !boxes.length;
}

/* ---------- ダイアログ共通 ---------- */
function showDialog(dlg) {
  if (typeof dlg.showModal === 'function') {
    if (!dlg.open) dlg.showModal();
  } else {
    dlg.setAttribute('open', '');
  }
}
function closeDialog(dlg) {
  if (typeof dlg.close === 'function' && dlg.open) dlg.close();
  else dlg.removeAttribute('open');
}
function closeDialogs() {
  $$('dialog.sheet').forEach(closeDialog);
}

function bindDialogs() {
  $$('dialog.sheet').forEach(dlg => {
    dlg.addEventListener('click', e => {
      if (e.target === dlg || e.target.closest('[data-close]')) closeDialog(dlg);
    });
  });

  $('#pickList').addEventListener('click', e => {
    const btn = e.target.closest('.pick-item');
    if (!btn || btn.disabled) return;
    const items = state.pickItems;
    const all = $$('#pickList .pick-item');

    const run = async fn => {
      if (all.some(b => b.dataset.busy)) return;
      all.forEach(b => { b.dataset.busy = '1'; b.disabled = true; });
      try {
        await fn();
        closeDialog($('#dlgPick'));
      } catch (err) {
        toast(err.message, 'error');
        renderPicker();
      }
    };

    if (btn.dataset.new) {
      const name = askName(state.pickSuggest && !state.playlists.some(p => p.name === state.pickSuggest)
        ? state.pickSuggest.slice(0, 30) : nextDefaultName());
      if (!name) return;
      run(() => createPlaylist(name, items));
    } else {
      const pl = findPlaylist(btn.dataset.id);
      if (!pl) return;
      const have = new Set(pl.items.map(x => x.videoId));
      run(() => addToPlaylist(pl, items.filter(it => !have.has(it.videoId))));
    }
  });

  $('#favPickList').addEventListener('change', updateFavPickCount);
  $('#favPickAll').addEventListener('click', () => {
    const boxes = favPickBoxes();
    const on = !boxes.every(b => b.checked);
    boxes.forEach(b => { b.checked = on; });
    updateFavPickCount();
  });

  $('#formFavPick').addEventListener('submit', e => {
    e.preventDefault();
    const pl = findPlaylist(state.plOpen);
    if (!pl) return;
    const items = favPickBoxes().filter(b => b.checked).map(b => state.favorites[Number(b.value)]).filter(Boolean)
      .map(f => ({ videoId: f.videoId, title: f.title, channel: f.channel || '' }));
    if (!items.length) return;
    const room = state.plMaxItems - pl.items.length;
    if (items.length > room) {
      toast(`このプレイリストにはあと${room}曲しか入りません`, 'error');
      return;
    }
    withBusy($('#favPickOk'), async () => {
      await addToPlaylist(pl, items);
      closeDialog($('#dlgFav'));
    });
  });
}

/* =========================================================
 * 履歴
 * ========================================================= */
async function loadHistory() {
  $('#historyList').innerHTML = '<li class="empty">読み込んでいます…</li>';
  try {
    const r = await api('get_history');
    state.history = r.history;
    renderHistory();
  } catch (e) {
    $('#historyList').innerHTML = '';
    if (e.code !== 'AUTH') toast(e.message, 'error');
  }
}

function renderHistory() {
  const ul = $('#historyList');
  if ($('#panel-history').hidden) return;
  if (!state.history.length) {
    ul.innerHTML = '<li class="empty">まだ再生履歴がありません。</li>';
    return;
  }
  ul.innerHTML = state.history.map((h, i) => {
    const added = inFavorites(h.videoId);
    return `
    <li class="track ${isCurrent(h.videoId) ? 'is-current' : ''}" data-i="${i}">
      <button type="button" class="track-main" data-act="h-play" aria-label="${esc(h.title)} を再生">
        <img class="thumb" src="${thumb(h.videoId)}" alt="" loading="lazy">
        <span class="track-text">
          <span class="track-title">${esc(h.title)}</span>
          <span class="track-sub">${fmtDate(h.playedAt)} に再生</span>
        </span>
      </button>
      <div class="track-tools">
        <button type="button" class="icon-btn" data-act="h-add" ${added ? 'disabled' : ''}>${added ? '追加済み' : '追加'}</button>
        <button type="button" class="icon-btn" data-act="h-topl" aria-label="プレイリストに追加">＋</button>
      </div>
    </li>`;
  }).join('');
}

function bindHistory() {
  $('#historyList').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const i = Number(btn.closest('.track').dataset.i);
    const h = state.history[i];
    if (btn.dataset.act === 'h-play') {
      playList(state.history.map(x => ({ videoId: x.videoId, title: x.title })), i, 'history', '再生履歴');
    } else if (btn.dataset.act === 'h-add') {
      withBusy(btn, () => addFavorites([{ videoId: h.videoId, title: h.title }]));
    } else if (btn.dataset.act === 'h-topl') {
      openPicker([{ videoId: h.videoId, title: h.title, channel: '' }]);
    }
  });
}

/* =========================================================
 * タブ
 * ========================================================= */
function bindTabs() {
  const tabs = $$('.tab');
  tabs.forEach(tab => tab.addEventListener('click', () => {
    tabs.forEach(t => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (tab.id === 'tab-history') loadHistory();
    if (tab.id === 'tab-pl' && !state.plLoaded) refreshPlaylists().catch(e => toast(e.message, 'error'));
  }));
}

/* =========================================================
 * 設定の保存
 * ========================================================= */
function loadPrefs() {
  const p = storageGet(CONFIG.PREFS_KEY);
  if (p) {
    state.shuffle = !!p.shuffle;
    if (['off', 'all', 'one'].includes(p.repeat)) state.repeat = p.repeat;
  }
}
function savePrefs() {
  storageSet(CONFIG.PREFS_KEY, { shuffle: state.shuffle, repeat: state.repeat });
}

/* =========================================================
 * 起動
 * ========================================================= */
document.addEventListener('DOMContentLoaded', async () => {
  bindAuth();
  bindPlayer();
  bindFavorites();
  bindAi();
  bindHistory();
  bindPlaylists();
  bindDialogs();
  bindTabs();
  loadPrefs();
  updateModeButtons();
  loadYouTubeApi();

  if (CONFIG.GAS_URL.includes('ここに')) {
    toast('app.js の GAS_URL を設定してください', 'error');
  }

  const s = loadSession();
  if (!s) {
    showAuth('login');
    return;
  }
  state.token = s.token;
  try {
    const r = await api('verify_session');
    state.user = r.user;
    if (r.user.status === 'temp') showAuth('setpw');
    else await enterApp();
  } catch (e) {
    if (e.code !== 'AUTH' && e.code !== 'MUST_CHANGE_PASSWORD') {
      toast(e.message, 'error');
      showAuth('login');
    }
  }
});
