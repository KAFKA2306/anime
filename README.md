# anime

`dアニメストア` の公式な年別タグページを一次情報として、各年の作品一覧を正規化・検証・更新するプロジェクトです。

## 現在のフェーズ

全年度の公式データ取得基盤、初回スナップショット、GitHub Pages用の作品ブラウザを作成済みです。嗜好除外は、原作ルーツ・主ジャンル・正規タグの正確な属性データを追加した後に有効化します。作品名からの推測分類は行いません。

## 初回取得結果

2026年7月22日のライブ取得・検証結果:

- 公式の完全一致年タグ: 66年度（1945年、1962年〜2026年）
- 正規作品数: 7,539件
- 年度所属レコード数: 7,541件
- 空年度: 0
- 年内の作品ID重複: 0
- タイトル欠損: 0
- 公式RESTの公称件数との不一致: 0
- 公式JSON以外を作品名の正として採用した件数: 0

最新値は `data/manifest.json` を正とします。

## 生成データ

- `data/source/year-tags.json`: 公式タグ選択ページから発見した年とタグID
- `data/by-year/YYYY.json`: 各年タグに属する全作品
- `data/works.json`: `work_id` を主キーとして統合した正規作品一覧
- `data/manifest.json`: 年数、作品数、取得元、整合性情報

必須項目は `work_id`、作品名、年、公式作品URL、公式年タグIDです。作品名は公式RESTレスポンスの `workInfo.workTitle` を正とし、各年の一意な作品ID件数を公式 `maxCount` と照合します。画像は複製せず、公式ページ上のURLのみ記録します。

## 取得方針

- 取得元は `https://animestore.docomo.ne.jp` の公開カタログページのみ
- ログイン、動画、ユーザー情報、レビューは取得しない
- PlaywrightでJavaScript描画と追加読込を完了させる
- 公式ページ内のページングと公式JSONレスポンスを併用する
- 年内重複、空年度、タイトル欠損、公式公称件数との不一致、正規テーブルとの不一致をCIで失敗させる
- GitHub Actionsで毎週、検証済みスナップショットを更新する

## ローカル実行

```bash
npm install
npx playwright install chromium
npm test
npm run acquire
npm run validate
```

特定年度だけ検証する場合:

```bash
DANIME_YEAR=2024 npm run acquire
```

## 一次情報

- 年別タグ選択: https://animestore.docomo.ne.jp/animestore/tag_sel_pc
- 2024年タグ: https://animestore.docomo.ne.jp/animestore/tag_pc?tagId=T0019675
- 2025年タグ: https://animestore.docomo.ne.jp/animestore/tag_pc?tagId=T0021150
- dアニメストア利用規約: https://animestore.docomo.ne.jp/animestore/CF/acceptable_use_policy_pc
