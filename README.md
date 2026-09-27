# ながら聴き（nagara-kiki）デプロイ手順

```
nagara-kiki/
├── index.html      … GitHub Pages
├── style.css       … GitHub Pages
├── app.js          … GitHub Pages（GAS_URL を書き換える）
└── gas/Code.gs     … Google Apps Script に貼り付け（GitHubに置くのは任意）
```

## 1. スプレッドシートと GAS

1. Googleスプレッドシートを新規作成（名前例：`nagara-kiki-db`）
2. メニュー「拡張機能」→「Apps Script」を開く
3. `コード.gs` の中身を全部消して `gas/Code.gs` を貼り付け、保存
4. 関数選択で `setup` を選び「実行」
   - 初回は権限の承認が出る →「詳細」→「安全ではないページに移動」→ 許可
   - Users / Sessions / Favorites / History の4シートが作られ、PEPPER が自動登録される
5. 左の歯車「プロジェクトの設定」→「スクリプト プロパティ」に追加

| プロパティ | 必須 | 内容 |
|---|---|---|
| `GEMINI_API_KEY` | 必須 | Google AI Studio で発行したキー |
| `YOUTUBE_API_KEY` | 推奨 | YouTube Data API v3 のキー（下記） |
| `APP_URL` | 任意 | `https://kenken6291.github.io/nagara-kiki/`（メールに記載） |
| `GEMINI_MODEL` | 任意 | 既定 `gemini-2.5-flash` |
| `PEPPER` | 自動 | **変更しない**（変えると全員ログイン不可） |

### YouTube Data API キー（AI選曲を実際の動画にするため）
Geminiは実在の動画IDを正確に知らないため、GAS側で「曲名 アーティスト」をYouTube検索して動画IDに変換しています。

1. Google Cloud Console → プロジェクト作成（既存でも可）
2. 「APIとサービス」→「ライブラリ」→ **YouTube Data API v3** を有効化
3. 「認証情報」→「APIキーを作成」→ キーを `YOUTUBE_API_KEY` に登録
   - 制限は「APIの制限：YouTube Data API v3」だけ付ける（GASから呼ぶのでリファラー制限は付けない）

無料枠は1日10,000ユニット、検索1回100ユニット。AI選曲1回で最大8検索＝800ユニットなので、**1日およそ12回分**（同じ検索語は6時間キャッシュされるので実際はもう少し多い）。
未設定でも動作し、その場合は各曲に「YouTubeで探す」リンクが出ます。

## 2. ウェブアプリとしてデプロイ

1. 右上「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
2. 次のユーザーとして実行：**自分**
3. アクセスできるユーザー：**全員**
4. 「デプロイ」→ 表示された **ウェブアプリURL（…/exec）** をコピー
5. ブラウザでそのURLを開き `{"ok":true,...}` が出ればOK

> ⚠ Code.gs を修正したら「デプロイを管理」→ 鉛筆 → バージョン「**新バージョン**」→ デプロイ。
> これをしないと修正が反映されません（URLは変わりません）。

## 3. GitHub Pages

1. GitHubで `nagara-kiki` リポジトリを作成（Public）
2. `app.js` 冒頭の `CONFIG.GAS_URL` を手順2のURLに書き換え
3. `index.html` / `style.css` / `app.js`（と任意で `gas/`）をアップロード
4. Settings → Pages → Branch: `main` / `/(root)` → Save
5. 数分後 `https://kenken6291.github.io/nagara-kiki/` で公開

## 4. CORS・通信の注意点

- フロントは `Content-Type: text/plain` でPOSTしています。`application/json` にするとプリフライト（OPTIONS）が発生し、GASは応答できずに失敗します。
- GASの `/exec` は `script.googleusercontent.com` へ **302リダイレクト**して結果を返します。`fetch` は `redirect: 'follow'`（既定）で自動追従するので追加対応は不要です。
- 「サーバーの応答を読み取れませんでした」と出る場合は、アクセス権が「全員」になっていない（Googleのログイン画面HTMLが返っている）ことがほとんどです。

## 5. 動作確認の順番

1. 新規登録 → メールで仮パスワード受信
2. 仮パスワードでログイン → 新パスワード設定画面が出る
3. お気に入りにYouTubeのURLを追加 → 再生 → 曲の終わりで次へ進む
4. AI選曲 → 「この選曲で再生」「まとめて追加」
5. ログアウト → 「パスワードを忘れた方」→ 6桁コードで再設定

## 6. 仕様メモ

- パスワード：SHA-256 ×300回＋ソルト＋ペッパー。英字＋数字8文字以上
- ログイン5回失敗で15分ロック（再設定コードの入力ミスも同様）
- セッション：14日間。Sessionsシートに保存し、CacheServiceで高速化
- 仮パスワード有効期限24時間、再設定コード30分
- AI選曲：1ユーザー6時間あたり15回まで
- 履歴シートは5,000行を超えると古い1,000行を自動削除
- 埋め込み禁止の動画は追加時にはじき、再生時にエラーが出たら自動で次の曲へ

## 7. できないこと（YouTube側の制約）

- **スマホで画面を消す／別アプリに切り替えると再生が止まります。** 埋め込みプレイヤーのバックグラウンド再生はYouTubeが許可していません（YouTube Premium の公式アプリのみ）。画面をつけたまま、このタブを開いておけば連続再生されます。
- プレイリストURLは最大200曲までまとめて追加できます（`YOUTUBE_API_KEY` が必要）。
- YouTubeが自動で作る「ミックス」（`list=RD…`、ただし YouTube Music の `RDCLAK…` は可）、「後で見る」「高く評価した動画」などの個人用リスト、非公開プレイリストは読み込めません。
