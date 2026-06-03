# あいうえバトル オンライン (Firebase版)

オンラインで友達同士と遊べる「あいうえバトル」のウェブアプリケーションです。
サーバーレス構成のため、特別なバックエンドサーバーの構築・維持費をかけることなく、ブラウザだけでリアルタイム対戦が行えます。

---

## 🎮 特徴と最新アップデート

1. **ダブルクリックで即プレイ可能！**
   Firebase のクラシックSDKを採用したため、**フォルダ内の `index.html` をダブルクリックするだけで直接起動して遊べます！**（簡易サーバーの起動は不要です）
2. **切断時の自動・手動再接続機能**
   プレイ中に通信が途切れたり、ブラウザを誤って閉じてしまっても、**「同じ合言葉」と「同じ名前」を入力して入り直すことで、自動的に元のプレイヤーIDとゲーム状態を引き継いで復帰**できます。（セットアップ中やバトル中の復活に対応しています）

---

## ファイル構成
- `index.html`: ゲームのメイン画面（UI）
- `style.css`: ポップな neobrutalism 調のゲームデザイン
- `game.js`: 文字の正規化、画面の遷移、Web Audio APIによる効果音の合成・再生などのゲーム進行制御
- `firebase-db.js`: Firebase Realtime Database を使用したリアルタイム同期・再接続処理
- `config.js`: あなたの Firebase プロジェクト設定情報

---

## 1. 動作確認方法

### 方法A: フォルダ内のファイルを直接開く (一番簡単！)
1. フォルダ内の `index.html` をダブルクリックしてブラウザで開きます。
2. そのままゲームをプレイできます！

### 方法B: 簡易Webサーバーを起動する
開発者向けに、以下のコマンドで起動することも可能です。
```bash
# http-serverを起動
npx http-server
```
起動後、表示されるアドレス（例：`http://localhost:8080`）をブラウザで開きます。

---

## 2. Firebase データベースのルール設定

ゲームを友達とプレイするために、Firebase の管理コンソールで **Realtime Database** のセキュリティルールを設定する必要があります。
初期のテストや友達とのプレイ用には、以下の「テストモード（誰でも読み書き可能）」に設定してください。

### ルールの書き換え手順:
1. [Firebase Console](https://console.firebase.google.com/) にアクセスします。
2. 作成したプロジェクトを開き、左メニューから **「構築」 > 「Realtime Database」** を選択します。
3. 上部の **「ルール」** タブをクリックします。
4. ルールを以下のように書き換えて **「公開」** ボタンを押します。

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

---

## 3. GitHub に公開して遊ぶ方法

ゲームが完成したら、GitHub にアップロードして **GitHub Pages** 機能を使うことで、インターネット上に無料で公開して友達と遊ぶことができます。

### 手順:
1. GitHub で新しいリポジトリ（例: `aiue-battle`）を作成します。
2. ローカルディレクトリで以下のコマンドを実行し、ファイルをアップロードします：
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin <あなたのリポジトリURL>
   git push -u origin main
   ```
3. GitHub のリポジトリページを開き、**「Settings（設定）」 > 「Pages」** に移動します。
4. **Build and deployment** の Source で **「Deploy from a branch」** を選択し、Branch を **「main / (root)」** に設定して **「Save」** を押します。
5. 数分後、公開用URL（例: `https://<ユーザー名>.github.io/aiue-battle/`）が表示されます。そのURLを友達に共有して遊べます！
