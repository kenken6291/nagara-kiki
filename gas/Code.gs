/**
 * ながら聴き — YouTube聞き流しWebアプリ バックエンド（Google Apps Script）
 *
 * スクリプトプロパティ（プロジェクトの設定 → スクリプト プロパティ）
 *   GEMINI_API_KEY   : 必須。Gemini API キー
 *   GEMINI_MODEL     : 任意。既定 gemini-2.5-flash
 *   YOUTUBE_API_KEY  : 任意。YouTube Data API v3 キー（AI選曲の曲を実際の動画に変換する）
 *   APP_URL          : 任意。GitHub Pages のURL（メール本文に記載）
 *   SPREADSHEET_ID   : 任意。スプレッドシートにバインドしない場合のみ指定
 *   PEPPER           : setup() が自動生成（変更しないこと）
 *
 * 初回は setup() を実行してください。
 */

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
const MY_PLAYLISTS_MAX = 10;        // マイプレイリスト：1人あたりの個数
const MY_PLAYLIST_ITEMS_MAX = 200;  // マイプレイリスト：1つあたりの曲数
const PL_NAME_MAX = 30;

const PW_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const TOKEN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const SHEETS = {
  USERS: {
    name: 'Users',
    headers: ['email', 'nickname', 'hash_password', 'salt', 'status', 'temp_token', 'temp_expires',
      'fail_count', 'locked_until', 'created_at', 'updated_at'],
  },
  SESSIONS: { name: 'Sessions', headers: ['token', 'email', 'expires_at', 'created_at'] },
  FAVORITES: {
    name: 'Favorites',
    headers: ['id', 'email', 'video_id', 'title', 'channel', 'sort_order', 'created_at'],
  },
  HISTORY: { name: 'History', headers: ['email', 'video_id', 'title', 'played_at'] },
  PLAYLISTS: { name: 'Playlists', headers: ['id', 'email', 'name', 'created_at', 'updated_at', 'sort_order'] },
  PLAYLIST_ITEMS: {
    name: 'PlaylistItems',
    headers: ['id', 'playlist_id', 'email', 'video_id', 'title', 'channel', 'sort_order', 'created_at'],
  },
};

const WRITE_ACTIONS = ['register', 'login', 'set_password', 'forgot_password', 'reset_password', 'logout',
  'save_favorite', 'import_playlist', 'delete_favorite', 'reorder_favorites', 'add_history',
  'pl_create', 'pl_rename', 'pl_delete', 'pl_add', 'pl_import', 'pl_remove', 'pl_reorder', 'pl_order'];

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
  return json_({ ok: true, app: APP_NAME, message: 'API is running' });
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
  };

  const fn = routes[req.action];
  if (!fn) return json_({ ok: false, error: '不明な操作です: ' + req.action });

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
  return { ok: true, user: publicUser_(user) };
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
    : [{ url: req.url || req.videoId, title: req.title, channel: req.channel }];
  if (!inputs.length) fail_('追加する動画がありません');
  if (inputs.length > MAX_BULK_ADD) fail_('一度に追加できるのは' + MAX_BULK_ADD + '件までです');

  const have = {};
  listFavorites_(user.email).forEach(f => { have[f.videoId] = true; });

  const candidates = [];
  const skipped = [];
  inputs.forEach(item => {
    const raw = String(item.url || item.videoId || '');
    const vid = extractVideoId_(raw);
    if (!vid) { skipped.push({ input: raw, reason: 'URLまたは動画IDを読み取れません' }); return; }
    if (have[vid]) { skipped.push({ videoId: vid, reason: 'すでにお気に入りにあります' }); return; }
    have[vid] = true;
    candidates.push({ videoId: vid, title: String(item.title || '').trim(), channel: String(item.channel || '').trim() });
  });

  const infos = oembedMany_(candidates.map(c => c.videoId));
  const toAdd = [];
  candidates.forEach((c, i) => {
    const info = infos[i];
    if (info.error) { skipped.push({ videoId: c.videoId, reason: info.error }); return; }
    toAdd.push({ videoId: c.videoId, title: c.title || info.title, channel: c.channel || info.author });
  });

  const added = appendFavorites_(user.email, toAdd);
  return { ok: true, added: added, skipped: skipped, favorites: listFavorites_(user.email) };
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
    toAdd.push({ videoId: id, title: v.title, channel: v.channel });
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

/** 重複チェック済みの曲をまとめて末尾に追加 */
function appendFavorites_(email, items) {
  if (!items.length) return [];
  let order = listFavorites_(email).reduce((m, f) => Math.max(m, f.sortOrder || 0), 0);
  const now = new Date();
  const rows = items.map(c => {
    order++;
    return {
      id: Utilities.getUuid(),
      email: email,
      video_id: c.videoId,
      title: String(c.title || c.videoId).slice(0, 200),
      channel: String(c.channel || '').slice(0, 100),
      sort_order: order,
      created_at: now,
    };
  });
  appendObjs_('FAVORITES', rows);
  return rows.map(r => ({ id: r.id, videoId: r.video_id, title: r.title, channel: r.channel }));
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
    .map(r => ({
      id: String(r.id),
      videoId: String(r.video_id),
      title: String(r.title),
      channel: String(r.channel || ''),
      sortOrder: Number(r.sort_order) || 0,
    }));
}

/* =========================================================
 * 再生履歴
 * ========================================================= */
function apiAddHistory_(req) {
  const user = auth_(req);
  const vid = extractVideoId_(req.videoId);
  if (!vid) fail_('動画IDが正しくありません');
  appendObj_('HISTORY', {
    email: user.email,
    video_id: vid,
    title: String(req.title || vid).slice(0, 200),
    played_at: new Date(),
  });
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
    out.push({
      videoId: v,
      title: String(r.title),
      playedAt: r.played_at instanceof Date ? r.played_at.getTime() : Number(r.played_at) || 0,
    });
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
  if (req.url) inputs = [{ url: req.url }];
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
    toAdd.push({ videoId: id, title: v.title, channel: v.channel });
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

/** 重複・上限をチェックして追加。タイトルが無いものだけ oEmbed で取得 */
function addPlItems_(email, playlistId, inputs) {
  if (inputs.length > MY_PLAYLIST_ITEMS_MAX) fail_('一度に追加できるのは' + MY_PLAYLIST_ITEMS_MAX + '曲までです');
  const have = {};
  plItemsOf_(email, playlistId).forEach(it => { have[String(it.video_id)] = true; });
  let room = MY_PLAYLIST_ITEMS_MAX - Object.keys(have).length;

  const candidates = [];
  const skipped = [];
  inputs.forEach(item => {
    const raw = String(item.videoId || item.url || '');
    const vid = extractVideoId_(raw);
    if (!vid) { skipped.push({ input: raw, reason: 'URLまたは動画IDを読み取れません' }); return; }
    if (have[vid]) { skipped.push({ videoId: vid, reason: 'すでにこのプレイリストに入っています' }); return; }
    if (room <= 0) { skipped.push({ videoId: vid, reason: '1つのプレイリストは' + MY_PLAYLIST_ITEMS_MAX + '曲までです' }); return; }
    have[vid] = true;
    room--;
    candidates.push({ videoId: vid, title: String(item.title || '').trim(), channel: String(item.channel || '').trim() });
  });

  const needInfo = candidates.filter(c => !c.title);
  if (needInfo.length > MAX_BULK_ADD) fail_('タイトル不明の曲は一度に' + MAX_BULK_ADD + '件までです');
  const infos = oembedMany_(needInfo.map(c => c.videoId));
  const infoMap = {};
  needInfo.forEach((c, i) => { infoMap[c.videoId] = infos[i]; });

  const toAdd = [];
  candidates.forEach(c => {
    const info = infoMap[c.videoId];
    if (info && info.error) { skipped.push({ videoId: c.videoId, reason: info.error }); return; }
    toAdd.push({
      videoId: c.videoId,
      title: c.title || (info && info.title) || c.videoId,
      channel: c.channel || (info && info.author) || '',
    });
  });

  return { added: appendPlItems_(email, playlistId, toAdd), skipped: skipped };
}

function appendPlItems_(email, playlistId, items) {
  if (!items.length) return [];
  let order = plItemsOf_(email, playlistId).reduce((m, it) => Math.max(m, Number(it.sort_order) || 0), 0);
  const now = new Date();
  const rows = items.map(c => {
    order++;
    return {
      id: Utilities.getUuid(),
      playlist_id: String(playlistId),
      email: email,
      video_id: c.videoId,
      title: String(c.title || c.videoId).slice(0, 200),
      channel: String(c.channel || '').slice(0, 100),
      sort_order: order,
      created_at: now,
    };
  });
  appendObjs_('PLAYLIST_ITEMS', rows);
  return rows.map(r => ({ id: r.id, videoId: r.video_id, title: r.title, channel: r.channel }));
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

/** 本人のプレイリストをすべて（曲つき）返す */
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
    items: (byList[String(l.id)] || [])
      .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
      .map(r => ({
        id: String(r.id),
        videoId: String(r.video_id),
        title: String(r.title),
        channel: String(r.channel || ''),
      })),
  }));
}

function plResult_(email, extra) {
  return Object.assign({
    ok: true,
    playlists: listMyPlaylists_(email),
    max: MY_PLAYLISTS_MAX,
    maxItems: MY_PLAYLIST_ITEMS_MAX,
  }, extra || {});
}

function toMs_(v) {
  return v instanceof Date ? v.getTime() : Number(v) || 0;
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
    '',
    '次のJSON形式だけを出力してください：',
    '{"playlistTitle":"プレイリスト名（15字以内）","comment":"選曲の意図を1〜2文で","items":[{"title":"曲名","artist":"アーティスト名","reason":"選んだ理由（25字以内）","query":"検索語"}]}',
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
  return { email: normEmail_(u.email), nickname: String(u.nickname || ''), status: String(u.status) };
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
