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
  ai: null,
  queue: [],      // [{videoId, title, channel}]
  order: [],      // 再生順（queue のインデックス）
  pos: -1,        // order 内の現在位置
  source: '',     // 'favorites' | 'ai' | 'history'
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
  try {
    await refreshFavorites();
  } catch (e) {
    if (e.code !== 'AUTH') toast(e.message, 'error');
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
        email: $('#loginEmail').value,
        password: $('#loginPassword').value,
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
      const email = $('#regEmail').value;
      const r = await api('register', { email, nickname: $('#regNickname').value });
      $('#loginEmail').value = email;
      showAuth('login');
      toast(r.message, 'ok');
    });
  });

  $('#formForgot').addEventListener('submit', e => {
    e.preventDefault();
    withBusy(e.submitter, async () => {
      const email = $('#forgotEmail').value;
      const r = await api('forgot_password', { email });
      $('#resetEmail').value = email;
      showAuth('reset');
      toast(r.message, 'ok');
    });
  });

  $('#formReset').addEventListener('submit', e => {
    e.preventDefault();
    withBusy(e.submitter, async () => {
      const email = $('#resetEmail').value;
      const r = await api('reset_password', {
        email,
        code: $('#resetCode').value,
        newPassword: $('#resetPassword').value,
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
    const newPw = $('#setpwNew').value;
    if (newPw !== $('#setpwConfirm').value) {
      toast('確認用のパスワードが一致しません', 'error');
      return;
    }
    withBusy(e.submitter, async () => {
      const r = await api('set_password', {
        currentPassword: $('#setpwCurrent').value,
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
  Object.assign(state, { favorites: [], history: [], ai: null, queue: [], order: [], pos: -1, source: '' });
  $('#aiResult').innerHTML = '';
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
    if (state.favorites.length) playList(state.favorites, 0, 'favorites', 'お気に入り');
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

/** お気に入りの変更を、再生中のキューへ反映 */
function syncQueueFromFavorites() {
  if (state.source !== 'favorites' || !state.queue.length) return;
  const cur = currentItem();
  state.queue = state.favorites.map(f => ({ videoId: f.videoId, title: f.title, channel: f.channel }));
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

function updateNowPlaying() {
  const item = currentItem();
  if (item) {
    $('#nowTitle').textContent = item.title;
    $('#nowSub').textContent = item.channel;
    $('#queueInfo').textContent = `${state.sourceLabel}　${state.pos + 1} / ${state.order.length}曲目`;
    document.title = `${item.title} | ながら聴き`;
  } else if (!state.queue.length) {
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
      <div class="track-tools">
        <button type="button" class="icon-btn" data-act="up" aria-label="上へ移動" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="icon-btn" data-act="down" aria-label="下へ移動" ${i === n - 1 ? 'disabled' : ''}>↓</button>
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

function inFavorites(videoId) {
  return state.favorites.some(f => f.videoId === videoId);
}

function bindFavorites() {
  $('#formAdd').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#addUrl');
    if (!extractVideoId(input.value)) {
      toast('YouTubeのURL（または11文字の動画ID）を貼り付けてください', 'error');
      return;
    }
    withBusy(e.submitter, async () => {
      const r = await addFavorites([{ url: input.value }]);
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
              ? `<button type="button" class="icon-btn" data-act="ai-add" ${added ? 'disabled' : ''}>${added ? '追加済み' : '追加'}</button>`
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
    } else {
      const it = state.ai.items[Number(btn.closest('.track').dataset.i)];
      if (act === 'ai-play') {
        playList(playable.map(aiAsTrack), playable.indexOf(it), 'ai', label);
      } else if (act === 'ai-add') {
        withBusy(btn, () => addFavorites([aiAsTrack(it)]));
      }
    }
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
