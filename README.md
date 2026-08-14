# anime — dアニメストア公開情報の年別ブラウザ

**「SF/ファンタジー」と公式に一括りにされていても、探すときまで同じ属性にする必要はない。**

`anime` は、dアニメストアの公開カタログを保存しながら、**公式が公開した値と、検索のために追加した分類を分けたまま年別に作品を探せるブラウザ**です。

- 公開サイト: https://kafka2306.github.io/anime/

## Vision

アニメ探しを「大きな公式カテゴリから一覧を眺める」体験から、**原作・ジャンル・設定・テーマ・モチーフを横断して、自分が見たい作品へ理由付きで辿れる探索**へ変えます。

同時に、検索しやすくするための分類が、公式の事実へすり替わらないことを重視します。

## Design philosophy

- **Official observation and derived facet stay separate.** dアニメストアの値と独自分類を同じ属性として保存しない。
- **Title is not evidence.** 作品名だけからSF、異世界、AI等を推測しない。
- **Empty is better than invented.** 根拠不足のfacetは空配列 / review-requiredとして残す。
- **Snapshot before reclassification.** 保存済み公式snapshotを基準に、分類ruleだけをnetworkなしで再実行できる。
- **Acquisition is fail-close.** HTTP error、JSON破損、paging停止、件数不一致で既存verified dataを上書きしない。
- **Recommendation stays local.** click historyはbrowser `localStorage`だけに置き、外部へ送らない。
- **Source load stays bounded.** cache優先・request budget・backoffで取得元へ不要な負荷をかけない。

## Why / 差別化

一般的なanime catalogでは、「公式genre」と「サイト独自tag」が同じfilterに見えることがあります。本repoは、**作品を探しやすくする解釈を追加しながら、それが公式情報ではないことを機械的に追跡できる**点を中心にします。

特に公式値 `SF/ファンタジー` はsource observationとして保持し、検索facetではSFとファンタジーを独立に扱います。検索性のために公式情報を書き換えません。

## User journey

```text
年度を選ぶ
  → title / facetで絞る
  → official observationとderived facetを読む
  → 気になる登録数等を同年度内で比較
  → 必要ならsource/provenanceを確認
  → 視聴先の最新情報は公式siteで確認
```

## What you can do

- 年別作品一覧
- title / tag search
- 気になる登録数による年度内ranking
- 原作系統 / genre / setting / theme / motif表示
- SFとfantasyを独立facetとして探索
- local click historyを使う簡易recommendation
- source / classification rationale / confidence / hash audit

## Canonical source

作品一覧と公式counterは、dアニメストアの公開JSON response `WS000106` を基準にします。

- year / tag ID — official year-tag pageのexact link
- work ID — `workList[].workId`
- title — `workList[].workInfo.workTitle`
- favorite count — `workList[].workInfo.favoriteCount`
- my list count — `workList[].workInfo.myListCount`
- advertised count — `data.maxCount`

DOMの表示順・image alt・card textから公式counterを推定しません。

## Canonical data

| path | role |
|---|---|
| `data/source/year-tags.json` | official year/tag mapping |
| `data/by-year/YYYY.json` | yearly official observations |
| `data/works.json` | Work ID based merged catalog |
| `data/likes/YYYY.tsv` | favorite-count ordering |
| `data/manifest.json` | count / source / completeness / content hash |
| `attributes/by-work/<work_id>.json` | official snapshot + derived facets |

最新件数は`data/manifest.json`を正とします。

## Facet model

原作系統例:

- Web小説
- 漫画
- ライトノベル・小説
- ゲーム
- ビジュアルノベル
- オリジナル

主なfacet:

- `genre`
- `subgenre`
- `setting`
- `theme`
- `motif`
- `format`

公式genreとderived facetは別layerです。

Machine-readable contract: [`ontology/project.yaml`](ontology/project.yaml)

## Recommendation / preference boundary

`HOT RECOMMEND`は現在年度のfavorite countと同browserのclick historyを組み合わせます。履歴は`localStorage`のみです。

現行の嗜好除外例:

- source: `Web小説（なろう・カクヨム系）`
- primary genre: `異世界・ハイファンタジー`
- normalized tag: `バトル・アクション`

これは公式な作品評価ではなく、個人向けfiltering ruleです。

## Acquisition flow

```text
official year tags
  → public JSON paging
  → count / ID / value verification
  → official detail or verified cache
  → derived attributes
  → SHA-256 / manifest validation
  → atomic data update
  → Pages
```

途中failure時はverified dataを保持します。

## Low-load collection

- official snapshot cache優先
- classification-only changeではnetwork不要
- bounded concurrency / request interval
- image / video / font / CSS等の不要fetchを遮断
- 408 / 425 / 429 / 5xxをbackoff retry
- request budget超過時は停止

取得元のterms / rightsを優先します。

## Local verification

```bash
npm install
npx playwright install chromium
npm test
npm run attributes:rebuild-cache
npm run attributes:apply
npm run attributes:verify
npm run validate
```

Specific year diagnostic:

```bash
DANIME_YEAR=2025 npm run acquire
```

## Done

成功指標は分類tag数や収録作品数ではありません。

**利用者が作品を細かく探せる一方で、「これは公式が公開した値」「これは検索のための派生分類」と区別して判断できること**をDoneとします。

## Notice

本projectはdアニメストア公式によるものではありません。掲載情報は取得時点の公開情報です。最新の配信状況・公式分類は公式siteを確認してください。
