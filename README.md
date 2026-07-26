# anime

`dアニメストア`の公開カタログを一次情報として、公式年別タグに属する作品、作品名、気になる登録数、監査可能な作品属性を取得・検証・公開するプロジェクトです。

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
- `attributes/by-work/<work_id>.json`: 公式作品詳細から作成した監査・再分類可能な属性キャッシュ

最新の件数は`data/manifest.json`を正とします。

## 属性オントロジー v2

属性は公式ジャンル、公式作品詳細の原作表記、あらすじから、決定論的なルールで付与します。作品名だけを根拠に原作種別や除外条件を推定しません。

### SFとファンタジーの分離

dアニメストアの公式ジャンル`SF/ファンタジー`は、出典メタデータ`official_genres`にはそのまま保存します。一方、検索・表示・推薦に使う正規属性では次の独立した葉分類へ分解します。

- `speculative_genres`: `SF`、`ファンタジー`の0〜2要素
- `primary_genre`: 主となる分類。`SF`、`ファンタジー`、`異世界・ハイファンタジー`、`クロスジャンル`など
- `canonical_tags`: `SF・ファンタジー`という複合タグは使用しない
- 根拠不足: `スペキュレーティブ判定保留`として明示し、推測で二択しない

SFは宇宙、人工知能、ロボット、未来、時間移動、電脳など、ファンタジーは魔法、異世界、王国、騎士、精霊、ドラゴンなどの明示的な語を独立に評価します。両方の根拠がある場合は両方の葉タグを保持します。

### ファセット

- `source_origin`: Web小説、漫画、ライトノベル・小説、ゲーム、ビジュアルノベル、オリジナル
- `ontology_facets.source`: 原作系統
- `ontology_facets.genre`: 主ジャンル、SF／ファンタジーの葉分類、公式ジャンルの正規化値
- `ontology_facets.subgenre`: 異世界ファンタジー、スペースオペラ、ロボットSF、サイバーパンク、時間SFなど
- `ontology_facets.setting`: 異世界、学園、宇宙、近未来、現代日本、歴史・時代劇、終末・ディストピア、職場、田舎・地方
- `ontology_facets.theme`: 友情・仲間、成長・挑戦、家族、恋愛、音楽・アイドル、料理・グルメ、推理・謎解き、政治・戦略、サバイバル、職業・仕事、復讐、戦争、旅・冒険など
- `ontology_facets.motif`: 魔法、ロボット・メカ、怪獣、怪異・妖怪、犯罪・警察、医療、ゲーム世界、時間移動、超能力、人工知能、電脳・VRなど
- `ontology_facets.format`: ショート、2.5次元舞台、ライブ・ラジオ・その他

各属性レコードには`attribute_confidence`、`classification_status`、`attribute_evidence`を保存し、使用したルール、公式ジャンル、検出語、公式URLを追跡可能にします。未知の属性は推測で埋めず、空配列または要確認状態として保持します。

## キャッシュ優先・低負荷ポリシー

属性キャッシュは単なる計算結果ではなく、再分類に必要な公式スナップショットを保存します。

- `official_snapshot.title`
- `official_snapshot.synopsis`
- `official_snapshot.staff_text`
- `official_snapshot.official_genres`
- `official_snapshot.production_year`
- `official_snapshot.sha256`
- `official_snapshot.source`

通常のタグ体系変更では`npm run attributes:rebuild-cache`を実行し、ローカルキャッシュだけから全属性を再計算します。この処理のdアニメストア向けネットワークリクエストは0件です。

`attributes:enrich`もキャッシュ優先です。

1. 完全スナップショットがあれば再利用して再分類
2. 旧形式キャッシュがあれば、既存の原作表記・タグ根拠・検出語を再利用
3. キャッシュが存在しない作品だけ公式詳細へアクセス
4. `DANIME_ENRICH_BACKFILL_RAW=1`を明示した場合のみ、旧形式キャッシュの原文スナップショットを一度だけ補完
5. ネットワーク要求数が予算を超えた場合は実行を中止

取得時は同時実行数を既定1、作品間隔を既定1.8秒とし、画像・動画・フォント・スタイルシートを取得しません。2025年の既存307作品は、一度だけ原文スナップショットを補完した後、以後のオントロジー更新ではキャッシュを再利用します。

## 表示・推薦

公開ページではカードごとに次を簡易表示します。

- 気になる登録数と年度内順位
- 原作系統、主ジャンル、正規タグ、オントロジーファセット
- 作品名またはタグによる検索
- タグクリックによる年度内ランキング

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
6. 公式作品詳細または既存キャッシュから原作表記、公式ジャンル、あらすじ、製作年を読み、属性オントロジーを生成します。
7. 安定項目から年別SHA-256を生成し、manifestと年別ファイルの一致を検証します。
8. 全年度の取得と検証が成功した場合だけ、ステージング領域を`data/`へ原子的に昇格します。

取得途中でHTTPエラー、JSON破損、ページング停止、件数不一致が発生した場合、既存の検証済み`data/`は保持されます。

## 防御策

- キャッシュ優先の再分類
- ネットワーク要求数の明示的な上限
- 低い同時実行数とリクエスト間隔
- 不要リソースの遮断
- 408、425、429、5xxに対する指数バックオフ付き再試行
- 応答の`resultCd`、`selfLink`、タグIDの一致確認
- ページ内`count`と`workList.length`の一致確認
- ページングが進まない場合の即時失敗
- 年タグの連続性確認
- 総所属件数の異常減少ガード
- 年内重複、空年度、タイトル欠損、公式カウンター欠損の検出
- 公式値から生成した`data/likes/YYYY.tsv`との一致検証
- 属性値、根拠URL、原文スナップショットハッシュの保存
- `SF・ファンタジー`複合正規タグの残存検査

## 差分監査

取得診断には、年度別の追加・削除作品ID、タイトル変更数、気になる登録数変更数を記録します。属性診断には、年度別のタグ付与率、SF件数、ファンタジー件数、クロスジャンル件数、要確認件数、完全スナップショット件数を記録します。

## ローカル実行

```bash
npm install
npx playwright install chromium
npm test
npm run attributes:rebuild-cache
npm run attributes:apply
npm run attributes:verify
npm run validate
```

特定年度だけ公式応答を診断する場合:

```bash
DANIME_YEAR=2025 npm run acquire
```

2025年の旧形式キャッシュだけ原文スナップショットを一度補完する場合:

```bash
DANIME_ENRICH_YEAR=2025 \
DANIME_ENRICH_BACKFILL_RAW=1 \
DANIME_ENRICH_CONCURRENCY=1 \
DANIME_ENRICH_RATE_LIMIT_MS=1800 \
DANIME_ENRICH_NETWORK_BUDGET=307 \
npm run attributes:enrich
```

明示的な強制再取得は通常運用では使用しません。

```bash
DANIME_ENRICH_YEAR=2025 DANIME_ENRICH_REFRESH=1 npm run attributes:enrich
```

主な環境変数:

```text
DANIME_RATE_LIMIT_MS=1200
DANIME_API_PAGE_SIZE=20
DANIME_MAX_RETRIES=5
DANIME_REQUEST_TIMEOUT_MS=45000
DANIME_MAX_TOTAL_DROP_RATIO=0.10
DANIME_ENRICH_CONCURRENCY=1
DANIME_ENRICH_RATE_LIMIT_MS=1800
DANIME_ENRICH_NETWORK_BUDGET=100
DANIME_ENRICH_BACKFILL_RAW=0
```

## CI更新

通常のカタログ更新は全検証に成功し、公式データに差分がある場合だけ更新をコミットします。オントロジーv2移行ワークフローは、全キャッシュをオフライン再分類し、2025年の原文スナップショットだけを一度補完してから、100%カバレッジとSF／ファンタジー分離を検証します。生成データだけのコミットでは移行ワークフローを再起動しません。

## 取得範囲

- 取得元は`https://animestore.docomo.ne.jp`の公開カタログ情報のみ
- ログイン、動画データ、ユーザー情報、レビューは取得しない
- 画像自体は複製せず、公式画像URLだけを保存する
- 配信状況や作品情報の最終確認は公式ページを参照する

## 一次情報

- 年別タグ選択: `https://animestore.docomo.ne.jp/animestore/tag_sel_pc`
- 公式作品一覧JSON: `https://animestore.docomo.ne.jp/animestore/rest/WS000106`
- dアニメストア利用規約: `https://animestore.docomo.ne.jp/animestore/CF/acceptable_use_policy_pc`
