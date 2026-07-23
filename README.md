# anime

`dアニメストア`の公開カタログを一次情報として、公式年別タグに属する作品、作品名、気になる登録数などを取得・検証・公開するプロジェクトです。

## 公開ページ

- [年別アニメ作品ブラウザ（GitHub Pages）](https://kafka2306.github.io/anime/)

## データの正

作品一覧と数値は、dアニメストアの公開JSONレスポンス`WS000106`を正とします。

- 年とタグID: 公式年別タグ選択ページの完全一致リンク
- 作品ID: `workList[].workId`
- 作品名: `workList[].workInfo.workTitle`
- 気になる登録数: `workList[].workInfo.favoriteCount`
- マイリスト数: `workList[].workInfo.myListCount`
- 公称作品数: `data.maxCount`

DOM上の画像alt、カード本文、掲載順から作品名や登録数を推定しません。Playwrightは年タグの発見と公式作品詳細の属性取得にのみ使用し、各年の作品取得は公式JSONを直接ページングします。

## 生成データ

- `data/source/year-tags.json`: 公式タグ選択ページから発見した年とタグID
- `data/by-year/YYYY.json`: 各年タグに属する全作品、公式カウンター、属性
- `data/works.json`: `work_id`を主キーとして統合した正規作品一覧
- `data/likes/YYYY.tsv`: 公式`favoriteCount`から生成した並び替え用データ
- `data/manifest.json`: 年数、作品数、取得元、完全性、各年の内容ハッシュ、属性スキーマ
- `attributes/by-work/<work_id>.json`: 公式作品詳細から作成した監査可能な属性キャッシュ

最新の件数は`data/manifest.json`を正とします。

## 属性オントロジー

属性は公式ジャンル、公式作品詳細の原作表記、あらすじから、決定論的なルールで付与します。作品名だけを根拠に原作種別や除外条件を推定しません。

- `source_origin`: Web小説、漫画、ライトノベル・小説、ゲーム
- `primary_genre`: 公式ジャンルを正規化した主ジャンル。公式ファンタジーと明示的な世界観語がそろう場合のみ`異世界・ハイファンタジー`
- `canonical_tags`: 公式ジャンルと下記ファセットを横断した表示・検索用タグ
- `ontology_facets.source`: 原作系統
- `ontology_facets.genre`: 主ジャンルと公式ジャンル
- `ontology_facets.setting`: 異世界、学園、宇宙、歴史・時代劇、終末・ディストピア
- `ontology_facets.theme`: 友情・仲間、成長・挑戦、家族、恋愛、音楽・アイドル、料理・グルメ、推理・謎解き、政治・戦略、サバイバル、職業・仕事
- `ontology_facets.motif`: 魔法、ロボット・メカ、怪異・妖怪、犯罪・警察、医療、ゲーム世界
- `ontology_facets.format`: ショート、2.5次元舞台、ライブ・ラジオ・その他

各属性レコードには`attribute_confidence`と`attribute_evidence`を保存し、使用したルール、公式ジャンル、検出語、公式URLを追跡可能にします。未知の属性は推測で埋めず、`null`または空配列のまま保持します。

## 表示・推薦

公開ページではカードごとに次を簡易表示します。

- 気になる登録数と年度内順位
- 原作系統、主ジャンル、正規タグ、オントロジーファセットから最大5タグ
- 作品名またはタグによる検索

`HOT RECOMMEND`は、現在表示している年度の作品に対して、気になる登録数とブラウザ内のクリック履歴を組み合わせて順位付けします。クリック履歴は`localStorage`の`kafka2306-anime-click-history-v1`へ最大100作品分保存し、サーバーや外部サービスへ送信しません。画面上から履歴をリセットできます。

嗜好除外は次のいずれかに一致した作品へ適用します。

- 原作: `Web小説（なろう・カクヨム系）`
- 主ジャンル: `異世界・ハイファンタジー`
- 正規タグ: `バトル・アクション`

## 取得フロー

1. 公式タグ選択ページから、表示が`YYYY年`と完全一致するリンクだけを抽出します。
2. 各タグについて公式`/animestore/rest/WS000106`を一定間隔で順次取得します。
3. `data.maxCount`に達するまで固定ページサイズでページングします。
4. 作品ID、作品名、気になる登録数、マイリスト数、画像URLなどを厳格に検証します。
5. 年内の一意な作品ID数を公式`maxCount`と照合します。
6. 公式作品詳細から原作表記、公式ジャンル、あらすじ、製作年を取得し、属性オントロジーを生成します。
7. 安定項目から年別SHA-256を生成し、manifestと年別ファイルの一致を検証します。
8. 全年度の取得と検証が成功した場合だけ、ステージング領域を`data/`へ原子的に昇格します。

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
- 属性値と根拠URLの同時保存

## 差分監査

取得診断には、年度別の追加・削除作品ID、タイトル変更数、気になる登録数変更数を記録します。診断ファイルはGitHub Actions artifactとして保持し、通常はリポジトリへコミットしません。

## ローカル実行

```bash
npm install
npx playwright install chromium
npm test
npm run acquire
npm run attributes:enrich
npm run validate
```

特定年度だけ公式応答を診断する場合:

```bash
DANIME_YEAR=2024 npm run acquire
```

特定年度の属性を再取得する場合:

```bash
DANIME_ENRICH_YEAR=2024 DANIME_ENRICH_REFRESH=1 npm run attributes:enrich
```

単年度診断は`diagnostics/single-year/2024.json`を生成し、完全な`data/`スナップショットは変更しません。

主な環境変数:

```text
DANIME_RATE_LIMIT_MS=1200
DANIME_API_PAGE_SIZE=20
DANIME_MAX_RETRIES=5
DANIME_REQUEST_TIMEOUT_MS=45000
DANIME_MAX_TOTAL_DROP_RATIO=0.10
DANIME_ENRICH_CONCURRENCY=2
DANIME_ENRICH_RATE_LIMIT_MS=900
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
