# 全年度の属性タグ付け

## 目的

2024年だけに存在していた公式作品詳細キャッシュを、`data/works.json`に含まれる全作品へ拡張する。
作品名だけから属性を推測せず、dアニメストアの公開作品詳細で確認できた公式ジャンル、原作表記、あらすじを根拠にする。

## 初回バックフィル

`.github/workflows/attributes-all-years.yml`は全作品を`work_id`の安定ハッシュで16シャードへ分割する。
各シャードは公式作品詳細を取得して属性レコードを生成し、次の条件を満たすレコードだけをartifactへ出力する。

- 公式dアニメストアURLを保持する
- 公式ジャンルが1件以上ある
- 主ジャンルが決定されている
- 正規タグが1件以上ある
- 6ファセットのオントロジー配列を保持する

16シャードがすべて成功した場合だけ統合ジョブを実行する。統合ジョブは既存キャッシュを全置換し、全年データへ属性を適用してから100%カバレッジを検証する。1作品でも取得不能・不整合・欠損があればmainへコミットしない。

## 継続更新

週次の`Acquire dAnime year catalogue`は新しい公式カタログを取得した後、属性キャッシュに存在しない作品を公式詳細から追加する。カタログ検証と属性カバレッジ検証の両方が成功した場合だけ、`data/`と`attributes/`を更新する。

## 公開証跡

- `data/manifest.json`の`attributes.coverage_ratio`
- `data/manifest.json`の`attributes.by_year`
- 各`data/by-year/YYYY.json`の`attribute_coverage`
- `diagnostics/attribute-coverage.json`

`source_origin`は公式原作表記から分類できない場合に`null`のまま残す。未知を推測で補完することは、100%タグ付けとは区別する。
