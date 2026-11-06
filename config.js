/* =========================================================
 * ながら聴き 設定ファイル
 * ・GASを「新しいデプロイ」でURLが変わったら GAS_URL を書き換える
 * ・index.html / style.css / app.js を更新したら APP_VERSION を上げる
 *   （画面下に表示され、style.css / app.js のキャッシュも自動で更新される）
 * ・Code.gs の SERVER_VERSION も同じ番号にすると、画面下に「サーバー 1.10.0」と並んで表示される
 *   （番号が違うと赤字になる＝GASの新バージョンのデプロイ忘れの目印）
 * ・config.js 自体は毎回最新が読み込まれる
 * ========================================================= */
window.APP_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbwfuR-m17cQY-i27U12rLRMjZMEz2roXuF8gMBxzdm9H_VyqBJMuvtLYa6LmN70WoNihw/exec',
  APP_VERSION: '1.10.0',
  APP_UPDATED: '2026-11-07',
};
