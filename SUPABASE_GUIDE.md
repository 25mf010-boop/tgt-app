# Supabaseクラウドデータベース 導入・セットアップ詳細マニュアル

被験者がスマートフォンから記録を入力し、研究者側でリアルタイムにデータを一元管理・CSVダウンロードするための完全無料（Free Plan）クラウドデータベース構築手順です。

---

## 💻 準備するもの
- インターネットに接続されたパソコン
- メールアドレス（またはGitHubアカウント）

---

## 🛠️ セットアップ手順（全6ステップ）

### 【ステップ 1】 Supabaseのアカウント作成（無料会員登録）

1. **公式サイトへアクセス**
   ブラウザで [https://supabase.com](https://supabase.com) を開きます。
2. **会員登録**
   画面右上の **「Start your project」** または **「Sign Up」** ボタンをクリックします。
   * **GitHubアカウント**をお持ちの場合は「Continue with GitHub」が最もスムーズです。
   * メールアドレスで登録した場合は、届いた確認メール（「Confirm Your Signup」）内のリンクをクリックしてください。

---

### 【ステップ 2】 新規プロジェクトの作成

1. ダッシュボード画面の **「New Project」** ボタンをクリックします。
2. 以下の設定情報を入力します：
   - **Organization**: デフォルトのままで構いません。
   - **Name**: 任意のプロジェクト名（例: `tgt-research`）
   - **Database Password**: 強固なパスワードを自身で作成し、**必ず手元にメモ**しておいてください。
   - **Region**: **`Tokyo (ap-northeast-1)`** を選択します。
   - **Pricing Plan**: **`Free`** ($0/month) を選択します。
3. **「Create new project」** をクリックします。
   - *※データベースの起動準備完了まで **2〜3分** かかります。*

---

### 【ステップ 3】 データベーステーブルの作成（SQLの実行）

1. 準備完了後、左側のメニューにある **「SQL Editor」**（ `>_` アイコン）をクリックします。
2. **「New query」** をクリックしてエディタを開き、以下のSQLコードをすべてコピー＆ペーストします。

```sql
-- 1. 被験者アカウントテーブル
create table users (
  id text primary key,
  password text not null,
  signup_date date not null default current_date
);

-- 2. TGT記録テーブル
create table records (
  id uuid default gen_random_uuid() primary key,
  user_id text references users(id) on delete cascade,
  date date not null,
  timestamp bigint not null,
  tgt1 text not null,
  tgt2 text,
  tgt3 text,
  memo text,
  mood integer not null,
  unique (user_id, date) -- 同じ被験者が同じ日に複数保存した場合は自動上書き
);
```

3. 右下の緑色の **「Run」**（▶ボタン）をクリックします。
   - *※ 画面に警告ダイアログ（Potential issue detected...）が表示された場合は、**`Run without RLS`** を選択してください。*
4. 下部に `Success. No rows returned` と表示されれば完了です。
   - *(確認: 左メニュー「Table Editor」に `users` と `records` テーブルが表示されます)*

---

### 【ステップ 4】 接続キーの取得

1. 左メニュー一番下の **「Project Settings」**（歯車マーク ⚙️）をクリックします。
2. メニュー内の **「API Keys」**（または Data API）をクリックします。
3. 表示される以下の2つの値をコピーします：
   - **Project URL**: `https://xxxxxxxxxxxxxxxxxxxx.supabase.co`
   - **Publishable key**（旧 `anon / public` キー）: `sb_publishable_xxxx...`
     - *※ `Secret key` という別の鍵は絶対に公開・使用しないでください。*

---

### 【ステップ 5】 アプリコードへの貼り付け（接続完了）

1. プロジェクト内の `src/main.js` ファイルを開きます。
2. 8行目・9行目付近にあるダブルクォーテーションの間に、コピーした値を貼り付けて保存（`Ctrl+S`）します。

```javascript
// [src/main.js の対象箇所]
const SUPABASE_URL = "ここにコピーしたProject URLを貼り付ける";
const SUPABASE_KEY = "ここにコピーしたanon/publicキーを貼り付ける";
```

*※保存されると、アプリは自動的に「クラウドデータベース接続モード」へ切り替わります。*

---

### 【ステップ 6】 アプリのWeb公開（Vercelを使用する場合）

作成した静的アプリを被験者がスマホからアクセスできるようにWeb上に無料公開します。

1. **GitHub**に本プロジェクトコードをリポジトリとして作成・アップロードします。
2. **Vercel**（ [https://vercel.com](https://vercel.com) ）に無料登録し、GitHubリポジトリを連携します。
3. 設定はそのままで **「Deploy」** をクリックすると、数秒で `https://xxx.vercel.app` のような公開用URLが発行されます。
4. 被験者にはこの公開URLを案内してください。
