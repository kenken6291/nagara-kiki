/* =========================================================
 * ながら聴き 設定ファイル
 * ・GASを「新しいデプロイ」でURLが変わったら GAS_URL を書き換える
 * ・index.html / style.css / app.js を更新したら APP_VERSION を上げる
 *   （画面下に表示され、style.css / app.js のキャッシュも自動で更新される）
 * ・Code.gs の SERVER_VERSION も同じ番号にすると、画面下に「サーバー 1.10.0」と並んで表示される
 *   （「1.10」までが違うと赤字になる＝GASの新バージョンのデプロイ忘れの目印。
 *    最後の数字だけ上げた画面だけの修正では赤字にならない）
 * ・config.js 自体は毎回最新が読み込まれる
 * ========================================================= */
window.APP_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbwfuR-m17cQY-i27U12rLRMjZMEz2roXuF8gMBxzdm9H_VyqBJMuvtLYa6LmN70WoNihw/exec',
  APP_VERSION: '1.11.0',
  APP_UPDATED: '2026-11-19',

  // 既定のGeminiモデル（利用者が画面で選ばなかった時に使う）
  // 空文字 '' = 自動（汎用の最新モデル）
  GEMINI_MODEL: '',

  // AI選曲の「AIモデル」選択肢（value が API のモデルID）
  // 指定モデルが使えない（廃止・未公開・名前違い）場合は、GAS側で汎用の最新モデルへ自動で切り替わる
  GEMINI_MODEL_OPTIONS: [
    { value: '',                  label: '自動モード（汎用の最新）' },
    { value: 'gemini-4-hydrogen', label: '4 Hydrogen（日々の暮らしをサポート）' },
    { value: 'gemini-4-neon',     label: '4 Neon（Deeper analysis）' },
    { value: 'gemini-4-carbon',   label: '4 Carbon（Code & complex work）' },
    { value: 'gemini-4-argon',    label: '4 Argon' },
    { value: 'gemini-3.8-flash',  label: '3.8 Flash' },
    { value: 'gemini-3.5-flash',  label: '3.5 Flash' },
  ],
};
