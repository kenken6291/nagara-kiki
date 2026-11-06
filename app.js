'use strict';

/* =========================================================
 * 設定（GAS_URL は config.js で設定する）
 * ========================================================= */
const CONFIG = {
  GAS_URL: String((window.APP_CONFIG && window.APP_CONFIG.GAS_URL) || '').trim(),
  APP_VERSION: String((window.APP_CONFIG && window.APP_CONFIG.APP_VERSION) || '').trim(),
  APP_UPDATED: String((window.APP_CONFIG && window.APP_CONFIG.APP_UPDATED) || '').trim(),
  SESSION_KEY: 'nagarakiki_session',
  PREFS_KEY: 'nagarakiki_prefs',
};

/** 注意事項・免責事項の版（Code.gs の TERMS_VERSION と同じにする） */
const TERMS_VERSION = '2026-11-07';

/** 会員登録時にチェックしてもらう項目 */
const AGREE_ITEMS = [
  {
    key: 'notice',
    label: '注意書き',
    short: 'YouTube・Amazon Music の各サービスの規約に従って利用します。',
    body: [
      '本サービスは、YouTube の埋め込みプレイヤーと Amazon Music へのリンク（埋め込み）を使って曲を流すものです。各サービスの利用規約に従ってご利用ください。',
      '動画・楽曲の権利は各権利者にあります。動画の削除・非公開・埋め込み禁止などにより、再生できなくなることがあります。',
      'Amazon Music の再生には Amazon Music の会員登録やログインが必要な場合があり、曲の終わりに自動で次へ進むことはできません。',
      'AI選曲・DJ紹介は AI が作るもので、曲名やアーティスト名などに誤りが含まれることがあります。',
      '通信量はご利用の回線契約にしたがって発生します。スマホでは画面を消すと再生が止まります。',
    ],
  },
  {
    key: 'disclaimer',
    label: '免責事項',
    short: '運営者は、サービスの継続・正確さや、データの消失などによる損害について責任を負いません。',
    body: [
      '本サービスは個人が無償で運営しています。内容の正確さ、継続的な提供、不具合がないことを保証しません。',
      '予告なく機能の変更・停止・終了をすることがあります。登録したお気に入りやプレイリストなどのデータが失われても、運営者は責任を負いません。',
      '本サービスの利用、または利用できなかったことにより生じたいかなる損害についても、運営者は責任を負いません。',
    ],
  },
  {
    key: 'self',
    label: '自己責任',
    short: 'パスワードの管理や、プレイリストの公開相手の選択はご自身の責任で行います。',
    body: [
      '本サービスはご自身の判断と責任でご利用ください。',
      'パスワードは他人に知られないよう管理してください。',
      'プレイリストを公開する相手は、ご自身で選んで設定してください。公開した内容は、相手が見たり、相手のプレイリストにコピーしたりできます。',
    ],
  },
  {
    key: 'parties',
    label: '当事者間での問題解決',
    short: '会員同士や第三者との間で起きた問題は、当事者の間で解決します。',
    body: [
      '公開・共有したプレイリストなどをきっかけに、会員同士または第三者との間で問題が起きた場合は、当事者の間で話し合って解決してください。',
      '運営者は、会員同士のやり取りや問題の解決に関与しません。',
    ],
  },
];

const TERMS_EXTRA = [
  {
    label: '個人情報の取り扱い',
    body: [
      'メールアドレスは、ログイン・仮パスワードや再設定コードの送付にだけ使います。',
      '公開相手には、あなたのニックネームだけが表示されます。メールアドレスは表示されません。',
      'お気に入り・プレイリスト・再生履歴・公開相手の情報は、運営者の Google スプレッドシートに保存されます。',
    ],
  },
];

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
  playlists: [],   // [{id, name, shareOn, shareTo:[email], items:[{id, videoId, kind, url, embed, thumb, title, channel}]}]
  plMax: 30,
  plMaxItems: 200,
  plOpen: null,    // 開いているプレイリストのID
  plLoaded: false,
  pickItems: [],   // 「プレイリストに追加」で追加しようとしている曲
  pickSuggest: '',
  pickVerb: '追加',
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
  plSorting: false,     // プレイリスト一覧の並べ替えモード
  plOrderTimer: null,
  contacts: [],         // 公開相手 [{email, label, relation}]
  contactsMax: 50,
  shared: [],           // 自分に公開されたプレイリスト
  sharedLoaded: false,
  shOpen: null,         // 開いている「公開されたプレイリスト」のID
  shareEdit: null,      // 公開設定ダイアログの編集中の値 {id, on, to:Set}
  pendingShareId: '',
  importData: null,     // Excel取り込みの確認中データ   // 共有リンク（?share=）で開かれたプレイリスト
  serverVersion: '',
  voice: { on: false, rec: null, base: '', final: '', interim: '', lastAt: 0, startAt: 0, timer: null },
  narration: { audio: null, url: '', speaking: false, volume: null },
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

/** 曲データの形をそろえる（YouTube／Amazon Music 共通） */
function normTrack(x) {
  const amazon = x.kind === 'amazon' || /^am_/.test(String(x.videoId || ''));
  return {
    videoId: String(x.videoId || ''),
    title: String(x.title || ''),
    channel: String(x.channel || ''),
    kind: amazon ? 'amazon' : 'yt',
    url: amazon ? String(x.url || '') : '',
    embed: amazon ? String(x.embed || '') : '',
    thumb: amazon ? String(x.thumb || '') : '',
  };
}

function isAmazon(it) {
  return !!it && (it.kind === 'amazon' || /^am_/.test(String(it.videoId || '')));
}

/** 貼り付けられた文字が Amazon Music のURL（または埋め込みコード）か */
function isAmazonInput(s) {
  const v = String(s || '');
  return /(?:^|\/\/|\.)(?:amazon\.[a-z.]+|amzn\.(?:to|asia)|a\.co)(?:[\/?#]|$)/i.test(v) || /<iframe[^>]+amazon/i.test(v);
}

/** サムネイル（Amazon Music はジャケット画像、無ければ文字のタイル） */
function thumbHtml(it) {
  if (isAmazon(it)) {
    return it.thumb
      ? `<img class="thumb am" src="${esc(it.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : '<span class="thumb am-tile" aria-hidden="true">Amazon<br>Music</span>';
  }
  return `<img class="thumb" src="${thumb(it.videoId)}" alt="" loading="lazy">`;
}

function kindBadge(it) {
  return isAmazon(it) ? '<span class="kind-badge">Amazon</span>' : '';
}

/** 読み上げ文から、冒頭の「〜で読み上げてください」などの指示文・見出し・ト書きを取り除く */
function cleanNarration(s) {
  let t = String(s || '').replace(/\r/g, '').trim();
  for (let i = 0; i < 4; i++) {
    const before = t;
    t = t.replace(/^\s*(ナレーション|ナレーター|DJ|ＤＪ|台本|原稿|セリフ|読み上げ(文|原稿)?|本文)\s*[:：]\s*/i, '');
    t = t.replace(/^[^。\n]{0,60}?(読み上げ|読んで|朗読|ナレーション|話して|喋って|しゃべって|言って)[^。\n]{0,10}?(ください|下さい)[。．.！!：:\s]*/, '');
    t = t.replace(/^[^。\n]{0,40}((口調|声色|声|トーン|調子|雰囲気|テンション|感じ)で|風に|らしく)[：:]\s*/, '');
    t = t.replace(/^(以下|次)の(文章|文|原稿|テキスト|内容)[^。\n]{0,30}[。：:\n]\s*/, '');
    t = t.replace(/^[（(【\[][^）)】\]]{0,40}[）)】\]]\s*/, '');
    if (t === before) break;
  }
  t = t.replace(/[（(【\[](明るく|やさしく|優しく|ゆっくり|落ち着いて|元気に|笑顔で|しっとり[とした]*|穏やかに|間|間を(置|お)いて|BGM[^）)】\]]*|SE[^）)】\]]*|効果音[^）)】\]]*)[）)】\]]/g, '');
  t = t.replace(/^「([\s\S]*)」$/, '$1').replace(/^"([\s\S]*)"$/, '$1');
  return t.replace(/[*#_`~|]/g, '').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/** このアプリのURL（クエリ・ハッシュなし） */
function appBaseUrl() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}
function shareUrlOf(plId) {
  return `${appBaseUrl()}?share=${encodeURIComponent(plId)}`;
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
/** 何度送っても結果が変わらない（読み取りだけの）操作。通信失敗時は自動で再試行する */
const READ_ACTIONS = ['verify_session', 'get_favorites', 'get_history', 'pl_list', 'shared_list', 'shared_get'];
const API_TIMEOUT_MS = 60000;

async function api(action, data = {}) {
  const retries = READ_ACTIONS.includes(action) ? 2 : 0;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 800 * attempt));
    try {
      return await apiOnce(action, data);
    } catch (e) {
      lastErr = e;
      if (!e.retryable) break;
      console.warn(`[api] ${action} 再試行 ${attempt + 1}/${retries}`, e.message);
    }
  }
  if (lastErr.retryable && !READ_ACTIONS.includes(action)) {
    // 書き込みは二重実行を避けるため再送しない。サーバー側で完了している場合があるので一覧を取り直す
    lastErr.message += '（処理が完了している場合があります。画面を更新しました）';
    refreshAfterWriteError(action);
  }
  throw lastErr;
}

async function apiOnce(action, data) {
  const body = JSON.stringify(Object.assign({ action, token: state.token }, data));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(CONFIG.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      redirect: 'follow',
      signal: ctrl.signal,
    });
  } catch (e) {
    const err = new Error(e.name === 'AbortError'
      ? 'サーバーの応答がありません（' + API_TIMEOUT_MS / 1000 + '秒）。時間をおいてお試しください'
      : 'サーバーに接続できませんでした。通信状況を確認してください');
    err.retryable = true;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    console.error(`[api] ${action} HTTP ${res.status}`, res.url);
    const err = new Error(res.status === 404
      ? 'サーバーから応答を受け取れませんでした（404）。少し待ってもう一度お試しください'
      : `サーバーエラー（${res.status}）`);
    err.retryable = res.status === 404 || res.status >= 500;
    throw err;
  }

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

/** 書き込みの通信が失敗したとき、実際の状態を取り直して画面と合わせる */
function refreshAfterWriteError(action) {
  setTimeout(() => {
    if (!state.token) return;
    if (/^(pl_|contact_)/.test(action)) refreshPlaylists().catch(() => {});
    else if (/favorite|import_playlist/.test(action)) refreshFavorites().catch(() => {});
  }, 1500);
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
  // 注意事項・免責事項に未同意（旧版で登録した会員）なら、先に同意してもらう
  if (state.user && state.user.agreed === false) {
    showAuth('agree');
    return;
  }
  hideAuth();
  $('#authNotice').hidden = true;
  $('#app').hidden = false;
  $('#accountMenu').hidden = false;
  $('#userName').textContent = state.user.nickname || state.user.email;
  const results = await Promise.allSettled([refreshFavorites(), refreshPlaylists(), refreshShared()]);
  const failed = results.find(r => r.status === 'rejected');
  if (failed && failed.reason.code !== 'AUTH' && failed.reason.code !== 'MUST_CHANGE_PASSWORD') {
    toast(failed.reason.message, 'error');
  }
  if (state.pendingShareId) {
    const id = state.pendingShareId;
    state.pendingShareId = '';
    openSharedById(id);
  }
}

/* ---------- 注意事項・免責事項への同意 ---------- */
function renderAgreeLists() {
  $$('[data-agree-list]').forEach(box => {
    box.innerHTML = AGREE_ITEMS.map(it => `
      <label class="agree-row">
        <input type="checkbox" data-agree="${it.key}">
        <span class="agree-text">
          <span class="agree-label">${esc(it.label)}に同意します</span>
          <span class="agree-short">${esc(it.short)}</span>
        </span>
      </label>`).join('') + `
      <label class="agree-row all">
        <input type="checkbox" data-agree-all>
        <span class="agree-text"><span class="agree-label">すべてに同意する</span></span>
      </label>`;
  });
  $('#termsBody').innerHTML = AGREE_ITEMS.concat(TERMS_EXTRA).map(it => `
    <h3>${esc(it.label)}</h3>
    <ul>${it.body.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`).join('') +
    `<p class="hint">版：${esc(TERMS_VERSION)}</p>`;
}

function agreeState(form) {
  const boxes = $$('[data-agree]', form);
  const all = $('[data-agree-all]', form);
  const ok = boxes.length > 0 && boxes.every(b => b.checked);
  if (all) all.checked = ok;
  return ok;
}

function bindAgree(form, submitBtn) {
  form.addEventListener('change', e => {
    if (e.target.matches('[data-agree-all]')) {
      $$('[data-agree]', form).forEach(b => { b.checked = e.target.checked; });
    }
    submitBtn.disabled = !agreeState(form);
  });
}

function resetAgree(form, submitBtn) {
  $$('input[type="checkbox"]', form).forEach(b => { b.checked = false; });
  submitBtn.disabled = true;
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
      setServerVersion(r.serverVersion);
      $('#loginPassword').value = '';
      if (r.mustChangePassword) {
        showAuth('setpw');
      } else {
        toast(`おかえりなさい、${r.user.nickname}さん`, 'ok');
        await enterApp();
      }
    });
  });

  renderAgreeLists();
  bindAgree($('#formRegister'), $('#btnRegister'));
  bindAgree($('#formAgree'), $('#btnAgree'));

  $('#formRegister').addEventListener('submit', e => {
    e.preventDefault();
    if (!agreeState($('#formRegister'))) {
      toast('すべての項目にチェックしてください', 'error');
      return;
    }
    withBusy(e.submitter, async () => {
      const email = normEmail($('#regEmail').value);
      const r = await api('register', {
        email,
        nickname: $('#regNickname').value,
        agree: true,
        termsVersion: TERMS_VERSION,
      });
      $('#loginEmail').value = email;
      resetAgree($('#formRegister'), $('#btnRegister'));
      showAuth('login');
      toast(r.message, 'ok');
    }).then(() => {
      // withBusy が戻したボタンの状態を、チェック状態に合わせ直す
      $('#btnRegister').disabled = !agreeState($('#formRegister'));
    });
  });

  $('#formAgree').addEventListener('submit', e => {
    e.preventDefault();
    if (!agreeState($('#formAgree'))) return;
    withBusy(e.submitter, async () => {
      const r = await api('agree_terms', { agree: true, termsVersion: TERMS_VERSION });
      state.user = r.user;
      toast('ありがとうございます', 'ok');
      await enterApp();
    });
  });
  $('#agreeLogout').addEventListener('click', logout);

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
  stopNarration();
  stopVoice();
  Object.assign(state, {
    favorites: [], history: [], ai: null, queue: [], order: [], pos: -1, source: '',
    playlists: [], plOpen: null, plLoaded: false, pickItems: [],
    contacts: [], shared: [], sharedLoaded: false, shOpen: null, shareEdit: null,
  });
  $('#aiResult').innerHTML = '';
  $('#screenEmpty').hidden = false;
  hideAmazon();
  closeDialogs();
  renderPlaylists();
  renderShare();
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
  const item = currentItem();
  if (isAmazon(item)) {
    // Amazon Music の曲を表示中。YouTube側のイベントは無視する
    if (e.data === S.PLAYING) state.player.pauseVideo();
    return;
  }
  const playing = e.data === S.PLAYING || e.data === S.BUFFERING;
  setPlayButton(playing);

  if (e.data === S.PLAYING) {
    state.errorStreak = 0;
    $('#screenEmpty').hidden = true;
    logHistory(item);
  } else if (e.data === S.ENDED) {
    next(true);
  }
}

function setPlayButton(playing, label) {
  $('#btnPlay').dataset.playing = String(!!playing);
  $('#playLabel').textContent = label || (playing ? '一時停止' : '再生');
}

function logHistory(item) {
  if (!item || state.lastLogged === item.videoId) return;
  state.lastLogged = item.videoId;
  api('add_history', {
    videoId: item.videoId, title: item.title, kind: item.kind,
    url: item.url, embed: item.embed, thumb: item.thumb,
  }).catch(() => {});
}

/* ---------- Amazon Music の曲 ---------- */
function showAmazon(item) {
  const panel = $('#amPanel');
  panel.hidden = false;
  $('#screenEmpty').hidden = true;
  $('#amTitle').textContent = item.title;
  $('#amOpen').href = item.url || '#';
  $('#amMini').href = item.url || '#';
  const box = $('#amEmbed');
  if (item.embed) {
    box.innerHTML = `<iframe src="${esc(item.embed)}" title="Amazon Music" allow="autoplay; encrypted-media" loading="lazy"></iframe>`;
    box.hidden = false;
    $('#amCard').hidden = true;
    $('#amMini').hidden = false;
  } else {
    box.innerHTML = '';
    box.hidden = true;
    $('#amCard').hidden = false;
    $('#amMini').hidden = true;
  }
  setPlayButton(false, '開く');
  setDial(0);
  $('#seek').value = 0;
  $('#tCur').textContent = '0:00';
  $('#tDur').textContent = '--:--';
}

function hideAmazon() {
  const panel = $('#amPanel');
  if (panel.hidden) return;
  panel.hidden = true;
  $('#amEmbed').innerHTML = '';
  setPlayButton(false);
}

function openAmazon(item) {
  if (!item || !item.url) return;
  window.open(item.url, '_blank', 'noopener');
}

function onPlayerError(e) {
  // 2:無効なID 5:HTML5エラー 100:見つからない 101/150:埋め込み不可
  if (isAmazon(currentItem())) return;
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
  state.queue = list.map(normTrack);
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
  // 広告再生中は PLAYING が来ないため、読み込み開始時点で案内文を消す（広告の「スキップ」を押せるように）
  $('#screenEmpty').hidden = true;
  updateNowPlaying();
  renderFavorites();
  renderPlaylists();
  renderSharedDetail();
  renderAi();
  renderHistory();
  if (isAmazon(item)) {
    state.pendingVideo = null;
    if (state.playerReady) { try { state.player.stopVideo(); } catch (e) { /* noop */ } }
    showAmazon(item);
    logHistory(item);
    return;
  }
  hideAmazon();
  if (state.playerReady) state.player.loadVideoById(item.videoId);
  else state.pendingVideo = item.videoId;
}

function next(auto = false, skipRepeatOne = false) {
  if (!state.queue.length) return;
  if (auto && !skipRepeatOne && state.repeat === 'one' && currentItem() && state.playerReady) {
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
  const cur = currentItem();
  const t = !isAmazon(cur) && state.playerReady && state.player.getCurrentTime ? state.player.getCurrentTime() : 0;
  if (t > 3 && cur) {
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
  if (isAmazon(currentItem())) { openAmazon(currentItem()); return; }
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
  state.queue = list.map(normTrack);
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
    $('#nowSub').textContent = item.channel || (isAmazon(item) ? 'Amazon Music' : '');
    $('#queueInfo').textContent = `${state.sourceLabel}　${state.pos + 1} / ${state.order.length}曲目`;
    document.title = `${item.title} | ながら聴き`;
    $('#btnNowToPl').hidden = false;
  } else if (!state.queue.length) {
    $('#btnNowToPl').hidden = true;
    $('#nowTitle').textContent = '再生していません';
    $('#nowSub').textContent = '';
    $('#queueInfo').textContent = '';
    document.title = 'ながら聴き';
    hideAmazon();
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
  if (isAmazon(currentItem())) return;
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
    if (isAmazon(currentItem())) { state.seeking = false; setDial(0); seek.value = 0; return; }
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
  $('#btnCopyFav').disabled = !n;
  if (!n) {
    ul.innerHTML = '<li class="empty">まだお気に入りがありません。上の欄に YouTube や Amazon Music のURLを貼るか、「AI選曲」で曲を探して追加してください。</li>';
    return;
  }
  ul.innerHTML = state.favorites.map((f, i) => `
    <li class="track ${isCurrent(f.videoId) ? 'is-current' : ''}" data-i="${i}">
      <button type="button" class="track-main" data-act="play" aria-label="${esc(f.title)} を再生">
        ${thumbHtml(f)}
        <span class="track-text">
          <span class="track-title">${esc(f.title)}</span>
          <span class="track-sub">${kindBadge(f)}${esc(f.channel)}</span>
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

/** Amazon Music は曲名を自動で取れないことがあるので、任意で入力してもらう */
function askAmazonTitle() {
  const v = prompt('Amazon Music の曲名・アルバム名を入力してください。\n（空欄のままOKを押すと、自動で取得を試みます）', '');
  if (v === null) return null;
  return v.replace(/\s+/g, ' ').trim().slice(0, 200);
}

function bindFavorites() {
  $('#formAdd').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#addUrl');
    const val = input.value.trim();

    // Amazon Music
    if (isAmazonInput(val)) {
      const title = askAmazonTitle();
      if (title === null) return;
      withBusy(e.submitter, async () => {
        const r = await addFavorites([{ url: val, kind: 'amazon', title }]);
        if (r.added.length) input.value = '';
      });
      return;
    }

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
      toast('YouTube または Amazon Music のURLを貼り付けてください', 'error');
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
  $('#btnCopyFav').addEventListener('click', () => {
    const n = state.favorites.length;
    if (!n) return;
    const lead = n > state.plMaxItems
      ? `お気に入り${n}曲のうち、先頭から最大${state.plMaxItems}曲をコピーします（1つのプレイリストは${state.plMaxItems}曲まで）。コピー先を選んでください`
      : `お気に入りの${n}曲を、今の並び順のままコピーします。コピー先を選んでください`;
    openPicker(state.favorites, 'お気に入り', lead, 'コピー');
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
    kind: 'yt',
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
      ${(state.ai.djTalk || comment) ? `
        <button type="button" class="btn small dj-btn" data-act="ai-dj" aria-pressed="${state.narration.speaking}">
          ${state.narration.speaking ? '紹介を止める' : 'DJの紹介を聴く'}
        </button>` : ''}
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
      stopVoice();
      stopNarration();
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

    if (act === 'ai-dj') {
      if (state.narration.speaking) stopNarration();
      else playNarration(state.ai.djTalk || state.ai.comment, btn);
    } else if (act === 'ai-playall') {
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
  state.playlists = (r.playlists || []).map(pl => Object.assign(pl, {
    shareOn: !!pl.shareOn,
    shareTo: Array.isArray(pl.shareTo) ? pl.shareTo : [],
  }));
  if (Array.isArray(r.contacts)) state.contacts = r.contacts;
  if (r.max) state.plMax = r.max;
  if (r.maxItems) state.plMaxItems = r.maxItems;
  if (r.contactsMax) state.contactsMax = r.contactsMax;
  state.plLoaded = true;
  if (state.plOpen && !findPlaylist(state.plOpen)) state.plOpen = null;
  renderPlaylists();
  renderShare();
  if (state.shareEdit) renderShareDialog();
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

function coverImg(it) {
  if (isAmazon(it)) {
    return it.thumb
      ? `<img src="${esc(it.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : '<span class="am-tile">Amazon<br>Music</span>';
  }
  return `<img src="${thumb(it.videoId)}" alt="" loading="lazy">`;
}

function coverHtml(pl) {
  const items = pl.items.slice(0, 4);
  if (!items.length) return '<span class="pl-cover"><span class="blank">まだ曲がありません</span></span>';
  if (items.length < 4) return `<span class="pl-cover one">${coverImg(items[0])}</span>`;
  return `<span class="pl-cover">${items.map(coverImg).join('')}</span>`;
}

function shareSummary(pl) {
  if (!pl.shareOn) return '非公開';
  const names = pl.shareTo.map(e => {
    const c = state.contacts.find(x => x.email === e);
    return c ? c.label : e;
  });
  return `公開中：${names.join('、')}`;
}

function renderPlaylists() {
  const n = state.playlists.length;
  $('#plTabCount').textContent = n ? `${n}` : '';
  const open = state.plOpen ? findPlaylist(state.plOpen) : null;
  $('#plIndex').hidden = !!open;
  $('#plDetail').hidden = !open;

  // 一覧
  if (n < 2) state.plSorting = false;
  const sorting = state.plSorting;
  const rest = state.plMax - n;
  const limit = $('#plLimit');
  limit.textContent = sorting ? '◀ ▶ で順番を変えて「完了」を押してください' : `${n} / ${state.plMax} 個`;
  limit.classList.toggle('is-hint', sorting);
  $('#btnPlNew').disabled = rest <= 0 || sorting;
  const sortBtn = $('#btnPlSort');
  sortBtn.hidden = n < 2;
  sortBtn.textContent = sorting ? '完了' : '並べ替え';
  sortBtn.classList.toggle('is-on', sorting);
  sortBtn.setAttribute('aria-pressed', String(sorting));

  if (sorting) {
    $('#plGrid').innerHTML = state.playlists.map((pl, i) => `
    <li class="pl-card is-sorting" data-id="${esc(pl.id)}" data-i="${i}">
      <div class="pl-open">
        ${coverHtml(pl)}
        <span class="pl-meta">
          <span class="pl-meta-name">${esc(pl.name)}</span>
          <span class="pl-meta-sub">${pl.items.length}曲</span>
        </span>
      </div>
      <div class="pl-sortbar">
        <button type="button" class="icon-btn" data-act="pl-prev" aria-label="${esc(pl.name)} を前へ" ${i === 0 ? 'disabled' : ''}>◀ 前へ</button>
        <span class="pl-pos">${i + 1}</span>
        <button type="button" class="icon-btn" data-act="pl-next" aria-label="${esc(pl.name)} を後へ" ${i === n - 1 ? 'disabled' : ''}>後へ ▶</button>
      </div>
    </li>`).join('');
  }

  const cards = sorting ? '' : state.playlists.map(pl => `
    <li class="pl-card ${state.source === 'pl:' + pl.id ? 'is-playing' : ''}" data-id="${esc(pl.id)}">
      <button type="button" class="pl-open" data-act="pl-open" aria-label="${esc(pl.name)} を開く">
        ${coverHtml(pl)}
        <span class="pl-meta">
          <span class="pl-meta-name">${esc(pl.name)}</span>
          <span class="pl-meta-sub">${pl.items.length}曲${state.source === 'pl:' + pl.id ? '・再生中' : ''}</span>
          ${pl.shareOn ? `<span class="pl-badge">公開中（${pl.shareTo.length}人）</span>` : ''}
        </span>
      </button>
      ${pl.items.length ? `<button type="button" class="pl-play" data-act="pl-play" aria-label="${esc(pl.name)} を再生">${PLAY_ICON}</button>` : ''}
    </li>`).join('');
  const slot = rest > 0
    ? `<li class="pl-slot">${n ? `あと${rest}個つくれます` : '「＋ 新しいプレイリスト」から<br>最大' + state.plMax + '個までつくれます'}</li>`
    : '';
  if (!sorting) $('#plGrid').innerHTML = !state.plLoaded ? '<li class="empty">読み込んでいます…</li>' : cards + slot;

  // 中身
  if (!open) return;
  $('#plName').textContent = open.name;
  $('#plCount').textContent = `${open.items.length} / ${state.plMaxItems}曲`;
  $('#btnPlPlay').disabled = !open.items.length;
  $('#btnPlShuffle').disabled = !open.items.length;
  const chip = $('#plShareChip');
  chip.textContent = shareSummary(open);
  chip.classList.toggle('on', open.shareOn);
  $('#btnPlLine').disabled = !open.shareOn;
  const ul = $('#plItems');
  const m = open.items.length;
  if (!m) {
    ul.innerHTML = '<li class="empty">まだ曲がありません。上の欄に YouTube・Amazon Music のURLを貼るか、「お気に入りから追加」を押してください。お気に入り・AI選曲・履歴の「＋」ボタンからも追加できます。</li>';
    return;
  }
  ul.innerHTML = open.items.map((it, i) => `
    <li class="track ${isCurrent(it.videoId) && state.source === 'pl:' + open.id ? 'is-current' : ''}" data-i="${i}">
      <button type="button" class="track-main" data-act="pi-play" aria-label="${esc(it.title)} を再生">
        ${thumbHtml(it)}
        <span class="track-text">
          <span class="track-title">${esc(it.title)}</span>
          <span class="track-sub">${kindBadge(it)}${esc(it.channel)}</span>
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

/* ---------- プレイリスト自体の並べ替え ---------- */
function setPlSorting(on) {
  state.plSorting = on;
  if (!on) savePlOrderNow();
  renderPlaylists();
}

function movePlaylist(i, dir) {
  const j = i + dir;
  const a = state.playlists;
  if (j < 0 || j >= a.length) return;
  [a[i], a[j]] = [a[j], a[i]];
  renderPlaylists();
  const btn = $(`#plGrid .pl-card[data-i="${j}"] [data-act="${dir < 0 ? 'pl-prev' : 'pl-next'}"]`);
  if (btn && !btn.disabled) btn.focus();
  else {
    const other = $(`#plGrid .pl-card[data-i="${j}"] [data-act="${dir < 0 ? 'pl-next' : 'pl-prev'}"]`);
    if (other) other.focus();
  }
  clearTimeout(state.plOrderTimer);
  state.plOrderTimer = setTimeout(savePlOrderNow, 1500);
}

function savePlOrderNow() {
  if (!state.plOrderTimer) return;
  clearTimeout(state.plOrderTimer);
  state.plOrderTimer = null;
  api('pl_order', { ids: state.playlists.map(p => p.id) })
    .catch(e => {
      toast('並び順を保存できませんでした：' + e.message, 'error');
      refreshPlaylists().catch(() => {});
    });
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

  $('#btnPlSort').addEventListener('click', () => setPlSorting(!state.plSorting));

  $('#plGrid').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'pl-prev' || btn.dataset.act === 'pl-next') {
      movePlaylist(Number(btn.closest('.pl-card').dataset.i), btn.dataset.act === 'pl-prev' ? -1 : 1);
      return;
    }
    if (state.plSorting) return;
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

    // Amazon Music
    if (isAmazonInput(val)) {
      const title = askAmazonTitle();
      if (title === null) return;
      withBusy(e.submitter, async () => {
        const r = await api('pl_add', { id: pl.id, items: [{ url: val, kind: 'amazon', title }] });
        applyPlaylists(r);
        toastAddResult(r, pl.name);
        if ((r.added || []).length) input.value = '';
      });
      return;
    }

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
      toast('YouTube または Amazon Music のURLを貼り付けてください', 'error');
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

  $('#btnPlShareSet').addEventListener('click', () => {
    if (state.plOpen) openShareDialog(state.plOpen);
  });
  $('#btnPlLine').addEventListener('click', () => {
    const pl = findPlaylist(state.plOpen);
    if (pl) sendShare(pl, 'line');
  });

  $('#btnNowToPl').addEventListener('click', () => {
    const it = currentItem();
    if (it) openPicker([it]);
  });
}

/* ---------- ダイアログ：どのプレイリストに入れるか ---------- */
function openPicker(items, suggestName, lead, verb) {
  items = (items || []).filter(it => it && it.videoId).map(normTrack);
  if (!items.length) return;
  if (!state.plLoaded) {
    refreshPlaylists().then(() => openPicker(items, suggestName, lead, verb)).catch(e => toast(e.message, 'error'));
    return;
  }
  state.pickItems = items;
  state.pickSuggest = suggestName || '';
  state.pickVerb = verb || '追加';
  $('#pickTitle').textContent = `プレイリストに${state.pickVerb}`;
  $('#pickLead').textContent = lead || (items.length === 1
    ? `「${items[0].title}」を追加するプレイリストを選んでください`
    : `${items.length}曲を追加するプレイリストを選んでください`);
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
    if (items.length > 1 && fresh && room > 0) note += `・+${Math.min(fresh, room)}曲`;
    if (!fresh) note = items.length === 1 ? '追加済み' : 'すべて追加済み';
    else if (room <= 0) note = '満杯';
    const disabled = !fresh || room <= 0;
    const cover = pl.items.length ? thumbHtml(pl.items[0]) : '<span class="thumb none">空</span>';
    return `<li><button type="button" class="pick-item" data-id="${esc(pl.id)}" ${disabled ? 'disabled' : ''}>
      ${cover}<span class="pick-name">${esc(pl.name)}</span><span class="pick-note">${note}</span>
    </button></li>`;
  }).join('');
  const canNew = state.playlists.length < state.plMax;
  $('#pickList').innerHTML = rows + (canNew
    ? `<li><button type="button" class="pick-item new" data-new="1">＋ 新しいプレイリストを作って${state.pickVerb}（あと${state.plMax - state.playlists.length}個）</button></li>`
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
      ${thumbHtml(f)}
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
      run(() => createPlaylist(name, items.slice(0, state.plMaxItems)));
    } else {
      const pl = findPlaylist(btn.dataset.id);
      if (!pl) return;
      const have = new Set(pl.items.map(x => x.videoId));
      const room = state.plMaxItems - pl.items.length;
      const fresh = items.filter(it => !have.has(it.videoId));
      run(async () => {
        await addToPlaylist(pl, fresh.slice(0, room));
        if (fresh.length > room) toast(`「${pl.name}」が${state.plMaxItems}曲に達したため、残り${fresh.length - room}曲は入りませんでした`, 'error');
      });
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
      .map(normTrack);
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
 * 共有：指定した会員（家族・友人）だけに公開
 * ========================================================= */
const RELATIONS = ['家族', '友人', 'その他'];

async function refreshShared() {
  const r = await api('shared_list');
  state.shared = r.shared || [];
  state.sharedLoaded = true;
  if (state.shOpen && !state.shared.some(p => p.id === state.shOpen)) state.shOpen = null;
  renderShare();
}

function findShared(id) {
  return state.shared.find(p => p.id === id) || null;
}

function renderShare() {
  const n = state.shared.length;
  $('#shareTabCount').textContent = n ? `${n}` : '';
  const open = state.shOpen ? findShared(state.shOpen) : null;
  $('#shareIndex').hidden = !!open;
  $('#sharedDetail').hidden = !open;
  if (open) { renderSharedDetail(); return; }
  renderSharedGrid();
  renderShareTable();
  renderContacts();
}

function renderSharedGrid() {
  const ul = $('#sharedGrid');
  if (!state.sharedLoaded) { ul.innerHTML = '<li class="empty">読み込んでいます…</li>'; return; }
  if (!state.shared.length) {
    ul.innerHTML = '<li class="empty">まだありません。家族や友人があなたを「公開相手」に入れて公開すると、ここに表示されます。</li>';
    return;
  }
  ul.innerHTML = state.shared.map(pl => `
    <li class="pl-card shared ${state.source === 'sh:' + pl.id ? 'is-playing' : ''}" data-id="${esc(pl.id)}">
      <button type="button" class="pl-open" data-act="sh-open" aria-label="${esc(pl.name)} を開く">
        ${coverHtml(pl)}
        <span class="pl-meta">
          <span class="pl-meta-name">${esc(pl.name)}</span>
          <span class="pl-meta-sub">${esc(pl.ownerName)}さんから・${pl.items.length}曲</span>
        </span>
      </button>
      ${pl.items.length ? `<button type="button" class="pl-play" data-act="sh-play" aria-label="${esc(pl.name)} を再生">${PLAY_ICON}</button>` : ''}
    </li>`).join('');
}

function renderSharedDetail() {
  const pl = state.shOpen ? findShared(state.shOpen) : null;
  if (!pl || $('#sharedDetail').hidden) return;
  $('#shName').textContent = pl.name;
  $('#shCount').textContent = `${pl.items.length}曲`;
  $('#shOwner').textContent = `${pl.ownerName}さんが、あなたに公開しているプレイリストです。`;
  $('#btnShPlay').disabled = !pl.items.length;
  $('#btnShShuffle').disabled = !pl.items.length;
  $('#btnShCopy').disabled = !pl.items.length;
  const ul = $('#shItems');
  if (!pl.items.length) { ul.innerHTML = '<li class="empty">まだ曲がありません。</li>'; return; }
  ul.innerHTML = pl.items.map((it, i) => {
    const added = inFavorites(it.videoId);
    return `
    <li class="track ${isCurrent(it.videoId) && state.source === 'sh:' + pl.id ? 'is-current' : ''}" data-i="${i}">
      <button type="button" class="track-main" data-act="si-play" aria-label="${esc(it.title)} を再生">
        ${thumbHtml(it)}
        <span class="track-text">
          <span class="track-title">${esc(it.title)}</span>
          <span class="track-sub">${kindBadge(it)}${esc(it.channel)}</span>
        </span>
      </button>
      <div class="track-tools">
        <button type="button" class="icon-btn" data-act="si-fav" ${added ? 'disabled' : ''}>${added ? '追加済み' : '追加'}</button>
        <button type="button" class="icon-btn" data-act="si-topl" aria-label="自分のプレイリストに追加">＋</button>
      </div>
    </li>`;
  }).join('');
}

function playShared(pl, startIndex) {
  if (!pl || !pl.items.length) return;
  playList(pl.items, startIndex, 'sh:' + pl.id, `${pl.ownerName}さんの「${pl.name}」`);
}

function openShared(id) {
  state.shOpen = id;
  renderShare();
  window.scrollTo({ top: $('.tabs').offsetTop - 8, behavior: 'smooth' });
}

function selectTab(id) {
  const tab = document.getElementById(id);
  if (tab) tab.click();
}

/** 共有リンク（?share=ID）で開かれたとき */
async function openSharedById(id) {
  try {
    const r = await api('shared_get', { id });
    if (r.own) {
      selectTab('tab-pl');
      if (findPlaylist(id)) openPlaylist(id);
      toast('ご自身のプレイリストです');
      return;
    }
    const pl = r.playlist;
    const i = state.shared.findIndex(p => p.id === pl.id);
    if (i >= 0) state.shared[i] = pl; else state.shared.unshift(pl);
    state.sharedLoaded = true;
    state.shOpen = pl.id;   // 先に開いておく（タブ切り替え時の再読み込みで閉じないように）
    selectTab('tab-share');
    openShared(pl.id);
    toast(`${pl.ownerName}さんのプレイリスト「${pl.name}」を開きました`, 'ok');
  } catch (e) {
    if (e.code !== 'AUTH') toast(e.message, 'error');
  }
}

/* ---------- 公開の管理（一覧） ---------- */
function renderShareTable() {
  const ul = $('#shareTable');
  if (!state.plLoaded) { ul.innerHTML = '<li class="empty">読み込んでいます…</li>'; return; }
  if (!state.playlists.length) {
    ul.innerHTML = '<li class="empty">まだプレイリストがありません。「プレイリスト」タブで作ると、ここで公開・非公開を切り替えられます。</li>';
    return;
  }
  ul.innerHTML = state.playlists.map(pl => `
    <li class="share-row ${pl.shareOn ? 'is-on' : ''}" data-id="${esc(pl.id)}">
      <div class="share-main">
        <span class="share-name">${esc(pl.name)}</span>
        <span class="share-sub">${pl.items.length}曲・${esc(shareSummary(pl))}</span>
      </div>
      <div class="share-tools">
        <button type="button" class="switch" role="switch" data-act="sw" aria-checked="${pl.shareOn}"
          aria-label="${esc(pl.name)} を${pl.shareOn ? '非公開にする' : '公開する'}"><span></span></button>
        <span class="switch-text">${pl.shareOn ? '公開' : '非公開'}</span>
        <button type="button" class="btn small" data-act="who">相手を選ぶ</button>
        <button type="button" class="btn small line" data-act="line" ${pl.shareOn ? '' : 'disabled'}>LINEで送る</button>
      </div>
    </li>`).join('');
}

/* ---------- 公開相手 ---------- */
function renderContacts() {
  const ul = $('#contactList');
  if (!state.contacts.length) {
    ul.innerHTML = '<li class="empty">まだ公開相手がいません。上の欄から追加してください。</li>';
    return;
  }
  ul.innerHTML = state.contacts.map((c, i) => {
    const used = state.playlists.filter(pl => pl.shareOn && pl.shareTo.includes(c.email)).length;
    return `
    <li class="contact-row" data-i="${i}">
      <div class="contact-main">
        <span class="contact-name">${esc(c.label)}<span class="rel-chip">${esc(c.relation)}</span></span>
        <span class="contact-sub">${esc(c.email)}${used ? `・${used}個を公開中` : ''}</span>
      </div>
      <div class="contact-tools">
        <select class="input small" data-act="rel" aria-label="${esc(c.label)} の区分">
          ${RELATIONS.map(r => `<option ${r === c.relation ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
        <button type="button" class="icon-btn" data-act="rename">呼び名</button>
        <button type="button" class="icon-btn danger" data-act="del">削除</button>
      </div>
    </li>`;
  }).join('');
}

async function addContact(email, label, relation) {
  email = normEmail(email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('メールアドレスの形式が正しくありません');
  if (state.user && email === String(state.user.email).toLowerCase()) throw new Error('ご自身のメールアドレスは登録できません');
  const r = await api('contact_add', { email, label, relation });
  applyPlaylists(r);
  toast(`「${(state.contacts.find(c => c.email === email) || {}).label || email}」を公開相手に追加しました`, 'ok');
  return email;
}

/* ---------- 公開設定ダイアログ ---------- */
function openShareDialog(plId, forceOn) {
  const pl = findPlaylist(plId);
  if (!pl) return;
  const to = new Set(pl.shareTo);
  // まだ誰も選んでいなければ、全員にチェックを入れておく（公開スイッチは入れない）
  if (!to.size) state.contacts.forEach(c => to.add(c.email));
  state.shareEdit = { id: pl.id, on: forceOn ? true : pl.shareOn, to };
  $('#shareAddBox').open = !state.contacts.length;
  renderShareDialog();
  showDialog($('#dlgShare'));
}

function renderShareDialog() {
  const ed = state.shareEdit;
  if (!ed) return;
  const pl = findPlaylist(ed.id);
  if (!pl) { closeDialog($('#dlgShare')); state.shareEdit = null; return; }
  // 削除された公開相手は外す
  const emails = new Set(state.contacts.map(c => c.email));
  ed.to.forEach(e => { if (!emails.has(e)) ed.to.delete(e); });

  $('#shareTitle').textContent = `「${pl.name}」の公開設定`;
  $('#shareState').textContent = `現在：${shareSummary(pl)}`;
  $('#shareState').classList.toggle('on', pl.shareOn);
  $('#shareSwitch').setAttribute('aria-checked', String(ed.on));
  $('#shareSwitchLabel').textContent = ed.on ? '公開する（選んだ相手だけが見られます）' : '公開しない（自分だけ）';

  const ul = $('#shareToList');
  if (!state.contacts.length) {
    ul.innerHTML = '<li class="hint">まだ公開相手がいません。下の「＋ 公開相手を追加」から登録してください。</li>';
  } else {
    ul.innerHTML = state.contacts.map(c => `
      <li><label class="check-row">
        <input type="checkbox" value="${esc(c.email)}" ${ed.to.has(c.email) ? 'checked' : ''}>
        <span class="track-text">
          <span class="track-title">${esc(c.label)}<span class="rel-chip">${esc(c.relation)}</span></span>
          <span class="track-sub">${esc(c.email)}</span>
        </span>
      </label></li>`).join('');
  }
  const boxes = $$('#shareToList input[type="checkbox"]');
  $('#shareAll').hidden = !boxes.length;
  $('#shareAll').textContent = boxes.length && boxes.every(b => b.checked) ? '選択を解除' : 'すべて選ぶ';

  const dirty = ed.on !== pl.shareOn ||
    ed.to.size !== pl.shareTo.length || pl.shareTo.some(e => !ed.to.has(e));
  $('#shareSave').textContent = dirty ? '保存する' : '保存済み';
  $('#shareSave').disabled = !dirty;

  const sendable = pl.shareOn && !dirty;
  $$('#shareSend [data-send]').forEach(b => { b.disabled = !sendable; });
  $('#shareSendHint').textContent = sendable
    ? '公開中です。リンクを送って知らせましょう（相手には「ながら聴き」への登録が必要です）。'
    : (dirty ? '「保存する」を押すと、リンクを送れるようになります。' : '公開すると、LINE などでリンクを送れます。');
  $('#shareNative').hidden = !navigator.share;
}

async function saveShare() {
  const ed = state.shareEdit;
  if (!ed) return;
  const to = [...ed.to];
  if (ed.on && !to.length) {
    toast('公開する相手を1人以上選んでください', 'error');
    return;
  }
  const r = await api('pl_share_set', { id: ed.id, on: ed.on, to });
  applyPlaylists(r);
  const pl = findPlaylist(ed.id);
  toast(pl && pl.shareOn ? `公開しました（${pl.shareTo.length}人）。LINE などでリンクを送れます` : '非公開にしました', 'ok');
}

/** 一覧のスイッチ：その場で切り替える */
async function quickToggle(pl, btn) {
  if (!pl.shareOn) {
    const to = pl.shareTo.filter(e => state.contacts.some(c => c.email === e));
    if (!to.length) {
      // 相手がまだ決まっていなければダイアログで選んでもらう
      openShareDialog(pl.id, true);
      if (!state.contacts.length) toast('先に公開相手（家族・友人）を追加してください');
      return;
    }
    await switchBusy(btn, async () => {
      applyPlaylists(await api('pl_share_set', { id: pl.id, on: true, to }));
      toast(`「${pl.name}」を公開しました（${to.length}人）`, 'ok');
    });
  } else {
    await switchBusy(btn, async () => {
      applyPlaylists(await api('pl_share_set', { id: pl.id, on: false, to: pl.shareTo }));
      toast(`「${pl.name}」を非公開にしました`, 'ok');
    });
  }
}

/** スイッチ用の処理中表示（中の飾りを消さないよう、文字は書き換えない） */
async function switchBusy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    await fn();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}

/** LINE などでリンクを送る */
async function sendShare(pl, how) {
  if (!pl.shareOn) {
    toast('まだ非公開です。先に公開してください', 'error');
    return;
  }
  const url = shareUrlOf(pl.id);
  const owner = state.user ? state.user.nickname : '';
  const text = `${owner ? owner + 'です。' : ''}「ながら聴き」でプレイリスト「${pl.name}」（${pl.items.length}曲）をあなたに公開しました。\n${url}\n※見るには「ながら聴き」へのログインが必要です。まだの方は、お伝えしているメールアドレスで会員登録してください。`;
  if (how === 'line') {
    window.open('https://line.me/R/share?text=' + encodeURIComponent(text), '_blank', 'noopener');
  } else if (how === 'native' && navigator.share) {
    try { await navigator.share({ title: `ながら聴き「${pl.name}」`, text, url }); } catch (e) { /* キャンセル */ }
  } else if (how === 'mail') {
    location.href = `mailto:?subject=${encodeURIComponent(`ながら聴き「${pl.name}」を公開しました`)}&body=${encodeURIComponent(text)}`;
  } else {
    try {
      await navigator.clipboard.writeText(text);
      toast('リンクと案内文をコピーしました', 'ok');
    } catch (e) {
      prompt('次の文をコピーしてください', text);
    }
  }
}

function bindShare() {
  // 公開されたプレイリスト
  $('#sharedGrid').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const pl = findShared(btn.closest('.pl-card').dataset.id);
    if (!pl) return;
    if (btn.dataset.act === 'sh-open') openShared(pl.id);
    else if (btn.dataset.act === 'sh-play') {
      playShared(pl, state.shuffle ? Math.floor(Math.random() * pl.items.length) : 0);
    }
  });
  $('#btnShBack').addEventListener('click', () => {
    state.shOpen = null;
    renderShare();
  });
  $('#btnShPlay').addEventListener('click', () => {
    const pl = findShared(state.shOpen);
    if (!pl) return;
    if (state.shuffle) toggleShuffle();
    playShared(pl, 0);
  });
  $('#btnShShuffle').addEventListener('click', () => {
    const pl = findShared(state.shOpen);
    if (!pl) return;
    if (!state.shuffle) toggleShuffle();
    playShared(pl, Math.floor(Math.random() * pl.items.length));
  });
  $('#btnShCopy').addEventListener('click', () => {
    const pl = findShared(state.shOpen);
    if (!pl) return;
    openPicker(pl.items, pl.name, `${pl.ownerName}さんの「${pl.name}」（${pl.items.length}曲）をコピーします。コピー先を選んでください`, 'コピー');
  });
  $('#shItems').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const pl = findShared(state.shOpen);
    if (!pl) return;
    const i = Number(btn.closest('.track').dataset.i);
    const it = pl.items[i];
    if (btn.dataset.act === 'si-play') playShared(pl, i);
    else if (btn.dataset.act === 'si-fav') withBusy(btn, () => addFavorites([normTrack(it)]));
    else if (btn.dataset.act === 'si-topl') openPicker([it]);
  });

  // 公開の管理
  $('#shareTable').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const pl = findPlaylist(btn.closest('.share-row').dataset.id);
    if (!pl) return;
    if (btn.dataset.act === 'sw') quickToggle(pl, btn);
    else if (btn.dataset.act === 'who') openShareDialog(pl.id);
    else if (btn.dataset.act === 'line') sendShare(pl, 'line');
  });

  // 公開相手
  $('#formContact').addEventListener('submit', e => {
    e.preventDefault();
    if (state.contacts.length >= state.contactsMax) {
      toast(`公開相手は${state.contactsMax}人までです`, 'error');
      return;
    }
    withBusy(e.submitter, async () => {
      await addContact($('#ctEmail').value, $('#ctLabel').value, $('#ctRelation').value);
      $('#ctEmail').value = '';
      $('#ctLabel').value = '';
    });
  });
  $('#contactList').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.tagName === 'SELECT') return;
    const c = state.contacts[Number(btn.closest('.contact-row').dataset.i)];
    if (!c) return;
    if (btn.dataset.act === 'rename') {
      const v = prompt('呼び名（20文字まで）', c.label);
      if (v === null || !v.trim() || v.trim() === c.label) return;
      withBusy(btn, async () => {
        applyPlaylists(await api('contact_update', { email: c.email, label: v.trim().slice(0, 20) }));
        toast('呼び名を変更しました', 'ok');
      });
    } else if (btn.dataset.act === 'del') {
      const used = state.playlists.filter(pl => pl.shareOn && pl.shareTo.includes(c.email)).length;
      const msg = `「${c.label}」を公開相手から削除しますか？` +
        (used ? `\n公開中の${used}個のプレイリストも、この人には見えなくなります。` : '');
      if (!confirm(msg)) return;
      withBusy(btn, async () => {
        applyPlaylists(await api('contact_delete', { email: c.email }));
        toast('削除しました');
      });
    }
  });
  $('#contactList').addEventListener('change', e => {
    const sel = e.target.closest('select[data-act="rel"]');
    if (!sel) return;
    const c = state.contacts[Number(sel.closest('.contact-row').dataset.i)];
    if (!c) return;
    api('contact_update', { email: c.email, relation: sel.value })
      .then(r => { applyPlaylists(r); toast('区分を変更しました', 'ok'); })
      .catch(err => { toast(err.message, 'error'); renderContacts(); });
  });

  // 公開設定ダイアログ
  $('#shareSwitch').addEventListener('click', () => {
    if (!state.shareEdit) return;
    state.shareEdit.on = !state.shareEdit.on;
    renderShareDialog();
  });
  $('#shareToList').addEventListener('change', e => {
    const box = e.target.closest('input[type="checkbox"]');
    if (!box || !state.shareEdit) return;
    if (box.checked) state.shareEdit.to.add(box.value); else state.shareEdit.to.delete(box.value);
    renderShareDialog();
  });
  $('#shareAll').addEventListener('click', () => {
    const ed = state.shareEdit;
    if (!ed) return;
    const all = state.contacts.every(c => ed.to.has(c.email));
    state.contacts.forEach(c => { if (all) ed.to.delete(c.email); else ed.to.add(c.email); });
    renderShareDialog();
  });
  const addInDialog = () => {
    const btn = $('#shAddBtn');
    withBusy(btn, async () => {
      const email = await addContact($('#shAddEmail').value, $('#shAddLabel').value, $('#shAddRelation').value);
      if (state.shareEdit) state.shareEdit.to.add(email);
      $('#shAddEmail').value = '';
      $('#shAddLabel').value = '';
      $('#shareAddBox').open = false;
      renderShareDialog();
    });
  };
  $('#shAddBtn').addEventListener('click', addInDialog);
  ['#shAddEmail', '#shAddLabel'].forEach(sel => $(sel).addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addInDialog(); }
  }));
  $('#formShare').addEventListener('submit', e => {
    e.preventDefault();
    withBusy($('#shareSave'), saveShare).then(renderShareDialog);
  });
  $('#shareSend').addEventListener('click', e => {
    const btn = e.target.closest('[data-send]');
    if (!btn || !state.shareEdit) return;
    const pl = findPlaylist(state.shareEdit.id);
    if (pl) sendShare(pl, btn.dataset.send);
  });
  $('#dlgShare').addEventListener('close', () => { state.shareEdit = null; });
}

/* =========================================================
 * DJ紹介（音声）
 *   サーバー（Gemini TTS）には読み上げる本文だけを送る。失敗したらブラウザの読み上げで代用
 * ========================================================= */
function pcmToWavBlob(base64, rate) {
  const bin = atob(base64);
  const pcm = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) pcm[i] = bin.charCodeAt(i);
  const buf = new ArrayBuffer(44 + pcm.length);
  const v = new DataView(buf);
  const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, pcm.length, true);
  new Uint8Array(buf, 44).set(pcm);
  return new Blob([buf], { type: 'audio/wav' });
}

function duckMusic(on) {
  if (!state.playerReady || !state.player.getVolume) return;
  try {
    if (on) {
      if (state.narration.volume === null) state.narration.volume = state.player.getVolume();
      state.player.setVolume(Math.min(20, state.narration.volume));
    } else if (state.narration.volume !== null) {
      state.player.setVolume(state.narration.volume);
      state.narration.volume = null;
    }
  } catch (e) { /* noop */ }
}

async function playNarration(rawText, btn) {
  const text = cleanNarration(rawText);
  if (!text) return;
  stopNarration();
  state.narration.speaking = true;
  if (btn) { btn.disabled = true; btn.textContent = '音声を準備しています…'; }
  try {
    const r = await api('tts', { text });
    if (!state.narration.speaking) return; // 準備中に止められた
    const m = String(r.mimeType || '').match(/rate=(\d+)/);
    const blob = /wav|mpeg|mp3|ogg/.test(r.mimeType || '')
      ? new Blob([Uint8Array.from(atob(r.audio), c => c.charCodeAt(0))], { type: r.mimeType })
      : pcmToWavBlob(r.audio, m ? Number(m[1]) : 24000);
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    state.narration.audio = audio;
    state.narration.url = url;
    audio.onended = () => { stopNarration(true); };
    audio.onerror = () => { stopNarration(true); };
    duckMusic(true);
    renderAi();
    await audio.play();
  } catch (e) {
    if (!state.narration.speaking) return;
    // ブラウザの読み上げで代用
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      u.rate = 1;
      u.onend = () => { stopNarration(true); };
      u.onerror = () => { stopNarration(true); };
      duckMusic(true);
      renderAi();
      speechSynthesis.speak(u);
      if (e.code !== 'AUTH') toast('AI音声が使えなかったため、端末の読み上げで再生します');
    } else {
      state.narration.speaking = false;
      renderAi();
      toast(e.message, 'error');
    }
  }
}

function stopNarration(fromEnd) {
  const n = state.narration;
  if (n.audio) { try { n.audio.pause(); } catch (e) { /* noop */ } n.audio = null; }
  if (n.url) { URL.revokeObjectURL(n.url); n.url = ''; }
  if (!fromEnd && 'speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch (e) { /* noop */ } }
  const was = n.speaking;
  n.speaking = false;
  duckMusic(false);
  if (was) renderAi();
}

/* =========================================================
 * 音声入力（言葉の間が空いても止めずに聞き取る）
 *   ブラウザは数秒の無音で認識を終えるため、止めるボタンを押すまで自動で再開する
 * ========================================================= */
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const VOICE_IDLE_LIMIT_MS = 60000;  // 何も話さない状態がこれだけ続いたら自動で止める
const VOICE_MAX_MS = 5 * 60000;     // 1回の聞き取りの最長

function bindVoice() {
  const btn = $('#btnMic');
  if (!SpeechRec) {
    btn.hidden = true;
    return;
  }
  btn.addEventListener('click', () => {
    if (state.voice.on) stopVoice(); else startVoice();
  });
}

function voiceText() {
  const v = state.voice;
  const join = (a, b) => (a && b ? a.replace(/\s+$/, '') + (/[。、！？!?\s]$/.test(a) ? '' : ' ') + b : a + b);
  return join(v.base, v.final + v.interim);
}

function startVoice() {
  const v = state.voice;
  v.on = true;
  v.base = $('#aiPrompt').value;
  v.final = '';
  v.interim = '';
  v.startAt = Date.now();
  v.lastAt = Date.now();
  updateMic();
  clearInterval(v.timer);
  v.timer = setInterval(() => {
    if (!v.on) return;
    const now = Date.now();
    if (now - v.lastAt > VOICE_IDLE_LIMIT_MS || now - v.startAt > VOICE_MAX_MS) {
      stopVoice();
      toast('音声入力を終了しました');
    }
  }, 1000);
  listenOnce();
}

function listenOnce() {
  const v = state.voice;
  if (!v.on) return;
  const rec = new SpeechRec();
  rec.lang = 'ja-JP';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) v.final += t; else interim += t;
    }
    v.interim = interim;
    v.lastAt = Date.now();
    $('#aiPrompt').value = voiceText().slice(0, 300);
  };
  rec.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      stopVoice();
      toast('マイクの使用が許可されていません。ブラウザの設定でマイクを許可してください', 'error');
    } else if (e.error === 'audio-capture') {
      stopVoice();
      toast('マイクが見つかりませんでした', 'error');
    }
    // no-speech / network / aborted は onend で再開する
  };
  rec.onend = () => {
    if (v.rec !== rec) return;
    // 確定前の文字は捨てずに確定扱いにする
    if (v.interim) { v.final += v.interim; v.interim = ''; }
    if (v.on) setTimeout(() => { if (v.on && v.rec === rec) listenOnce(); }, 250);
  };
  v.rec = rec;
  try {
    rec.start();
  } catch (e) {
    setTimeout(() => { if (v.on && v.rec === rec) listenOnce(); }, 600);
  }
}

function stopVoice() {
  const v = state.voice;
  if (!v.on && !v.rec) return;
  v.on = false;
  clearInterval(v.timer);
  const rec = v.rec;
  v.rec = null;
  if (rec) { try { rec.stop(); } catch (e) { /* noop */ } }
  if (v.interim) { v.final += v.interim; v.interim = ''; $('#aiPrompt').value = voiceText().slice(0, 300); }
  updateMic();
}

function updateMic() {
  const on = state.voice.on;
  const btn = $('#btnMic');
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', on ? '音声入力を止める' : '音声で入力');
  $('#micLabel').textContent = on ? '止める' : '話す';
  const hint = $('#micHint');
  hint.hidden = !on;
  hint.textContent = on ? '聞き取り中です。途中で間が空いても大丈夫です。話し終えたら「止める」を押してください。' : '';
}

/* =========================================================
 * 使い方・注意事項
 * ========================================================= */
function bindDocs() {
  document.addEventListener('click', e => {
    const help = e.target.closest('[data-open-help]');
    const terms = e.target.closest('[data-open-terms]');
    if (help) { $('#accountMenu').open = false; showDialog($('#dlgHelp')); }
    if (terms) { $('#accountMenu').open = false; showDialog($('#dlgTerms')); }
  });
}

/* =========================================================
 * Excel 書き出し・取り込み（SheetJS をボタンを押したときだけ読み込む）
 * ========================================================= */
const XLSX_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const XL_HEAD = ['プレイリスト名', '順番', '種類', '曲名', 'チャンネル・アーティスト', 'URL'];
let xlsxLoading = null;

function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxLoading) {
    xlsxLoading = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = XLSX_SRC;
      sc.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('Excel機能を読み込めませんでした')));
      sc.onerror = () => {
        xlsxLoading = null;
        reject(new Error('Excel機能を読み込めませんでした。通信状況を確認してください'));
      };
      document.head.appendChild(sc);
    });
  }
  return xlsxLoading;
}

function trackUrl(it) {
  return isAmazon(it) ? (it.url || it.embed || '') : `https://www.youtube.com/watch?v=${it.videoId}`;
}

function ymd() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function xlHelpSheet(X) {
  const aoa = [
    ['ながら聴き プレイリストのExcel（取り込み用の説明）'],
    [],
    ['列', '書き方'],
    ['プレイリスト名', '必須。同じ名前の行が1つのプレイリストになります（30文字まで）。空欄の行は、すぐ上の行と同じプレイリストに入ります。'],
    ['順番', '任意。この数字の順に並べます（空欄なら上から順）。'],
    ['種類', '任意（YouTube／Amazon Music）。URLから自動で判断するので空欄でかまいません。'],
    ['曲名', '任意。空欄なら YouTube は自動で取得します（Amazon Music は取れないことがあります）。'],
    ['チャンネル・アーティスト', '任意。'],
    ['URL', '必須。YouTube の動画URL、または Amazon Music の曲・アルバム・プレイリストのURL。'],
    [],
    ['記入例（「プレイリスト」シートに、このように書きます）'],
    XL_HEAD,
    ['朝の散歩', 1, 'YouTube', '（曲名）', '（アーティスト名）', 'https://www.youtube.com/watch?v=（動画ID）'],
    ['朝の散歩', 2, 'Amazon Music', '（曲名）', '（アーティスト名）', 'https://music.amazon.co.jp/albums/（ID）'],
    [],
    ['注意'],
    ['・1つのプレイリストは200曲まで、プレイリストは1人30個までです。'],
    ['・同じ名前のプレイリストがすでにあれば、その後ろに追加します。すでに入っている曲は重複して入りません。'],
    ['・取り込むのは「プレイリスト」シートです（このシートは読み込みません）。'],
  ];
  const ws = X.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 26 }, { wch: 96 }];
  return ws;
}

async function exportXlsx(lists, label) {
  const X = await loadXlsx();
  const rows = [];
  lists.forEach(pl => pl.items.forEach((it, i) => {
    rows.push([pl.name, i + 1, isAmazon(it) ? 'Amazon Music' : 'YouTube', it.title, it.channel || '', trackUrl(it)]);
  }));
  const ws = X.utils.aoa_to_sheet([XL_HEAD, ...rows]);
  ws['!cols'] = [{ wch: 24 }, { wch: 6 }, { wch: 14 }, { wch: 46 }, { wch: 26 }, { wch: 52 }];
  if (rows.length) ws['!autofilter'] = { ref: ws['!ref'] };
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'プレイリスト');
  X.utils.book_append_sheet(wb, xlHelpSheet(X), '使い方');
  const safe = String(label).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
  X.writeFile(wb, `ながら聴き_${safe}_${ymd()}.xlsx`);
  return rows.length;
}

/* ---------- 取り込み：ファイルを読む ---------- */
const URLISH = /https?:\/\/|youtu\.?be|amazon\.|amzn\.|<iframe/i;

function normPlName(v) {
  return String(v || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 30);
}

/** 1シート分の行 → [{name, items:[…], invalid}] */
function parseXlRows(rows, fallbackName) {
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if ((rows[i] || []).some(c => /^\s*(url|ｕｒｌ|リンク|link)/i.test(String(c)))) { h = i; break; }
  }
  const col = {};
  if (h >= 0) {
    rows[h].forEach((c, j) => {
      const t = String(c).trim();
      if (!t) return;
      if (col.name == null && /プレイリスト|リスト名|playlist/i.test(t)) col.name = j;
      else if (col.url == null && /^(url|ｕｒｌ|リンク|link)/i.test(t)) col.url = j;
      else if (col.title == null && /曲名|タイトル|title|^曲$/i.test(t)) col.title = j;
      else if (col.channel == null && /チャンネル|アーティスト|歌手|artist|channel/i.test(t)) col.channel = j;
      else if (col.order == null && /順|番号|^no\.?$|order/i.test(t)) col.order = j;
    });
  }
  const cell = (r, k) => (col[k] != null ? String(r[col[k]] ?? '').trim() : '');
  const groups = new Map();
  let last = '';
  let invalid = 0;
  rows.slice(h + 1).forEach((r, seq) => {
    if (!r || !r.some(c => String(c).trim())) return;
    let url = cell(r, 'url');
    if (!URLISH.test(url)) {
      const c = r.find(v => URLISH.test(String(v)));
      url = c ? String(c).trim() : '';
    }
    if (!url) return;
    let name = normPlName(cell(r, 'name'));
    if (!name) name = last || fallbackName;
    last = name;

    const title = cell(r, 'title').slice(0, 200);
    const channel = cell(r, 'channel').slice(0, 100);
    let item;
    if (isAmazonInput(url)) {
      item = { url, kind: 'amazon', title, channel };
    } else {
      const vid = extractVideoId(url);
      if (!vid) { invalid++; return; }
      item = { url: vid, videoId: vid, kind: 'yt', title, channel };
    }
    const ord = Number(cell(r, 'order'));
    if (!groups.has(name)) groups.set(name, { name, rows: [], keys: new Set() });
    const g = groups.get(name);
    const key = item.kind === 'yt' ? item.videoId : url;
    if (g.keys.has(key)) return;
    g.keys.add(key);
    g.rows.push({ item, ord: Number.isFinite(ord) && cell(r, 'order') !== '' ? ord : Infinity, seq });
  });
  return {
    invalid,
    groups: [...groups.values()].map(g => ({
      name: g.name,
      items: g.rows.sort((a, b) => (a.ord - b.ord) || (a.seq - b.seq)).map(x => x.item),
    })),
  };
}

async function readImportFile(file) {
  const X = await loadXlsx();
  const wb = X.read(await file.arrayBuffer(), { type: 'array' });
  const base = normPlName(file.name.replace(/\.[^.]+$/, '').replace(/^ながら聴き_|_\d{8}$/g, '')) || '取り込み';
  const names = wb.SheetNames.filter(n => n !== '使い方');
  const order = names.includes('プレイリスト') ? ['プレイリスト', ...names.filter(n => n !== 'プレイリスト')] : names;
  for (const n of order) {
    const rows = X.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: false, blankrows: false });
    const fallback = /^(sheet\d*|シート\d*|プレイリスト)$/i.test(n) ? base : normPlName(n);
    const r = parseXlRows(rows, fallback);
    if (r.groups.length) return r;
  }
  return { groups: [], invalid: 0 };
}

/* ---------- 取り込み：確認ダイアログ ---------- */
function findPlaylistByName(name) {
  return state.playlists.find(p => normPlName(p.name) === name) || null;
}

function openImportDialog(parsed, fileName) {
  state.importData = {
    groups: parsed.groups.map(g => Object.assign(g, { selected: true })),
    invalid: parsed.invalid,
    running: false,
  };
  $('#importTitle').textContent = `「${fileName}」を取り込む`;
  $('#importProgress').textContent = '';
  renderImportDialog();
  showDialog($('#dlgImport'));
}

function renderImportDialog() {
  const d = state.importData;
  if (!d) return;
  const total = d.groups.reduce((n, g) => n + g.items.length, 0);
  $('#importLead').textContent = `${d.groups.length}個のプレイリスト・${total}曲が見つかりました。` +
    (d.invalid ? `（読み取れないURL ${d.invalid}件は除外）` : '') +
    '取り込むものを選んでください。同じ名前のプレイリストがあれば、その後ろに追加します。';

  let newNeeded = 0;
  $('#importList').innerHTML = d.groups.map((g, i) => {
    const pl = findPlaylistByName(g.name);
    const room = pl ? state.plMaxItems - pl.items.length : state.plMaxItems;
    if (!pl && g.selected) newNeeded++;
    const over = g.items.length > room;
    const note = pl
      ? `既存（今${pl.items.length}曲）に追加${over ? `・あと${Math.max(0, room)}曲まで` : ''}`
      : `新しく作成${over ? `・${state.plMaxItems}曲まで` : ''}`;
    return `<li><label class="check-row">
      <input type="checkbox" value="${i}" ${g.selected ? 'checked' : ''} ${d.running ? 'disabled' : ''}>
      <span class="track-text">
        <span class="track-title">${esc(g.name)}</span>
        <span class="track-sub">${g.items.length}曲・${note}</span>
      </span>
    </label></li>`;
  }).join('');

  const rest = state.plMax - state.playlists.length;
  const sel = d.groups.filter(g => g.selected);
  const tooMany = newNeeded > rest;
  $('#importCount').textContent = tooMany
    ? `新しく作れるのはあと${rest}個です（${newNeeded}個選択中）`
    : `${sel.length}個を選択中`;
  $('#importCount').classList.toggle('warn', tooMany);
  $('#importAll').textContent = d.groups.every(g => g.selected) ? '選択を解除' : 'すべて選ぶ';
  $('#importAll').hidden = d.running;
  $('#importOk').disabled = d.running || !sel.length || tooMany;
}

/** サーバーに一度に送る量：最大100曲、タイトル不明のYouTubeは25曲、タイトル不明のAmazonは5件まで */
function importBatches(items) {
  const out = [];
  let cur = [];
  let noTitleYt = 0;
  let noTitleAm = 0;
  items.forEach(it => {
    const yt = it.kind === 'yt' && !it.title;
    const am = it.kind === 'amazon' && !it.title;
    if (cur.length && (cur.length >= 100 || (yt && noTitleYt >= 25) || (am && noTitleAm >= 5))) {
      out.push(cur);
      cur = [];
      noTitleYt = 0;
      noTitleAm = 0;
    }
    cur.push(it);
    if (yt) noTitleYt++;
    if (am) noTitleAm++;
  });
  if (cur.length) out.push(cur);
  return out;
}

function apiItem(it) {
  return { url: it.url, videoId: it.videoId, kind: it.kind, title: it.title, channel: it.channel };
}

async function runImport() {
  const d = state.importData;
  if (!d || d.running) return;
  const sel = d.groups.filter(g => g.selected);
  if (!sel.length) return;
  d.running = true;
  renderImportDialog();
  const progress = $('#importProgress');
  const sum = { created: 0, appended: 0, added: 0, skipped: 0 };
  try {
    for (let gi = 0; gi < sel.length; gi++) {
      const g = sel[gi];
      let pl = findPlaylistByName(g.name);
      const room = pl ? state.plMaxItems - pl.items.length : state.plMaxItems;
      const items = g.items.slice(0, Math.max(0, room));
      sum.skipped += g.items.length - items.length;
      if (!items.length) continue;
      const batches = importBatches(items);
      for (let bi = 0; bi < batches.length; bi++) {
        progress.textContent = `取り込み中… ${gi + 1}/${sel.length}「${g.name}」（${bi + 1}/${batches.length}）`;
        const payload = batches[bi].map(apiItem);
        let r;
        if (!pl) {
          r = await api('pl_create', { name: g.name, items: payload });
          applyPlaylists(r);
          pl = findPlaylist(r.createdId);
          sum.created++;
        } else {
          r = await api('pl_add', { id: pl.id, items: payload });
          applyPlaylists(r);
          pl = findPlaylist(pl.id);
          if (bi === 0 && !r.createdId) sum.appended++;
        }
        sum.added += (r.added || []).length;
        sum.skipped += (r.skipped || []).length;
        if (!pl) break;
      }
    }
    const parts = [];
    if (sum.created) parts.push(`新規${sum.created}個`);
    if (sum.appended) parts.push(`追加${sum.appended}個`);
    toast(`取り込みました（${parts.join('・') || 'プレイリスト0個'}、${sum.added}曲${sum.skipped ? `／重複・上限などで${sum.skipped}曲は除外` : ''}）`, 'ok');
    closeDialog($('#dlgImport'));
  } catch (e) {
    progress.textContent = `途中で止まりました：${e.message}（ここまでに${sum.added}曲を取り込み済み）`;
    toast(e.message, 'error');
    refreshPlaylists().catch(() => {});
  } finally {
    d.running = false;
    if ($('#dlgImport').open) renderImportDialog();
  }
}

function bindExcel() {
  const run = (btn, fn) => withBusy(btn, async () => {
    btn.textContent = '準備中…';
    await fn();
  });

  $('#btnXlsxExport').addEventListener('click', e => run(e.currentTarget, async () => {
    if (!state.playlists.length) {
      await exportXlsx([], 'ひな形');
      toast('プレイリストがまだないので、ひな形を書き出しました');
      return;
    }
    const n = await exportXlsx(state.playlists, 'プレイリスト');
    toast(`${state.playlists.length}個のプレイリスト（${n}曲）を書き出しました`, 'ok');
  }));
  $('#btnXlsxTemplate').addEventListener('click', e => run(e.currentTarget, async () => {
    await exportXlsx([], 'ひな形');
    toast('ひな形を書き出しました。「使い方」シートも見てください', 'ok');
  }));
  $('#btnPlXlsx').addEventListener('click', e => {
    const pl = findPlaylist(state.plOpen);
    if (pl) run(e.currentTarget, async () => { await exportXlsx([pl], pl.name); toast('書き出しました', 'ok'); });
  });
  $('#btnShXlsx').addEventListener('click', e => {
    const pl = findShared(state.shOpen);
    if (pl) run(e.currentTarget, async () => { await exportXlsx([pl], pl.name); toast('書き出しました', 'ok'); });
  });

  $('#btnXlsxImport').addEventListener('click', () => $('#xlsxFile').click());
  $('#xlsxFile').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('ファイルが大きすぎます（5MBまで）', 'error'); return; }
    withBusy($('#btnXlsxImport'), async () => {
      $('#btnXlsxImport').textContent = '読み込み中…';
      if (!state.plLoaded) await refreshPlaylists();
      const parsed = await readImportFile(file);
      if (!parsed.groups.length) {
        throw new Error('取り込める行が見つかりませんでした。「URL」の列に YouTube または Amazon Music のURLを入れてください（「ひな形をダウンロード」も参考に）');
      }
      openImportDialog(parsed, file.name);
    });
  });

  $('#importList').addEventListener('change', e => {
    const box = e.target.closest('input[type="checkbox"]');
    const d = state.importData;
    if (!box || !d) return;
    d.groups[Number(box.value)].selected = box.checked;
    renderImportDialog();
  });
  $('#importAll').addEventListener('click', () => {
    const d = state.importData;
    if (!d) return;
    const on = !d.groups.every(g => g.selected);
    d.groups.forEach(g => { g.selected = on; });
    renderImportDialog();
  });
  $('#formImport').addEventListener('submit', e => {
    e.preventDefault();
    runImport();
  });
  $('#dlgImport').addEventListener('cancel', e => { if (state.importData && state.importData.running) e.preventDefault(); });
  $('#dlgImport').addEventListener('close', () => { if (!state.importData || !state.importData.running) state.importData = null; });
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
        ${thumbHtml(h)}
        <span class="track-text">
          <span class="track-title">${esc(h.title)}</span>
          <span class="track-sub">${kindBadge(h)}${fmtDate(h.playedAt)} に再生</span>
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
      playList(state.history, i, 'history', '再生履歴');
    } else if (btn.dataset.act === 'h-add') {
      withBusy(btn, () => addFavorites([normTrack(h)]));
    } else if (btn.dataset.act === 'h-topl') {
      openPicker([normTrack(h)]);
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
    if (tab.id === 'tab-share') {
      renderShare();
      if (!state.shOpen) refreshShared().catch(e => { if (e.code !== 'AUTH') toast(e.message, 'error'); });
    }
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
/* app.js は config.js 読み込み後に動的に読み込まれるため、DOMContentLoaded 済みの場合もある */
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

/** バージョン情報を画面下に表示 */
function showVersion() {
  const el = $('#appVersion');
  if (!el) return;
  if (!CONFIG.APP_VERSION) { el.textContent = ''; return; }
  let t = `ver ${CONFIG.APP_VERSION}` + (CONFIG.APP_UPDATED ? `（${CONFIG.APP_UPDATED} 更新）` : '');
  if (state.serverVersion) t += `／サーバー ${state.serverVersion}`;
  el.textContent = t;
  el.classList.toggle('mismatch', !!state.serverVersion && state.serverVersion !== CONFIG.APP_VERSION);
  el.title = el.classList.contains('mismatch')
    ? '画面とサーバー（GAS）のバージョンが違います。GASを「新バージョン」でデプロイしたか確認してください'
    : '';
}

function setServerVersion(v) {
  if (!v) return;
  state.serverVersion = String(v);
  showVersion();
}

async function boot() {
  showVersion();
  bindAuth();
  bindPlayer();
  bindFavorites();
  bindAi();
  bindHistory();
  bindPlaylists();
  bindShare();
  bindExcel();
  bindVoice();
  bindDocs();
  bindDialogs();
  bindTabs();
  loadPrefs();
  updateModeButtons();
  loadYouTubeApi();

  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(CONFIG.GAS_URL)) {
    toast('config.js の GAS_URL を設定してください（…/exec で終わるURL）', 'error');
  }

  // 共有リンク（?share=プレイリストID）で開かれた場合
  const params = new URLSearchParams(location.search);
  const shareId = (params.get('share') || '').trim();
  if (/^[A-Za-z0-9-]{8,64}$/.test(shareId)) {
    state.pendingShareId = shareId;
    $('#authNotice').textContent = '家族・友人から公開されたプレイリストを見るには、ログインしてください。はじめての方は「新規登録」から登録できます（相手に伝えたメールアドレスで登録してください）。';
    $('#authNotice').hidden = false;
  }
  if (params.has('share')) {
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* noop */ }
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
    setServerVersion(r.serverVersion);
    if (r.user.status === 'temp') showAuth('setpw');
    else await enterApp();
  } catch (e) {
    if (e.code !== 'AUTH' && e.code !== 'MUST_CHANGE_PASSWORD') {
      toast(e.message, 'error');
      showAuth('login');
    }
  }
}
