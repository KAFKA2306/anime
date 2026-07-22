# anime

`dアニメストア`の公開カタログを一次情報として、公式年別タグに属する作品、作品名、気になる登録数などを取得・検証・公開するプロジェクトです。

## データの正

作品一覧と数値は、dアニメストアの公開JSONレスポンス`WS000106`を正とします。

- 年とタグID: 公式年別タグ選択ページの完全一致リンク
- 作品ID: `workList[].workId`
- 作品名: `workList[].workInfo.workTitle`
- 気になる登録数: `workList[].workInfo.favoriteCount`
- マイリスト数: `workList[].workInfo.myListCount`
- 公称作品数: `data.maxCount`

DOM上の画像alt、カード本文、掲載順から作品名や登録数を推定しません。Playwrightは年タグの発見にのみ使用し、各年の作品取得は公式JSONを直接ページングします。

## 生成データ

- `data/source/year-tags.json`: 公式タグ選択ページから発見した年とタグID
- `data/by-year/YYYY.json`: 各年タグに属する全作品と公式カウンター
- `data/works.json`: `work_id`を主キーとして統合した正規作品一覧
- `data/likes/YYYY.tsv`: 公式`favoriteCount`から生成した並び替え用データ
- `data/manifest.json`: 年数、作品数、取得元、完全性、各年の内容ハッシュ

最新の件数は`data/manifest.json`を正とします。

## 取得フロー

1. 公式タグ選択ページから、表示が`YYYY年`と完全一致するリンクだけを抽出します。
2. 各タグについて公式`/animestore/rest/WS000106`を一定間隔で順次取得します。
3. `data.maxCount`に達するまで固定ページサイズでページングします。
4. 作品ID、作品名、気になる登録数、マイリスト数、画像URLなどを厳格に検証します。
5. 年内の一意な作品ID数を公式`maxCount`と照合します。
6. 安定項目から年別SHA-256を生成し、manifestと年別ファイルの一致を検証します。
7. 全年度の取得と検証が成功した場合だけ、ステージング領域を`data/`へ原子的に昇格します。

取得途中でHTTPエラー、JSON破損、ページング停止、件数不一致が発生した場合、既存の検証済み`data/`は保持されます。

## 防御策

- リクエスト間隔の制御
- 408、425、429、5xxに対する指数バックオフ付き再試行
- 応答の`resultCd`、`selfLink`、タグIDの一致確認
- ページ内`count`と`workList.length`の一致確認
- ページングが進まない場合の即時失敗
- 年タグの連続性確認
- 総所属件数の異常減少ガード
- 年内重複、空年度、タイトル欠損、公式カウンター欠損の検出
- 公式値から生成した`data/likes/YYYY.tsv`との一致検証

## 差分監査

取得診断には、年度別の追加・削除作品ID、タイトル変更数、気になる登録数変更数を記録します。診断ファイルはGitHub Actions artifactとして保持し、通常はリポジトリへコミットしません。

## ローカル実行

```bash
npm install
npx playwright install chromium
npm test
npm run acquire
npm run validate
```

特定年度だけ公式応答を診断する場合:

```bash
DANIME_YEAR=2024 npm run acquire
```

単年度診断は`diagnostics/single-year/2024.json`を生成し、完全な`data/`スナップショットは変更しません。

主な環境変数:

```text
DANIME_RATE_LIMIT_MS=1200
DANIME_API_PAGE_SIZE=20
DANIME_MAX_RETRIES=5
DANIME_REQUEST_TIMEOUT_MS=45000
DANIME_MAX_TOTAL_DROP_RATIO=0.10
```

## CI更新

GitHub Actionsは毎週および手動実行時に全年度を再取得します。全検証に成功し、公式データに差分がある場合だけ`main`へ更新をコミットします。公開ページは生成済みJSONと公式由来のTSVのみを読み込みます。

## 取得範囲

- 取得元は`https://animestore.docomo.ne.jp`の公開カタログ情報のみ
- ログイン、動画データ、ユーザー情報、レビューは取得しない
- 画像自体は複製せず、公式画像URLだけを保存する
- 配信状況や作品情報の最終確認は公式ページを参照する

## 一次情報

- 年別タグ選択: `https://animestore.docomo.ne.jp/animestore/tag_sel_pc`
- 公式作品一覧JSON: `https://animestore.docomo.ne.jp/animestore/rest/WS000106`
- dアニメストア利用規約: `https://animestore.docomo.ne.jp/animestore/CF/acceptable_use_policy_pc`
