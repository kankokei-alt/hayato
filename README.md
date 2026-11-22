# ハヤト — 音声で話せるパーソナルAIエージェント

スマホに話しかけると、AIエージェント「ハヤト」が声で答えます。
調べもの、Googleカレンダーの予定確認・登録、メモやタスク管理を、会話しながら任せられます。

- 頭脳: Claude（Anthropic の Claude API）
- 声: スマホ・PCのブラウザに内蔵された音声認識と読み上げ（追加料金なし）
- 形: ホーム画面に追加してアプリのように使える Web アプリ（PWA）

## できること

| 話しかけ方の例 | ハヤトがすること |
|---|---|
| 「今日のニュースで大事なのは？」 | Web検索して要点を口頭で報告 |
| 「明日の予定は？」 | Googleカレンダーを確認して読み上げ |
| 「金曜の15時に歯医者を入れて」 | 内容を復唱して確認後、カレンダーに登録 |
| 「牛乳を買うのをメモして」 | メモとして保存（後で「買い物メモある？」で呼び出せる） |
| 「やることに企画書の提出を追加、期限は月末」 | タスクに登録。「やること教えて」で読み上げ |

画面中央のコアは状態で色と動きが変わります。青: 待機・聞き取り中、橙: 分析中（考え中・ツール実行中）、緑: 話している。
話している最中にマイクを押すと、割り込んで次の話を聞き取ります。「連続会話」をオンにすると、返答のあと自動で聞き取りを再開します。

## はじめかた

### 1. 準備

- Node.js 20 以上
- Claude API キー: https://console.anthropic.com で発行（利用料は従量課金です）

```bash
npm install
cp .env.example .env
# .env を開いて ANTHROPIC_API_KEY と HAYATO_PASSCODE を書く
npm start
```

PC のブラウザ（Chrome 推奨）で http://localhost:3000 を開き、マイクボタンを押して話しかけます。

### 2. スマホで使う

スマホのブラウザでマイクを使うには **HTTPS** の URL が必要です。次のどちらかで公開してください。

**A. 手元の PC を一時的に公開（手軽）**
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) を使うと、`https://xxxx.trycloudflare.com` のような URL がすぐ発行されます。

```bash
npm start
# 別のターミナルで
cloudflared tunnel --url http://localhost:3000
```

**B. クラウドに置く（常時使う）**
Render、Railway、Fly.io などの Node.js が動くサービスにデプロイし、環境変数に `.env` と同じ値を設定します。メモやカレンダーのログイン情報は `data/` フォルダに保存されるので、永続ディスクを `data/` に割り当ててください。

スマホで URL を開いたら:
1. 右上の設定でパスコード（`HAYATO_PASSCODE`）を入力
2. iPhone は Safari の「共有 → ホーム画面に追加」、Android は Chrome のメニュー「ホーム画面に追加」
3. ホーム画面のアイコンから起動して、マイクをタップ

> 公開するときは必ず `HAYATO_PASSCODE` を設定してください。設定しないと、URL を知っている人が誰でもあなたの API キーでハヤトを使えてしまいます。

### 3. Googleカレンダーをつなぐ（任意）

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作り、「Google Calendar API」を有効にする
2. 「APIとサービス → OAuth 同意画面」を設定（自分だけで使うならテストユーザーに自分のアドレスを追加）
3. 「認証情報 → OAuth クライアント ID」を **ウェブアプリケーション** で作成し、承認済みリダイレクト URI に
   `http://localhost:3000/auth/google/callback`（公開 URL で使うなら `https://<URL>/auth/google/callback`）を登録
4. 発行されたクライアント ID とシークレットを `.env` の `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` に書き、`GOOGLE_REDIRECT_URI` を手順3と同じ URL にする
5. サーバーを再起動し、アプリの設定画面で「接続する」を押して Google にログイン

## カスタマイズ

- **性格・話し方**: `server/persona.ts` のシステムプロンプトを書き換えます
- **名前と呼び方**: `.env` の `HAYATO_NAME`、`HAYATO_USER_CALL_NAME`
- **声**: アプリの設定画面で端末の音声・速さ・高さを選べます（iPhone は「設定 → アクセシビリティ → 読み上げコンテンツ → 声」で高品質な日本語音声を追加すると自然になります）
- **考える深さ**: `.env` の `HAYATO_EFFORT`（low が最速。複雑な依頼が多いなら medium）
- **新しい仕事を覚えさせる**: `server/tools/` にツールを追加し、`server/agent.ts` の `localTools` に登録します

## しくみ

```
スマホ（PWA）                         サーバー（Node.js）                 Claude API
 マイク → 音声認識(ブラウザ内蔵) ──文字──▶ /api/chat ──────────────────▶ Claude
                                         │   ◀── ツール呼び出し ──────┤
                                         ├─ メモ/タスク (data/memory.json)
                                         ├─ Googleカレンダー
 読み上げ(ブラウザ内蔵) ◀──文字(逐次)──── │   （Web検索は Claude 側で実行）
```

- 返答はストリーミングで届き、一文ごとに読み上げを始めるので待ち時間が短く感じられます
- 会話履歴はサーバーのメモリ上にあり、サーバーを再起動するとリセットされます（メモとタスクは `data/` に残ります）

## ファイル構成

```
server/
  index.ts          Web サーバー、パスコード認証、Google ログイン
  agent.ts          Claude との会話とツール実行のループ
  persona.ts        ハヤトの人格（システムプロンプト）
  tools/memory.ts   メモ・タスク
  tools/calendar.ts Googleカレンダー
public/             スマホ画面（PWA）
```
