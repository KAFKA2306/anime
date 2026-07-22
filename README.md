# anime

`dアニメストア` の公式な年別タグページを一次情報として、各年の作品一覧を正規化・検証・更新するプロジェクトです。

## 現在のフェーズ

まず、全年度の公式データ取得基盤を実装します。UI、嗜好フィルター、グラフ、GitHub Pages は取得データの完全性を確認した後に追加します。

## 生成データ

- `data/source/year-tags.json`: 公式タグ選択ページから発見した年とタグID
- `data/by-year/YYYY.json`: 各年タグに属する全作品
- `data/works.json`: `work_id` を主キーとして統合した正規作品一覧
- `data/manifest.json`: 年数、作品数、取得元、整合性情報

必須項目は `work_id`、作品名、年、公式作品URL、公式年タグIDです。画像は複製せず、公式ページ上のURLのみ記録します。

## 取得方針

- 取得元は `https://animestore.docomo.ne.jp` の公開カタログページのみ
- ログイン、動画、ユーザー情報、レビューは取得しない
- PlaywrightでJavaScript描画と追加読込を完了させる
- 公式ページ内のページングとJSONレスポンスを併用する
- 年内重複、空年度、タイトル欠損、正規テーブルとの不一致をCIで失敗させる
- GitHub Actionsの定期実行では差分がある場合だけデータを更新する

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
- 2024年タグ: https://animestore.docomo.ne.jp/animestore/tag_pc?tagId=T0021150
- dアニメストア利用規約: https://animestore.docomo.ne.jp/animestore/CF/acceptable_use_policy_pc
