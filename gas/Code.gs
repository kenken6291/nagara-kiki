/**
 * ながら聴き — YouTube聞き流しWebアプリ バックエンド（Google Apps Script）
 *
 * スクリプトプロパティ（プロジェクトの設定 → スクリプト プロパティ）
 *   GEMINI_API_KEY   : 必須。Gemini API キー
 *   GEMINI_MODEL     : 任意。既定 gemini-2.5-flash
 *   GEMINI_TTS_MODEL : 任意。DJ紹介の音声合成モデル。既定 gemini-2.5-flash-preview-tts
 *   GEMINI_TTS_VOICE : 任意。DJ紹介の声。既定 Aoede
 *   YOUTUBE_API_KEY  : 任意。YouTube Data API v3 キー（AI選曲の曲を実際の動画に変換する）
 *   APP_URL          : 任意。GitHub Pages のURL（メール本文に記載）
 *   SPREADSHEET_ID   : 任意。スプレッドシートにバインドしない場合のみ指定
 *   PEPPER           : setup() が自動生成（変更しないこと）
 *
 * 初回は setup() を実行してください。
 * Code.gs を修正したら「デプロイを管理」→ 鉛筆 → バージョン「新バージョン」→ デプロイ。
 */

const SERVER_VERSION = '1.8.0';      // フロントの APP_VERSION と合わせる（画面下に表示）
const TERMS_VERSION = '2026-11-07';  // 注意事項・免責事項の版（app.js の TERMS_VERSION と同じにする）

const APP_NAME = 'ながら聴き';
const SESSION_DAYS = 14;
const TEMP_PASSWORD_HOURS = 24;
const RESET_CODE_MINUTES = 30;
const MAX_LOGIN_FAILS = 5;
const LOCK_MINUTES = 15;
const HASH_ROUNDS = 300;
const HISTORY_LIMIT = 50;
const HISTORY_MAX_ROWS = 5000;
const RECOMMEND_COUNT = 8;
const RECOMMEND_LIMIT_PER_6H = 15;
const MAX_BULK_ADD = 30;
const PLAYLIST_MAX = 200;          // YouTubeプレイリストの読み込み上限
const MY_PLAYLISTS_MAX = 30;        // マイプレイリスト：1人あたりの個数
const MY_PLAYLIST_ITEMS_MAX = 200;  // マイプレイリスト：1つあたりの曲数
const PL_NAME_MAX = 30;
const CONTACTS_MAX = 50;            // 公開相手（家族・友人）の登録上限
const CONTACT_RELATIONS = ['家族', '友人', 'その他'];
const TTS_LIMIT_PER_6H = 30;        // DJ紹介（音声合成）の回数上限
const NARRATION_MAX = 400;          // 読み上げる文字数の上限
const AMAZON_META_FETCH_MAX = 5;    // タイトル自動取得を試みるAmazonのURL数（1回あたり）

const PW_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const TOKEN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const SHEETS = {
  USERS: {
    name: 'Users',
    headers: ['email', 'nickname', 'hash_password', 'salt', 'status', 'temp_token', 'temp_expires',
      'fail_count', 'locked_until', 'created_at', 'updated_at', 'agreed_at', 'terms_version'],
  },
  SESSIONS: { name: 'Sessions', headers: ['token', 'email', 'expires_at', 'created_at'] },
  FAVORITES: {
    name: 'Favorites',
    headers: ['id', 'email', 'video_id', 'title', 'channel', 'sort_order', 'created_at',
      'kind', 'url', 'embed', 'thumb'],
  },
  HISTORY: {
    name: 'History',
    headers: ['email', 'video_id', 'title', 'played_at', 'kind', 'url', 'embed', 'thumb'],
  },
  PLAYLISTS: {
    name: 'Playlists',
    headers: ['id', 'email', 'name', 'created_at', 'updated_at', 'sort_order', 'share_on', 'share_to'],
  },
  PLAYLIST_ITEMS: {
    name: 'PlaylistItems',
    headers: ['id', 'playlist_id', 'email', 'video_id', 'title', 'channel', 'sort_order', 'created_at',
      'kind', 'url', 'embed', 'thumb'],
  },
  CONTACTS: {
    name: 'Contacts',
    headers: ['owner_email', 'member_email', 'label', 'relation', 'created_at'],
  },
};

const WRITE_ACTIONS = ['register', 'login', 'set_password', 'forgot_password', 'reset_password', 'logout',
  'save_favorite', 'import_playlist', 'delete_favorite', 'reorder_favorites', 'add_history',
  'pl_create', 'pl_rename', 'pl_delete', 'pl_add', 'pl_import', 'pl_remove', 'pl_reorder', 'pl_order',
  'agree_terms', 'pl_share_set', 'contact_add', 'contact_update', 'contact_delete'];

/* =========================================================
 * 初期化
 * ========================================================= */
function setup() {
  const ss = ss_();
  Object.keys(SHEETS).forEach(key => {
    const def = SHEETS[key];
    let sh = ss.getSheetByName(def.name);
    if (!sh) sh = ss.insertSheet(def.name);
    const lastCol = Math.max(sh.getLastColumn(), 1);
    const current = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String).filter(h => h !== '');
    def.headers.forEach(h => { if (current.indexOf(h) === -1) current.push(h); });
    sh.getRange(1, 1, 1, current.length).setValues([current]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });

  const p = props_();
  if (!p.getProperty('PEPPER')) p.setProperty('PEPPER', Utilities.getUuid() + Utilities.getUuid());

  const def1 = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (def1 && def1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def1);

  Logger.log('セットアップ完了。GEMINI_API_KEY をスクリプトプロパティに設定してください。');
}

/* =========================================================
 * エンドポイント
 * ========================================================= */
function doGet() {
  return json_({ ok: true, app: APP_NAME, version: SERVER_VERSION, message: 'API is running' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'リクエストの形式が正しくありません' });
  }

  const routes = {
    register: apiRegister_,
    login: apiLogin_,
    set_password: apiSetPassword_,
    forgot_password: apiForgotPassword_,
    reset_password: apiResetPassword_,
    logout: apiLogout_,
    verify_session: apiVerifySession_,
    get_favorites: apiGetFavorites_,
    save_favorite: apiSaveFavorite_,
    import_playlist: apiImportPlaylist_,
    delete_favorite: apiDeleteFavorite_,
    reorder_favorites: apiReorderFavorites_,
    add_history: apiAddHistory_,
    get_history: apiGetHistory_,
    gemini_recommend: apiGeminiRecommend_,
    pl_list: apiPlList_,
    pl_create: apiPlCreate_,
    pl_rename: apiPlRename_,
    pl_delete: apiPlDelete_,
    pl_add: apiPlAdd_,
    pl_import: apiPlImport_,
    pl_remove: apiPlRemove_,
    pl_reorder: apiPlReorder_,
    pl_order: apiPlOrder_,
    pl_share_set: apiPlShareSet_,
    contact_add: apiContactAdd_,
    contact_update: apiContactUpdate_,
    contact_delete: apiContactDelete_,
    shared_list: apiSharedList_,
    shared_get: apiSharedGet_,
    agree_terms: apiAgreeTerms_,
    tts: apiTts_,
  };

  const fn = routes[req.action];
  if (!fn) return json_({ ok: false, error: '不明な操作です: ' + req.action, serverVersion: SERVER_VERSION });

  const needsLock = WRITE_ACTIONS.indexOf(req.action) !== -1;
  const lock = LockService.getScriptLock();
  try {
    if (needsLock) lock.waitLock(20000);
    return json_(fn(req));
  } catch (err) {
    console.error(req.action, err && err.stack ? err.stack : err);
    return json_({
      ok: false,
      error: err.userMessage || 'サーバーでエラーが発生しました。時間をおいて再度お試しください。',
      code: err.code || '',
    });
  } finally {
    if (needsLock) lock.releaseLock();
  }
}

/* =========================================================
 * 会員認証
 * ========================================================= */
function apiRegister_(req) {
  const email = normEmail_(req.email);
  const nickname = String(req.nickname || '').trim().slice(0, 20);
  if (!isEmail_(email)) fail_('メールアドレスの形式が正しくありません');
  if (!nickname) fail_('ニックネームを入力してください');
  if (req.agree !== true || String(req.termsVersion || '') !== TERMS_VERSION) {
    fail_('注意書き・免責事項・自己責任・当事者間での問題解決のすべてに同意してください（画面を再読み込みしてからお試しください）');
  }

  const user = findUser_(email);
  if (user && user.status === 'active') {
    fail_('このメールアドレスは登録済みです。パスワードを忘れた場合は「パスワードを忘れた方」から再設定してください');
  }

  const tempPw = randStr_(8, PW_CHARS);
  const salt = randStr_(16, TOKEN_CHARS);
  const data = {
    email: email,
    nickname: nickname,
    hash_password: hash_(tempPw, salt),
    salt: salt,
    status: 'temp',
    temp_token: '',
    temp_expires: Date.now() + TEMP_PASSWORD_HOURS * 3600 * 1000,
    fail_count: 0,
    locked_until: '',
    updated_at: new Date(),
    agreed_at: new Date(),
    terms_version: TERMS_VERSION,
  };
  if (user) updateRow_('USERS', user._row, data);
  else appendObj_('USERS', Object.assign(data, { created_at: new Date() }));

  sendMail_(email, '【' + APP_NAME + '】仮パスワードのお知らせ', [
    nickname + ' さん',
    '',
    '「' + APP_NAME + '」へのご登録ありがとうございます。',
    '仮パスワードをお知らせします。',
    '',
    '仮パスワード：' + tempPw,
    '有効期限：' + TEMP_PASSWORD_HOURS + '時間',
    '',
    'ログイン後、ご自身で決めたパスワードに変更していただきます。',
    appUrl_(),
    '',
    'このメールに心当たりがない場合は、破棄してください。',
  ].join('\n'));

  return { ok: true, message: '仮パスワードをメールで送りました。メールに書かれた仮パスワードでログインしてください。' };
}

function apiLogin_(req) {
  const email = normEmail_(req.email);
  const password = normPw_(req.password);
  const GENERIC = 'メールアドレスまたはパスワードが違います';
  const user = findUser_(email);
  if (!user) fail_(GENERIC);

  const now = Date.now();
  if (Number(user.locked_until) > now) {
    const min = Math.ceil((Number(user.locked_until) - now) / 60000);
    fail_('ログインに続けて失敗したため一時的にロックしています。約' + min + '分後にお試しください');
  }

  if (hash_(password, user.salt) !== String(user.hash_password)) {
    const fails = Number(user.fail_count || 0) + 1;
    if (fails >= MAX_LOGIN_FAILS) {
      updateRow_('USERS', user._row, { fail_count: 0, locked_until: now + LOCK_MINUTES * 60000 });
      fail_('ログインに' + MAX_LOGIN_FAILS + '回失敗したため、' + LOCK_MINUTES + '分間ロックしました');
    }
    updateRow_('USERS', user._row, { fail_count: fails });
    fail_(GENERIC + '（あと' + (MAX_LOGIN_FAILS - fails) + '回でロックされます）');
  }

  if (user.status === 'temp' && Number(user.temp_expires) < now) {
    fail_('仮パスワードの有効期限が切れています。もう一度「新規登録」から仮パスワードを発行してください');
  }

  updateRow_('USERS', user._row, { fail_count: 0, locked_until: '' });
  const session = createSession_(email);
  return {
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt,
    user: publicUser_(user),
    mustChangePassword: user.status === 'temp',
    serverVersion: SERVER_VERSION,
  };
}

function apiSetPassword_(req) {
  const user = auth_(req, true);
  const newPw = normPw_(req.newPassword);
  if (user.status === 'active') {
    if (hash_(normPw_(req.currentPassword), user.salt) !== String(user.hash_password)) {
      fail_('現在のパスワードが違います');
    }
  }
  checkPassword_(newPw);
  const salt = randStr_(16, TOKEN_CHARS);
  updateRow_('USERS', user._row, {
    hash_password: hash_(newPw, salt),
    salt: salt,
    status: 'active',
    temp_token: '',
    temp_expires: '',
    updated_at: new Date(),
  });
  const u = publicUser_(user);
  u.status = 'active';
  return { ok: true, message: 'パスワードを設定しました', user: u };
}

function apiForgotPassword_(req) {
  const email = normEmail_(req.email);
  if (!isEmail_(email)) fail_('メールアドレスの形式が正しくありません');
  const user = findUser_(email);
  if (user) {
    const code = randStr_(6, '0123456789');
    updateRow_('USERS', user._row, {
      temp_token: hash_(code, user.salt),
      temp_expires: Date.now() + RESET_CODE_MINUTES * 60000,
      updated_at: new Date(),
    });
    sendMail_(email, '【' + APP_NAME + '】パスワード再設定コード', [
      user.nickname + ' さん',
      '',
      'パスワード再設定のご依頼を受け付けました。',
      '画面に次の再設定コードを入力してください。',
      '',
      '再設定コード：' + code,
      '有効期限：' + RESET_CODE_MINUTES + '分',
      '',
      appUrl_(),
      '',
      'ご依頼に心当たりがない場合は、このメールを破棄してください。パスワードは変更されません。',
    ].join('\n'));
  }
  return { ok: true, message: '登録済みのメールアドレスであれば、再設定コードを送りました。メールをご確認ください。' };
}

function apiResetPassword_(req) {
  const email = normEmail_(req.email);
  const code = normPw_(req.code);
  const newPw = normPw_(req.newPassword);
  const INVALID = '再設定コードが正しくないか、有効期限が切れています';
  const user = findUser_(email);
  if (!user || !user.temp_token) fail_(INVALID);

  const now = Date.now();
  if (Number(user.locked_until) > now) fail_('試行回数が多すぎます。しばらくしてからお試しください');
  if (Number(user.temp_expires) < now) fail_(INVALID);

  if (hash_(code, user.salt) !== String(user.temp_token)) {
    const fails = Number(user.fail_count || 0) + 1;
    if (fails >= MAX_LOGIN_FAILS) {
      updateRow_('USERS', user._row, { fail_count: 0, locked_until: now + LOCK_MINUTES * 60000, temp_token: '' });
      fail_('試行回数が多すぎるため、コードを無効にしました。' + LOCK_MINUTES + '分後に再度コードを発行してください');
    }
    updateRow_('USERS', user._row, { fail_count: fails });
    fail_(INVALID);
  }

  checkPassword_(newPw);
  const salt = randStr_(16, TOKEN_CHARS);
  updateRow_('USERS', user._row, {
    hash_password: hash_(newPw, salt),
    salt: salt,
    status: 'active',
    temp_token: '',
    temp_expires: '',
    fail_count: 0,
    locked_until: '',
    updated_at: new Date(),
  });
  deleteSessionsByEmail_(email);
  return { ok: true, message: 'パスワードを再設定しました。新しいパスワードでログインしてください。' };
}

function apiLogout_(req) {
  const token = String(req.token || '');
  if (token) {
    deleteWhere_('SESSIONS', r => String(r.token) === token);
    CacheService.getScriptCache().remove('s_' + token);
  }
  return { ok: true };
}

function apiVerifySession_(req) {
  const user = auth_(req, true);
  return { ok: true, user: publicUser_(user), serverVersion: SERVER_VERSION };
}

/** 既存会員が新しい注意事項・免責事項に同意する */
function apiAgreeTerms_(req) {
  const user = auth_(req, true);
  if (req.agree !== true || String(req.termsVersion || '') !== TERMS_VERSION) {
    fail_('すべての項目に同意してください（画面を再読み込みしてからお試しください）');
  }
  updateRow_('USERS', user._row, { agreed_at: new Date(), terms_version: TERMS_VERSION });
  const u = publicUser_(user);
  u.agreed = true;
  return { ok: true, user: u };
}

/* =========================================================
 * お気に入り
 * ========================================================= */
function apiGetFavorites_(req) {
  const user = auth_(req);
  return { ok: true, favorites: listFavorites_(user.email) };
}

function apiSaveFavorite_(req) {
  const user = auth_(req);
  const inputs = Array.isArray(req.items)
    ? req.items
    : [{ url: req.url || req.videoId, title: req.title, channel: req.channel, kind: req.kind }];
  if (!inputs.length) fail_('追加する曲がありません');
  if (inputs.length > MAX_BULK_ADD) fail_('一度に追加できるのは' + MAX_BULK_ADD + '件までです');

  const have = {};
  listFavorites_(user.email).forEach(f => { have[f.videoId] = true; });
  const r = prepareItems_(inputs, have, null, {
    dup: 'すでにお気に入りにあります',
    checkAllYouTube: true,
  });
  const added = appendFavorites_(user.email, r.toAdd);
  return { ok: true, added: added, skipped: r.skipped, favorites: listFavorites_(user.email) };
}

/** プレイリストURL → 曲をまとめてお気に入りへ（YouTube Data API 使用） */
function apiImportPlaylist_(req) {
  const user = auth_(req);
  const listId = extractPlaylistId_(req.url);
  if (!listId) fail_('プレイリストのURLを読み取れません');
  if (/^(LL|WL|LM)$/.test(listId)) fail_('「高く評価した動画」「後で見る」などの個人用リストは読み込めません');
  if (isMixList_(listId)) fail_('「ミックス」（YouTubeが自動で作る再生リスト）は読み込めません。通常のプレイリストのURLを貼ってください');
  const key = props_().getProperty('YOUTUBE_API_KEY');
  if (!key) fail_('プレイリストの読み込みには YOUTUBE_API_KEY の設定が必要です（管理者向け）');

  const ids = fetchPlaylistVideoIds_(listId, key);
  if (!ids.length) fail_('プレイリストに曲が見つかりませんでした');
  const info = fetchVideoInfo_(ids, key);

  const have = {};
  listFavorites_(user.email).forEach(f => { have[f.videoId] = true; });
  const toAdd = [];
  let duplicated = 0;
  let unavailable = 0;
  ids.forEach(id => {
    const v = info[id];
    if (!v || !v.embeddable || v.privacyStatus === 'private') { unavailable++; return; }
    if (have[id]) { duplicated++; return; }
    have[id] = true;
    toAdd.push({ key: id, kind: 'yt', title: v.title, channel: v.channel });
  });

  const added = appendFavorites_(user.email, toAdd);
  return {
    ok: true,
    added: added,
    duplicated: duplicated,
    unavailable: unavailable,
    total: ids.length,
    favorites: listFavorites_(user.email),
  };
}

/** 重複チェック済みの曲をまとめて末尾に追加（items は prepareItems_ の結果の形） */
function appendFavorites_(email, items) {
  if (!items.length) return [];
  let order = listFavorites_(email).reduce((m, f) => Math.max(m, f.sortOrder || 0), 0);
  const now = new Date();
  const rows = items.map(c => {
    order++;
    return Object.assign(itemCols_(c), {
      id: Utilities.getUuid(),
      email: email,
      sort_order: order,
      created_at: now,
    });
  });
  appendObjs_('FAVORITES', rows);
  return rows.map(itemOut_);
}

function apiDeleteFavorite_(req) {
  const user = auth_(req);
  const id = String(req.id || '');
  const n = deleteWhere_('FAVORITES', r => String(r.id) === id && normEmail_(r.email) === user.email);
  if (!n) fail_('削除する曲が見つかりませんでした');
  return { ok: true, favorites: listFavorites_(user.email) };
}

function apiReorderFavorites_(req) {
  const user = auth_(req);
  const ids = Array.isArray(req.ids) ? req.ids.map(String) : [];
  const sh = sheet_('FAVORITES');
  const vals = sh.getDataRange().getValues();
  if (vals.length < 2) return { ok: true, favorites: [] };
  const h = vals[0].map(String);
  const ci = h.indexOf('id');
  const ce = h.indexOf('email');
  const co = h.indexOf('sort_order');
  const pos = {};
  ids.forEach((id, i) => { pos[id] = i + 1; });
  let base = ids.length;
  const col = vals.slice(1).map(r => {
    if (normEmail_(r[ce]) === user.email) {
      const p = pos[String(r[ci])];
      return [p ? p : ++base];
    }
    return [r[co]];
  });
  sh.getRange(2, co + 1, col.length, 1).setValues(col);
  return { ok: true, favorites: listFavorites_(user.email) };
}

function listFavorites_(email) {
  return readAll_('FAVORITES')
    .filter(r => normEmail_(r.email) === email)
    .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
    .map(r => Object.assign(itemOut_(r), { sortOrder: Number(r.sort_order) || 0 }));
}

/* =========================================================
 * 再生履歴
 * ========================================================= */
function apiAddHistory_(req) {
  const user = auth_(req);
  const p = parseItem_({
    videoId: req.videoId, url: req.url, kind: req.kind, embed: req.embed,
    title: req.title, thumb: req.thumb,
  }, true);
  if (p.error) fail_('曲の情報が正しくありません');
  appendObj_('HISTORY', Object.assign(itemCols_(p), {
    email: user.email,
    title: String(req.title || p.title || p.key).slice(0, 200),
    played_at: new Date(),
  }));
  const sh = sheet_('HISTORY');
  if (sh.getLastRow() > HISTORY_MAX_ROWS + 1) sh.deleteRows(2, 1000);
  return { ok: true };
}

function apiGetHistory_(req) {
  const user = auth_(req);
  const rows = readAll_('HISTORY').filter(r => normEmail_(r.email) === user.email).reverse();
  const seen = {};
  const out = [];
  for (let i = 0; i < rows.length && out.length < HISTORY_LIMIT; i++) {
    const r = rows[i];
    const v = String(r.video_id);
    if (seen[v]) continue;
    seen[v] = true;
    const o = itemOut_(r);
    delete o.id;
    o.playedAt = r.played_at instanceof Date ? r.played_at.getTime() : Number(r.played_at) || 0;
    out.push(o);
  }
  return { ok: true, history: out };
}

/* =========================================================
 * マイプレイリスト（1人 MY_PLAYLISTS_MAX 個まで）
 * ========================================================= */
function apiPlList_(req) {
  const user = auth_(req);
  return plResult_(user.email);
}

function apiPlCreate_(req) {
  const user = auth_(req);
  const lists = readAll_('PLAYLISTS').filter(r => normEmail_(r.email) === user.email);
  if (lists.length >= MY_PLAYLISTS_MAX) {
    fail_('プレイリストは' + MY_PLAYLISTS_MAX + '個までです。不要なものを削除してから作成してください');
  }
  const name = cleanPlName_(req.name);
  if (lists.some(l => String(l.name) === name)) fail_('同じ名前のプレイリストがあります');

  // 並び順：既存の順番を確定させてから末尾に追加
  const ordered = sortPlaylists_(lists);
  if (ordered.some(l => !(Number(l.sort_order) > 0))) writePlOrder_(user.email, ordered.map(l => String(l.id)));

  const id = Utilities.getUuid();
  const now = new Date();
  appendObj_('PLAYLISTS', {
    id: id, email: user.email, name: name, created_at: now, updated_at: now, sort_order: ordered.length + 1,
    share_on: false, share_to: '[]',
  });

  let r = { added: [], skipped: [] };
  if (Array.isArray(req.items) && req.items.length) r = addPlItems_(user.email, id, req.items);
  return plResult_(user.email, { createdId: id, added: r.added, skipped: r.skipped });
}

function apiPlRename_(req) {
  const user = auth_(req);
  const list = findMyPlaylist_(user.email, req.id);
  const name = cleanPlName_(req.name);
  const dup = readAll_('PLAYLISTS').some(r =>
    normEmail_(r.email) === user.email && String(r.id) !== String(list.id) && String(r.name) === name);
  if (dup) fail_('同じ名前のプレイリストがあります');
  updateRow_('PLAYLISTS', list._row, { name: name, updated_at: new Date() });
  return plResult_(user.email);
}

function apiPlDelete_(req) {
  const user = auth_(req);
  const list = findMyPlaylist_(user.email, req.id);
  sheet_('PLAYLISTS').deleteRow(list._row);
  bulkDeleteWhere_('PLAYLIST_ITEMS', r =>
    normEmail_(r.email) === user.email && String(r.playlist_id) === String(list.id));
  return plResult_(user.email);
}

/** 曲の追加（items＝タイトル付きの曲、または url＝動画URL1件） */
function apiPlAdd_(req) {
  const user = auth_(req);
  const list = findMyPlaylist_(user.email, req.id);
  let inputs = Array.isArray(req.items) ? req.items : [];
  if (req.url) inputs = [{ url: req.url, title: req.title, kind: req.kind }];
  if (!inputs.length) fail_('追加する曲がありません');
  const r = addPlItems_(user.email, list.id, inputs);
  if (r.added.length) updateRow_('PLAYLISTS', list._row, { updated_at: new Date() });
  return plResult_(user.email, { added: r.added, skipped: r.skipped });
}

/** YouTubeのプレイリストURL → 曲をまとめてマイプレイリストへ */
function apiPlImport_(req) {
  const user = auth_(req);
  const list = findMyPlaylist_(user.email, req.id);
  const listId = extractPlaylistId_(req.url);
  if (!listId) fail_('プレイリストのURLを読み取れません');
  if (/^(LL|WL|LM)$/.test(listId)) fail_('「高く評価した動画」「後で見る」などの個人用リストは読み込めません');
  if (isMixList_(listId)) fail_('「ミックス」（YouTubeが自動で作る再生リスト）は読み込めません。通常のプレイリストのURLを貼ってください');
  const key = props_().getProperty('YOUTUBE_API_KEY');
  if (!key) fail_('プレイリストの読み込みには YOUTUBE_API_KEY の設定が必要です（管理者向け）');

  const ids = fetchPlaylistVideoIds_(listId, key);
  if (!ids.length) fail_('プレイリストに曲が見つかりませんでした');
  const info = fetchVideoInfo_(ids, key);

  const have = {};
  plItemsOf_(user.email, list.id).forEach(it => { have[String(it.video_id)] = true; });
  let room = MY_PLAYLIST_ITEMS_MAX - Object.keys(have).length;
  const toAdd = [];
  let duplicated = 0, unavailable = 0, full = 0;
  ids.forEach(id => {
    const v = info[id];
    if (!v || !v.embeddable || v.privacyStatus === 'private') { unavailable++; return; }
    if (have[id]) { duplicated++; return; }
    if (room <= 0) { full++; return; }
    have[id] = true;
    room--;
    toAdd.push({ key: id, kind: 'yt', title: v.title, channel: v.channel });
  });

  const added = appendPlItems_(user.email, list.id, toAdd);
  if (added.length) updateRow_('PLAYLISTS', list._row, { updated_at: new Date() });
  return plResult_(user.email, {
    added: added, duplicated: duplicated, unavailable: unavailable, full: full, total: ids.length,
  });
}

function apiPlRemove_(req) {
  const user = auth_(req);
  const list = findMyPlaylist_(user.email, req.id);
  const itemId = String(req.itemId || '');
  const n = deleteWhere_('PLAYLIST_ITEMS', r =>
    String(r.id) === itemId && String(r.playlist_id) === String(list.id) && normEmail_(r.email) === user.email);
  if (!n) fail_('曲が見つかりませんでした');
  return plResult_(user.email);
}

function apiPlReorder_(req) {
  const user = auth_(req);
  const list = findMyPlaylist_(user.email, req.id);
  const ids = Array.isArray(req.itemIds) ? req.itemIds.map(String) : [];
  const sh = sheet_('PLAYLIST_ITEMS');
  const vals = sh.getDataRange().getValues();
  if (vals.length < 2) return plResult_(user.email);
  const h = vals[0].map(String);
  const ci = h.indexOf('id');
  const cp = h.indexOf('playlist_id');
  const ce = h.indexOf('email');
  const co = h.indexOf('sort_order');
  const pos = {};
  ids.forEach((id, i) => { pos[id] = i + 1; });
  let base = ids.length;
  const col = vals.slice(1).map(r => {
    if (normEmail_(r[ce]) === user.email && String(r[cp]) === String(list.id)) {
      const p = pos[String(r[ci])];
      return [p ? p : ++base];
    }
    return [r[co]];
  });
  sh.getRange(2, co + 1, col.length, 1).setValues(col);
  return plResult_(user.email);
}

/** プレイリスト自体の表示順を保存（ids＝表示したい順のプレイリストID） */
function apiPlOrder_(req) {
  const user = auth_(req);
  const ids = Array.isArray(req.ids) ? req.ids.map(String) : [];
  if (!ids.length) fail_('並び順が指定されていません');
  writePlOrder_(user.email, ids);
  return plResult_(user.email);
}

/** 本人のプレイリスト行に sort_order を 1,2,3… と書き込む（ids に無いものは末尾へ） */
function writePlOrder_(email, ids) {
  const sh = sheet_('PLAYLISTS');
  const vals = sh.getDataRange().getValues();
  if (vals.length < 2) return;
  const h = vals[0].map(String);
  const ci = h.indexOf('id');
  const ce = h.indexOf('email');
  const co = h.indexOf('sort_order');
  const pos = {};
  ids.forEach((id, i) => { if (!pos[id]) pos[id] = i + 1; });
  let base = ids.length;
  const col = vals.slice(1).map(r => {
    if (normEmail_(r[ce]) !== email) return [r[co]];
    const p = pos[String(r[ci])];
    return [p ? p : ++base];
  });
  sh.getRange(2, co + 1, col.length, 1).setValues(col);
}

/** sort_order 順。未設定（旧データ）は作成日時順で末尾へ */
function sortPlaylists_(lists) {
  return lists
    .slice()
    .sort((a, b) => toMs_(a.created_at) - toMs_(b.created_at))
    .sort((a, b) => {
      const x = Number(a.sort_order) > 0 ? Number(a.sort_order) : Infinity;
      const y = Number(b.sort_order) > 0 ? Number(b.sort_order) : Infinity;
      return x === y ? 0 : (x < y ? -1 : 1);
    });
}

/** 重複・上限をチェックして追加。タイトルが無いものだけ情報を取得 */
function addPlItems_(email, playlistId, inputs) {
  if (inputs.length > MY_PLAYLIST_ITEMS_MAX) fail_('一度に追加できるのは' + MY_PLAYLIST_ITEMS_MAX + '曲までです');
  const have = {};
  plItemsOf_(email, playlistId).forEach(it => { have[String(it.video_id)] = true; });
  const room = MY_PLAYLIST_ITEMS_MAX - Object.keys(have).length;
  const r = prepareItems_(inputs, have, room, {
    dup: 'すでにこのプレイリストに入っています',
    full: '1つのプレイリストは' + MY_PLAYLIST_ITEMS_MAX + '曲までです',
    checkAllYouTube: false,
  });
  return { added: appendPlItems_(email, playlistId, r.toAdd), skipped: r.skipped };
}

function appendPlItems_(email, playlistId, items) {
  if (!items.length) return [];
  let order = plItemsOf_(email, playlistId).reduce((m, it) => Math.max(m, Number(it.sort_order) || 0), 0);
  const now = new Date();
  const rows = items.map(c => {
    order++;
    return Object.assign(itemCols_(c), {
      id: Utilities.getUuid(),
      playlist_id: String(playlistId),
      email: email,
      sort_order: order,
      created_at: now,
    });
  });
  appendObjs_('PLAYLIST_ITEMS', rows);
  return rows.map(itemOut_);
}

function plItemsOf_(email, playlistId) {
  return readAll_('PLAYLIST_ITEMS').filter(r =>
    normEmail_(r.email) === email && String(r.playlist_id) === String(playlistId));
}

function findMyPlaylist_(email, id) {
  const list = readAll_('PLAYLISTS').find(r => normEmail_(r.email) === email && String(r.id) === String(id || ''));
  if (!list) fail_('プレイリストが見つかりません（削除された可能性があります）');
  return list;
}

function cleanPlName_(name) {
  const s = String(name || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!s) fail_('プレイリストの名前を入力してください');
  if (s.length > PL_NAME_MAX) fail_('名前は' + PL_NAME_MAX + '文字以内にしてください');
  return s;
}

/** 本人のプレイリストをすべて（曲つき・公開設定つき）返す */
function listMyPlaylists_(email) {
  const lists = sortPlaylists_(readAll_('PLAYLISTS').filter(r => normEmail_(r.email) === email));
  const byList = {};
  readAll_('PLAYLIST_ITEMS').forEach(r => {
    if (normEmail_(r.email) !== email) return;
    const k = String(r.playlist_id);
    (byList[k] = byList[k] || []).push(r);
  });
  return lists.map(l => ({
    id: String(l.id),
    name: String(l.name),
    shareOn: isOn_(l.share_on),
    shareTo: parseShareTo_(l.share_to),
    items: (byList[String(l.id)] || [])
      .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
      .map(itemOut_),
  }));
}

function plResult_(email, extra) {
  return Object.assign({
    ok: true,
    playlists: listMyPlaylists_(email),
    contacts: listContacts_(email),
    max: MY_PLAYLISTS_MAX,
    maxItems: MY_PLAYLIST_ITEMS_MAX,
    contactsMax: CONTACTS_MAX,
  }, extra || {});
}

function toMs_(v) {
  return v instanceof Date ? v.getTime() : Number(v) || 0;
}

/* =========================================================
 * 指定した会員だけに公開（家族・友人）
 *   ・公開相手は Contacts シートに「持ち主ごと」に登録
 *   ・プレイリストごとに share_on（公開スイッチ）と share_to（公開相手のメール配列）
 *   ・既定は非公開。公開相手から外した人には見えなくなる
 * ========================================================= */
function apiPlShareSet_(req) {
  const user = auth_(req);
  const list = findMyPlaylist_(user.email, req.id);
  const mine = listContacts_(user.email).map(c => c.email);
  const src = Array.isArray(req.to) ? req.to : parseShareTo_(list.share_to);
  const to = [];
  src.forEach(e => {
    const v = normEmail_(e);
    if (mine.indexOf(v) !== -1 && to.indexOf(v) === -1) to.push(v);
  });
  const on = req.on === true;
  if (on && !to.length) fail_('公開する相手を1人以上選んでください');
  updateRow_('PLAYLISTS', list._row, { share_on: on, share_to: JSON.stringify(to), updated_at: new Date() });
  return plResult_(user.email);
}

function apiContactAdd_(req) {
  const user = auth_(req);
  const email = normEmail_(req.email);
  if (!isEmail_(email)) fail_('メールアドレスの形式が正しくありません');
  if (email === user.email) fail_('ご自身のメールアドレスは登録できません');
  const list = listContacts_(user.email);
  if (list.some(c => c.email === email)) fail_('この相手はすでに登録されています');
  if (list.length >= CONTACTS_MAX) fail_('公開相手は' + CONTACTS_MAX + '人までです');
  appendObj_('CONTACTS', {
    owner_email: user.email,
    member_email: email,
    label: cleanLabel_(req.label, email),
    relation: cleanRelation_(req.relation),
    created_at: new Date(),
  });
  return plResult_(user.email, { addedEmail: email });
}

function apiContactUpdate_(req) {
  const user = auth_(req);
  const email = normEmail_(req.email);
  const row = readAll_('CONTACTS').find(r => normEmail_(r.owner_email) === user.email && normEmail_(r.member_email) === email);
  if (!row) fail_('公開相手が見つかりません');
  const upd = {};
  if (req.label !== undefined) upd.label = cleanLabel_(req.label, email);
  if (req.relation !== undefined) upd.relation = cleanRelation_(req.relation);
  updateRow_('CONTACTS', row._row, upd);
  return plResult_(user.email);
}

/** 公開相手を削除：その人に公開していたプレイリストからも外す（誰もいなくなったら非公開に戻す） */
function apiContactDelete_(req) {
  const user = auth_(req);
  const email = normEmail_(req.email);
  const n = deleteWhere_('CONTACTS', r => normEmail_(r.owner_email) === user.email && normEmail_(r.member_email) === email);
  if (!n) fail_('公開相手が見つかりません');
  readAll_('PLAYLISTS').forEach(l => {
    if (normEmail_(l.email) !== user.email) return;
    const to = parseShareTo_(l.share_to);
    if (to.indexOf(email) === -1) return;
    const rest = to.filter(e => e !== email);
    updateRow_('PLAYLISTS', l._row, {
      share_to: JSON.stringify(rest),
      share_on: rest.length ? isOn_(l.share_on) : false,
    });
  });
  return plResult_(user.email);
}

function listContacts_(email) {
  return readAll_('CONTACTS')
    .filter(r => normEmail_(r.owner_email) === email)
    .sort((a, b) => toMs_(a.created_at) - toMs_(b.created_at))
    .map(r => ({
      email: normEmail_(r.member_email),
      label: String(r.label || ''),
      relation: CONTACT_RELATIONS.indexOf(String(r.relation)) !== -1 ? String(r.relation) : 'その他',
    }));
}

/** 自分に公開されているプレイリスト（他の会員のもの） */
function apiSharedList_(req) {
  const user = auth_(req);
  canView_.contacts = null;
  const lists = readAll_('PLAYLISTS').filter(l => canView_(l, user.email));
  return { ok: true, shared: sharedOut_(lists) };
}

/** 共有リンク（?share=ID）から開く */
function apiSharedGet_(req) {
  const user = auth_(req);
  canView_.contacts = null;
  const id = String(req.id || '');
  const l = readAll_('PLAYLISTS').find(r => String(r.id) === id);
  if (l && normEmail_(l.email) === user.email) return { ok: true, own: true, id: id };
  if (!l || !canView_(l, user.email)) {
    fail_('このプレイリストは見られません（非公開になったか、あなたが公開相手に入っていません）');
  }
  return { ok: true, playlist: sharedOut_([l])[0] };
}

/** 閲覧できるか：公開中・公開相手に入っている・持ち主の公開相手リストに今も入っている */
function canView_(l, me) {
  const owner = normEmail_(l.email);
  if (owner === me || !isOn_(l.share_on)) return false;
  if (parseShareTo_(l.share_to).indexOf(me) === -1) return false;
  if (!canView_.contacts) canView_.contacts = readAll_('CONTACTS');
  return canView_.contacts.some(c => normEmail_(c.owner_email) === owner && normEmail_(c.member_email) === me);
}

function sharedOut_(lists) {
  if (!lists.length) return [];
  const ids = {};
  lists.forEach(l => { ids[String(l.id)] = { owner: normEmail_(l.email), items: [] }; });
  readAll_('PLAYLIST_ITEMS').forEach(r => {
    const g = ids[String(r.playlist_id)];
    if (g && normEmail_(r.email) === g.owner) g.items.push(r);
  });
  const names = {};
  readAll_('USERS').forEach(u => { names[normEmail_(u.email)] = String(u.nickname || ''); });
  return lists
    .map(l => ({
      id: String(l.id),
      name: String(l.name),
      ownerName: names[normEmail_(l.email)] || '会員',
      updatedAt: toMs_(l.updated_at),
      items: ids[String(l.id)].items
        .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
        .map(itemOut_),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function parseShareTo_(v) {
  try {
    const a = JSON.parse(String(v || '[]'));
    return Array.isArray(a) ? a.map(normEmail_).filter(Boolean) : [];
  } catch (e) {
    return [];
  }
}

function isOn_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

function cleanLabel_(label, email) {
  const s = String(label || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 20);
  return s || String(email).split('@')[0].slice(0, 20);
}

function cleanRelation_(v) {
  return CONTACT_RELATIONS.indexOf(String(v)) !== -1 ? String(v) : 'その他';
}

/* =========================================================
 * 曲データ（YouTube / Amazon Music 共通）
 *   video_id 列にはキーを保存：YouTube＝動画ID、Amazon＝「am_種類_ID」
 * ========================================================= */
const AMAZON_URL_RE = /^https?:\/\/(?:[a-z0-9-]+\.)*(?:amazon\.(?:co\.jp|com|co\.uk|de|fr|it|es|ca|in|com\.au|com\.mx|com\.br)|amzn\.(?:to|asia)|a\.co)(?:[\/?#]|$)/i;
const AMAZON_SHORT_RE = /^https?:\/\/(?:[a-z0-9-]+\.)*(?:amzn\.(?:to|asia)|a\.co)(?:[\/?#]|$)/i;
const AMAZON_TYPES = {
  albums: 'a', tracks: 't', playlists: 'p', 'user-playlists': 'u',
  artists: 'r', podcasts: 'c', episodes: 'e', stations: 's',
};

function isAmazonText_(s) {
  const v = String(s || '');
  return /(?:^|\/\/|\.)(?:amazon\.[a-z.]+|amzn\.(?:to|asia)|a\.co)(?:[\/?#]|$)/i.test(v) || /<iframe[^>]+amazon/i.test(v);
}

/**
 * 入力1件を解釈する。戻り値 {kind, key, url, embed, title, channel, thumb} または {error}
 * noNetwork=true のときは短縮URLの展開をしない（履歴など保存済みデータ用）
 */
function parseItem_(item, noNetwork) {
  item = item || {};
  const raw = String(item.url || item.videoId || '').trim();
  const title = String(item.title || '').trim();
  const channel = String(item.channel || '').trim();
  const amazon = item.kind === 'amazon' || /^am_/.test(String(item.videoId || '')) ||
    isAmazonText_(raw) || isAmazonText_(item.embed);
  if (amazon) {
    const a = parseAmazon_(String(item.embed || '').trim() || raw, noNetwork);
    if (a.error) return a;
    return {
      kind: 'amazon', key: a.key, url: a.url, embed: a.embed,
      title: title, channel: channel || 'Amazon Music', thumb: cleanThumb_(item.thumb),
    };
  }
  const vid = extractVideoId_(raw);
  if (!vid) return { error: 'URLを読み取れません（YouTube または Amazon Music のURLを貼ってください）' };
  return { kind: 'yt', key: vid, url: '', embed: '', title: title, channel: channel, thumb: '' };
}

function parseAmazon_(input, noNetwork) {
  let s = String(input || '').trim().replace(/&amp;/g, '&');
  // 埋め込みコード（共有 → 埋め込み）をそのまま貼った場合
  const iframe = s.match(/src\s*=\s*["'](https:\/\/music\.amazon\.[a-z.]+\/embed\/[^"']+)["']/i);
  if (iframe) s = iframe[1];
  if (/^https:\/\/music\.amazon\.[a-z.]+\/embed\//i.test(s)) {
    const m = s.match(/\/embed\/([A-Za-z0-9]{6,40})/);
    if (!m) return { error: 'Amazon Music の埋め込みコードを読み取れません' };
    const u = s.slice(0, 600);
    return { key: 'am_x_' + m[1], url: u, embed: u };
  }
  // 「〜をAmazon Musicで聴こう https://…」のような共有文から URL だけ取り出す
  const found = s.match(/https?:\/\/[^\s"'<>]+/);
  if (found) s = found[0];
  if (!AMAZON_URL_RE.test(s)) return { error: 'Amazon Music のURLを読み取れません' };
  if (AMAZON_SHORT_RE.test(s)) {
    if (noNetwork) return { error: '短縮URLは使えません' };
    s = resolveShortUrl_(s);
    if (!s || !AMAZON_URL_RE.test(s) || AMAZON_SHORT_RE.test(s)) {
      return { error: '短縮URLを開けませんでした。Amazon Music の「共有」→「リンクをコピー」で取得したURLを貼ってください' };
    }
  }
  const id = amazonId_(s);
  if (!id) return { error: 'Amazon Music の曲・アルバム・プレイリストのURLを貼ってください' };
  return { key: 'am_' + id.type + '_' + id.id, url: s.split('#')[0].slice(0, 600), embed: '' };
}

function amazonId_(url) {
  const t = url.match(/[?&]trackAsin=([A-Za-z0-9]{6,20})/);
  if (t) return { type: 't', id: t[1] };
  const ep = url.match(/\/episodes\/([A-Za-z0-9_-]{6,80})/);
  if (ep) return { type: 'e', id: ep[1] };
  const m = url.match(/\/(albums|tracks|playlists|user-playlists|artists|podcasts|stations)\/([A-Za-z0-9_-]{6,80})/);
  if (m) return { type: AMAZON_TYPES[m[1]], id: m[2] };
  const d = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
  if (d) return { type: 'd', id: d[1] };
  return null;
}

function resolveShortUrl_(u) {
  try {
    for (let i = 0; i < 4; i++) {
      const res = UrlFetchApp.fetch(u, { followRedirects: false, muteHttpExceptions: true });
      const h = res.getAllHeaders();
      const loc = h.Location || h.location;
      if (!loc) return AMAZON_SHORT_RE.test(u) ? '' : u;
      u = /^https?:\/\//.test(loc) ? String(loc) : u.replace(/^(https?:\/\/[^\/]+).*$/, '$1') + loc;
      if (!AMAZON_SHORT_RE.test(u)) return u;
    }
  } catch (e) {
    console.warn('resolveShortUrl_', e);
  }
  return '';
}

/** Amazon のページからタイトル・ジャケット画像を取得（取れないことも多いので失敗は無視） */
function amazonMeta_(url) {
  const cache = CacheService.getScriptCache();
  const ck = cacheKey_('am', url);
  const c = cache.get(ck);
  if (c) return JSON.parse(c);
  const out = { title: '', thumb: '' };
  try {
    const res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { 'Accept-Language': 'ja,en;q=0.8' },
    });
    if (res.getResponseCode() === 200) {
      const html = res.getContentText().slice(0, 300000);
      const og = (prop) => {
        const m = html.match(new RegExp('<meta[^>]+property=["\']og:' + prop + '["\'][^>]+content=["\']([^"\']+)["\']', 'i')) ||
          html.match(new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:' + prop + '["\']', 'i'));
        return m ? decodeEntities_(m[1]) : '';
      };
      let title = og('title');
      if (!title) {
        const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        title = t ? decodeEntities_(t[1]) : '';
      }
      title = title
        .replace(/\s*[-|｜:：]\s*Amazon(\.co\.jp|\.com)?\s*(Music|ミュージック)?.*$/i, '')
        .replace(/^Amazon\s*(Music|ミュージック)\s*[-|｜:：]\s*/i, '')
        .replace(/^Amazon(\.co\.jp|\.com)?\s*$/i, '')
        .trim();
      if (/robot|captcha|ロボット/i.test(title)) title = '';
      out.title = title.slice(0, 200);
      out.thumb = cleanThumb_(og('image'));
    }
  } catch (e) {
    console.warn('amazonMeta_', e);
  }
  cache.put(ck, JSON.stringify(out), 21600);
  return out;
}

function cleanThumb_(u) {
  const s = String(u || '').trim();
  return /^https:\/\/[a-z0-9.-]*(media-amazon|ssl-images-amazon|images-amazon)\.com\/[^\s"'<>]+$/i.test(s) ? s.slice(0, 500) : '';
}

/**
 * 追加しようとしている曲の確認：重複・上限・再生可否・タイトル
 * have＝登録済みキーの表、room＝残り枠（null なら上限なし）
 */
function prepareItems_(inputs, have, room, opt) {
  const candidates = [];
  const skipped = [];
  inputs.forEach(item => {
    const p = parseItem_(item);
    if (p.error) {
      skipped.push({ input: String((item && (item.url || item.videoId)) || ''), reason: p.error });
      return;
    }
    if (have[p.key]) { skipped.push({ videoId: p.key, reason: opt.dup }); return; }
    if (room !== null && room <= 0) { skipped.push({ videoId: p.key, reason: opt.full }); return; }
    have[p.key] = true;
    if (room !== null) room--;
    candidates.push(p);
  });

  // YouTube：タイトルと埋め込み可否を oEmbed で確認
  const ytNeed = candidates.filter(c => c.kind === 'yt' && (opt.checkAllYouTube || !c.title));
  if (ytNeed.length > MAX_BULK_ADD) fail_('タイトル不明の曲は一度に' + MAX_BULK_ADD + '件までです');
  const infos = oembedMany_(ytNeed.map(c => c.key));
  const bad = {};
  ytNeed.forEach((c, i) => {
    const info = infos[i] || {};
    if (info.error) { bad[c.key] = info.error; return; }
    if (!c.title) c.title = info.title || '';
    if (!c.channel) c.channel = info.author || '';
  });

  // Amazon Music：タイトルが無ければページから取得を試みる
  let fetched = 0;
  candidates.forEach(c => {
    if (c.kind !== 'amazon') return;
    if (!c.title && fetched < AMAZON_META_FETCH_MAX && !/^am_x_/.test(c.key)) {
      fetched++;
      const meta = amazonMeta_(c.url);
      c.title = meta.title;
      if (!c.thumb) c.thumb = meta.thumb;
    }
    if (!c.title) c.title = 'Amazon Music（' + amazonTypeLabel_(c.key) + '）';
  });

  const toAdd = [];
  candidates.forEach(c => {
    if (bad[c.key]) skipped.push({ videoId: c.key, reason: bad[c.key] });
    else toAdd.push(c);
  });
  return { toAdd: toAdd, skipped: skipped };
}

function amazonTypeLabel_(key) {
  const t = String(key).split('_')[1];
  return { a: 'アルバム', t: '曲', p: 'プレイリスト', u: 'プレイリスト', r: 'アーティスト',
    c: 'ポッドキャスト', e: 'エピソード', s: 'ステーション', d: '商品', x: '埋め込み' }[t] || 'Amazon';
}

/** シートに書く列 */
function itemCols_(c) {
  return {
    video_id: c.key,
    title: String(c.title || c.key).slice(0, 200),
    channel: String(c.channel || '').slice(0, 100),
    kind: c.kind === 'amazon' ? 'amazon' : 'yt',
    url: c.kind === 'amazon' ? String(c.url || '').slice(0, 600) : '',
    embed: c.kind === 'amazon' ? String(c.embed || '').slice(0, 600) : '',
    thumb: c.kind === 'amazon' ? String(c.thumb || '') : '',
  };
}

/** 画面に返す形 */
function itemOut_(r) {
  const amazon = String(r.kind) === 'amazon';
  return {
    id: String(r.id || ''),
    videoId: String(r.video_id),
    kind: amazon ? 'amazon' : 'yt',
    url: amazon ? String(r.url || '') : '',
    embed: amazon ? String(r.embed || '') : '',
    thumb: amazon ? String(r.thumb || '') : '',
    title: String(r.title),
    channel: String(r.channel || ''),
  };
}

/* =========================================================
 * DJ紹介（音声合成）
 *   読み上げる文章だけを送る（「〜で読み上げてください」などの指示文を混ぜない）
 * ========================================================= */
function apiTts_(req) {
  const user = auth_(req);
  const text = cleanNarration_(req.text).slice(0, NARRATION_MAX);
  if (!text) fail_('読み上げる文章がありません');

  const cache = CacheService.getScriptCache();
  const rk = cacheKey_('tts', user.email);
  const used = Number(cache.get(rk) || 0);
  if (used >= TTS_LIMIT_PER_6H) fail_('音声の利用回数が上限に達しました。数時間おいてからお試しください');
  cache.put(rk, String(used + 1), 21600);

  const key = props_().getProperty('GEMINI_API_KEY');
  if (!key) fail_('音声の準備ができていません（管理者：GEMINI_API_KEY を設定してください）');
  const model = props_().getProperty('GEMINI_TTS_MODEL') || 'gemini-2.5-flash-preview-tts';
  const voice = props_().getProperty('GEMINI_TTS_VOICE') || 'Aoede';
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      // 本文のみ。口調の指定は入れない（指示文まで読み上げられるのを防ぐ）
      contents: [{ role: 'user', parts: [{ text: text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    console.error('TTS error', code, res.getContentText());
    if (code === 429) fail_('音声が混み合っています。少し時間をおいてお試しください');
    fail_('音声を作れませんでした（' + code + '）');
  }
  try {
    const body = JSON.parse(res.getContentText());
    const part = body.candidates[0].content.parts.find(p => p.inlineData && p.inlineData.data);
    return { ok: true, audio: part.inlineData.data, mimeType: part.inlineData.mimeType || 'audio/L16;rate=24000', text: text };
  } catch (err) {
    console.error('TTS parse error', res.getContentText().slice(0, 500));
    fail_('音声を読み取れませんでした。もう一度お試しください');
  }
}

/** 読み上げ文から、冒頭の指示文・見出し・ト書き・記号を取り除く */
function cleanNarration_(s) {
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
  t = t.replace(/[*#_`~|]/g, '').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return t;
}

/* =========================================================
 * Gemini 選曲アシスタント
 * ========================================================= */
function apiGeminiRecommend_(req) {
  const user = auth_(req);
  const wish = String(req.prompt || '').trim().slice(0, 300);
  if (!wish) fail_('気分やキーワードを入力してください');

  const cache = CacheService.getScriptCache();
  const rk = cacheKey_('rec', user.email);
  const used = Number(cache.get(rk) || 0);
  if (used >= RECOMMEND_LIMIT_PER_6H) fail_('AI選曲の利用回数が上限に達しました。数時間おいてからお試しください');
  cache.put(rk, String(used + 1), 21600);

  const prompt = [
    'あなたは、YouTubeで音楽を聞き流す人のための選曲アシスタントです。',
    'ユーザーの希望：「' + wish + '」',
    'この希望に合う曲を' + RECOMMEND_COUNT + '曲選んでください。',
    '',
    '条件：',
    '- 実在する曲とアーティストだけを挙げる。存在しない曲は絶対に出さない。',
    '- YouTubeで公式音源や公式MVが見つかりやすい、よく知られた曲を優先する。',
    '- 同じアーティストは2曲まで。',
    '- query には、YouTube検索でその曲が見つかりやすい検索語を「曲名 アーティスト名」の形で入れる。',
    '- 希望が作業用BGMのような長時間の音楽に向いている場合は、その種類の長時間動画を探す検索語でもよい。その場合 title に内容を短く書き、artist は空文字にする。',
    '- djTalk は、夜のラジオDJがこの選曲を紹介する語り（話し言葉、100〜160字）。そのまま音声で流すので、',
    '  「〜で読み上げてください」「ナレーション：」などの指示文・見出し・ト書き（括弧書きの演出）・記号・絵文字は一切入れない。',
    '',
    '次のJSON形式だけを出力してください：',
    '{"playlistTitle":"プレイリスト名（15字以内）","comment":"選曲の意図を1〜2文で","djTalk":"DJの語り","items":[{"title":"曲名","artist":"アーティスト名","reason":"選んだ理由（25字以内）","query":"検索語"}]}',
  ].join('\n');

  const data = geminiJson_(prompt);
  const items = (Array.isArray(data.items) ? data.items : []).slice(0, RECOMMEND_COUNT).map(it => ({
    title: String(it.title || '').slice(0, 100),
    artist: String(it.artist || '').slice(0, 100),
    reason: String(it.reason || '').slice(0, 80),
    query: String(it.query || ((it.title || '') + ' ' + (it.artist || ''))).trim().slice(0, 120),
  })).filter(it => it.title && it.query);

  if (!items.length) fail_('選曲できませんでした。言い方を変えてもう一度お試しください');

  const found = ytSearchMany_(items.map(it => it.query));
  items.forEach((it, i) => {
    const f = found[i];
    it.videoId = f ? f.videoId : '';
    it.ytTitle = f ? f.title : '';
    it.channel = f ? f.channel : '';
  });

  return {
    ok: true,
    playlistTitle: String(data.playlistTitle || 'AI選曲').slice(0, 40),
    comment: String(data.comment || '').slice(0, 200),
    djTalk: cleanNarration_(data.djTalk || data.comment || '').slice(0, NARRATION_MAX),
    items: items,
    searchEnabled: !!props_().getProperty('YOUTUBE_API_KEY'),
  };
}

function geminiJson_(prompt) {
  const key = props_().getProperty('GEMINI_API_KEY');
  if (!key) fail_('AI選曲の準備ができていません（管理者：GEMINI_API_KEY を設定してください）');
  const model = props_().getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.9 },
    }),
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    console.error('Gemini error', code, res.getContentText());
    if (code === 429) fail_('AIが混み合っています。少し時間をおいてお試しください');
    fail_('AIの呼び出しに失敗しました（' + code + '）');
  }
  try {
    const body = JSON.parse(res.getContentText());
    const parts = body.candidates[0].content.parts;
    const text = parts.map(p => p.text || '').join('').replace(/```json|```/g, '').trim();
    return JSON.parse(text);
  } catch (err) {
    console.error('Gemini parse error', res.getContentText());
    fail_('AIの応答を読み取れませんでした。もう一度お試しください');
  }
}

/* =========================================================
 * YouTube 関連
 * ========================================================= */
function extractVideoId_(input) {
  const s = String(input || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/,
  ];
  for (let i = 0; i < patterns.length; i++) {
    const m = s.match(patterns[i]);
    if (m) return m[1];
  }
  return '';
}

function extractPlaylistId_(input) {
  const s = String(input || '').trim();
  const m = s.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  if (/^(PL|OL|UU|FL|RDCLAK)[A-Za-z0-9_-]{10,}$/.test(s)) return s;
  return '';
}

/** RD で始まるリストは自動生成ミックス（RDCLAK は YouTube Music の公式プレイリストなので対象外） */
function isMixList_(listId) {
  return /^RD/.test(listId) && !/^RDCLAK/.test(listId);
}

function fetchPlaylistVideoIds_(listId, key) {
  const ids = [];
  let pageToken = '';
  do {
    const url = 'https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50' +
      '&playlistId=' + encodeURIComponent(listId) + '&key=' + encodeURIComponent(key) +
      (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const code = res.getResponseCode();
    if (code !== 200) {
      console.warn('playlistItems', code, res.getContentText());
      if (code === 404) fail_('プレイリストが見つかりません（非公開、または読み込めない種類のリストです）');
      if (code === 403) fail_('YouTube APIの利用上限に達したか、APIキーの設定に問題があります');
      fail_('プレイリストを読み込めませんでした（' + code + '）');
    }
    const j = JSON.parse(res.getContentText());
    (j.items || []).forEach(it => {
      const v = it.contentDetails && it.contentDetails.videoId;
      if (v && ids.indexOf(v) === -1) ids.push(v);
    });
    pageToken = j.nextPageToken || '';
  } while (pageToken && ids.length < PLAYLIST_MAX);
  return ids.slice(0, PLAYLIST_MAX);
}

/** videos.list で タイトル・チャンネル・埋め込み可否を取得（50件ずつ） */
function fetchVideoInfo_(ids, key) {
  const reqs = [];
  for (let i = 0; i < ids.length; i += 50) {
    reqs.push({
      url: 'https://www.googleapis.com/youtube/v3/videos?part=snippet,status&maxResults=50' +
        '&id=' + ids.slice(i, i + 50).join(',') + '&key=' + encodeURIComponent(key),
      muteHttpExceptions: true,
    });
  }
  const map = {};
  UrlFetchApp.fetchAll(reqs).forEach(r => {
    if (r.getResponseCode() !== 200) { console.warn('videos', r.getContentText()); return; }
    (JSON.parse(r.getContentText()).items || []).forEach(v => {
      map[v.id] = {
        title: decodeEntities_(v.snippet.title),
        channel: decodeEntities_(v.snippet.channelTitle),
        embeddable: !!(v.status && v.status.embeddable),
        privacyStatus: v.status ? v.status.privacyStatus : '',
      };
    });
  });
  return map;
}

/** oEmbed でタイトル取得＋埋め込み可否チェック */
function oembedMany_(ids) {
  if (!ids.length) return [];
  const reqs = ids.map(id => ({
    url: 'https://www.youtube.com/oembed?format=json&url=' +
      encodeURIComponent('https://www.youtube.com/watch?v=' + id),
    muteHttpExceptions: true,
  }));
  let res;
  try {
    res = UrlFetchApp.fetchAll(reqs);
  } catch (err) {
    return ids.map(() => ({}));
  }
  return res.map(r => {
    const code = r.getResponseCode();
    if (code === 200) {
      try {
        const j = JSON.parse(r.getContentText());
        return { title: j.title || '', author: j.author_name || '' };
      } catch (e) { return {}; }
    }
    if (code === 401 || code === 403) return { error: '埋め込み再生が許可されていない動画です' };
    if (code === 400 || code === 404) return { error: '動画が見つかりません（非公開・削除の可能性）' };
    return {};
  });
}

/** YouTube Data API v3 で検索語 → 動画ID（6時間キャッシュ） */
function ytSearchMany_(queries) {
  const key = props_().getProperty('YOUTUBE_API_KEY');
  if (!key) return queries.map(() => null);
  const cache = CacheService.getScriptCache();
  const results = queries.map(() => null);
  const reqs = [];
  const idx = [];
  queries.forEach((q, i) => {
    const c = cache.get(cacheKey_('yt', q));
    if (c) { results[i] = JSON.parse(c); return; }
    reqs.push({
      url: 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true' +
        '&maxResults=1&safeSearch=moderate&regionCode=JP&relevanceLanguage=ja' +
        '&q=' + encodeURIComponent(q) + '&key=' + encodeURIComponent(key),
      muteHttpExceptions: true,
    });
    idx.push(i);
  });
  if (reqs.length) {
    UrlFetchApp.fetchAll(reqs).forEach((r, k) => {
      const i = idx[k];
      if (r.getResponseCode() !== 200) { console.warn('YouTube search', r.getContentText()); return; }
      const it = (JSON.parse(r.getContentText()).items || [])[0];
      if (!it || !it.id || !it.id.videoId) return;
      const v = {
        videoId: it.id.videoId,
        title: decodeEntities_(it.snippet.title),
        channel: decodeEntities_(it.snippet.channelTitle),
      };
      results[i] = v;
      cache.put(cacheKey_('yt', queries[i]), JSON.stringify(v), 21600);
    });
  }
  return results;
}

/* =========================================================
 * セッション
 * ========================================================= */
function createSession_(email) {
  if (Math.random() < 0.1) cleanupSessions_();
  const token = Utilities.getUuid().replace(/-/g, '') + randStr_(16, TOKEN_CHARS);
  const expiresAt = Date.now() + SESSION_DAYS * 86400 * 1000;
  appendObj_('SESSIONS', { token: token, email: email, expires_at: expiresAt, created_at: new Date() });
  CacheService.getScriptCache().put('s_' + token, JSON.stringify({ email: email, expiresAt: expiresAt }), 21600);
  return { token: token, expiresAt: expiresAt };
}

function auth_(req, allowTemp) {
  const token = String(req.token || '');
  if (!token) fail_('ログインしてください', 'AUTH');

  const cache = CacheService.getScriptCache();
  let s = null;
  const c = cache.get('s_' + token);
  if (c) {
    s = JSON.parse(c);
  } else {
    const row = readAll_('SESSIONS').find(r => String(r.token) === token);
    if (row) {
      s = { email: normEmail_(row.email), expiresAt: Number(row.expires_at) };
      cache.put('s_' + token, JSON.stringify(s), 21600);
    }
  }
  if (!s || s.expiresAt < Date.now()) fail_('ログインの有効期限が切れました。もう一度ログインしてください', 'AUTH');

  const user = findUser_(s.email);
  if (!user) fail_('アカウントが見つかりません', 'AUTH');
  if (user.status === 'temp' && !allowTemp) fail_('先に新しいパスワードを設定してください', 'MUST_CHANGE_PASSWORD');
  return user;
}

function deleteSessionsByEmail_(email) {
  const cache = CacheService.getScriptCache();
  deleteWhere_('SESSIONS', r => {
    const hit = normEmail_(r.email) === email;
    if (hit) cache.remove('s_' + r.token);
    return hit;
  });
}

function cleanupSessions_() {
  const now = Date.now();
  deleteWhere_('SESSIONS', r => Number(r.expires_at) < now);
}

/* =========================================================
 * パスワード・乱数
 * ========================================================= */
function hash_(password, salt) {
  const pepper = props_().getProperty('PEPPER') || '';
  let d = String(password) + ':' + String(salt) + ':' + pepper;
  for (let i = 0; i < HASH_ROUNDS; i++) {
    d = Utilities.base64Encode(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, d + pepper, Utilities.Charset.UTF_8));
  }
  return d;
}

function checkPassword_(pw) {
  if (pw.length < 8 || pw.length > 64) fail_('パスワードは8〜64文字にしてください');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) fail_('パスワードには英字と数字を両方含めてください');
}

function randStr_(len, chars) {
  let out = '';
  while (out.length < len) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + Date.now() + Math.random());
    for (let i = 0; i < bytes.length && out.length < len; i++) {
      out += chars[(bytes[i] + 256) % chars.length];
    }
  }
  return out;
}

/* =========================================================
 * スプレッドシート共通
 * ========================================================= */
function ss_() {
  const id = props_().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

const HEADER_CHECKED_ = {};

function sheet_(key) {
  const def = SHEETS[key];
  let sh = ss_().getSheetByName(def.name);
  if (!sh) {
    sh = ss_().insertSheet(def.name);
    sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (!HEADER_CHECKED_[key]) {
    // 既存シートに新しい列（例：Playlists の sort_order）が無ければ右端に自動追加
    const lastCol = Math.max(sh.getLastColumn(), 1);
    const cur = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
    const missing = def.headers.filter(h => cur.indexOf(h) === -1);
    if (missing.length) {
      let last = cur.length;
      while (last > 0 && cur[last - 1] === '') last--;
      const start = last + 1;
      sh.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold');
    }
  }
  HEADER_CHECKED_[key] = true;
  return sh;
}

function headers_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}

function readAll_(key) {
  const sh = sheet_(key);
  const values = sh.getDataRange().getValues();
  const h = values.shift().map(String);
  return values.map((r, i) => {
    const o = { _row: i + 2 };
    h.forEach((k, j) => { o[k] = r[j]; });
    return o;
  });
}

function appendObj_(key, obj) {
  const sh = sheet_(key);
  sh.appendRow(headers_(sh).map(k => safe_(obj[k])));
}

function appendObjs_(key, objs) {
  if (!objs.length) return;
  const sh = sheet_(key);
  const h = headers_(sh);
  const values = objs.map(o => h.map(k => safe_(o[k])));
  sh.getRange(sh.getLastRow() + 1, 1, values.length, h.length).setValues(values);
}

function updateRow_(key, row, obj) {
  const sh = sheet_(key);
  const h = headers_(sh);
  const range = sh.getRange(row, 1, 1, h.length);
  const cur = range.getValues()[0];
  h.forEach((k, j) => {
    if (Object.prototype.hasOwnProperty.call(obj, k)) cur[j] = obj[k];
  });
  range.setValues([cur.map(safe_)]);
}

function deleteWhere_(key, pred) {
  const sh = sheet_(key);
  const vals = sh.getDataRange().getValues();
  const h = vals[0].map(String);
  let n = 0;
  for (let r = vals.length - 1; r >= 1; r--) {
    const o = {};
    h.forEach((k, j) => { o[k] = vals[r][j]; });
    if (pred(o)) { sh.deleteRow(r + 1); n++; }
  }
  return n;
}

/** 条件に合う行をまとめて削除（1行ずつ deleteRow しないので大量削除でも速い） */
function bulkDeleteWhere_(key, pred) {
  const sh = sheet_(key);
  const vals = sh.getDataRange().getValues();
  if (vals.length < 2) return 0;
  const h = vals[0].map(String);
  const keep = vals.slice(1).filter(r => {
    const o = {};
    h.forEach((k, j) => { o[k] = r[j]; });
    return !pred(o);
  });
  const n = vals.length - 1 - keep.length;
  if (!n) return 0;
  sh.getRange(2, 1, vals.length - 1, h.length).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, h.length).setValues(keep.map(r => r.map(safe_)));
  return n;
}

/** 数式・数値として解釈されないよう文字列を保護 */
function safe_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' && /^[=+\-@0-9.]/.test(v)) return "'" + v;
  return v;
}

function findUser_(email) {
  if (!email) return null;
  return readAll_('USERS').find(u => normEmail_(u.email) === email) || null;
}

function publicUser_(u) {
  return {
    email: normEmail_(u.email),
    nickname: String(u.nickname || ''),
    status: String(u.status),
    agreed: String(u.terms_version || '') === TERMS_VERSION,
  };
}

/* =========================================================
 * その他ユーティリティ
 * ========================================================= */
function props_() { return PropertiesService.getScriptProperties(); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(message, code) {
  const e = new Error(message);
  e.userMessage = message;
  e.code = code || '';
  throw e;
}

function normEmail_(v) { return String(v || '').normalize('NFKC').trim().toLowerCase(); }

/** 全角→半角・前後の空白除去（iPhoneのコピー貼り付け対策） */
function normPw_(v) { return String(v || '').normalize('NFKC').replace(/\s+/g, ''); }

function isEmail_(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254; }

function appUrl_() { return props_().getProperty('APP_URL') || ''; }

function sendMail_(to, subject, body) {
  GmailApp.sendEmail(to, subject, body, { name: APP_NAME });
}

function cacheKey_(prefix, s) {
  return prefix + '_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(s), Utilities.Charset.UTF_8));
}

function decodeEntities_(s) {
  return String(s || '')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
