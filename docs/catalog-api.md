# カタログAPI v1

GitHub Pages上で、正準`data/works.json`から決定的に生成した機械可読データを配布します。

## エンドポイント

- `https://kafka2306.github.io/anime/api/v1/manifest.json`
- `https://kafka2306.github.io/anime/api/v1/works.json`
- `https://kafka2306.github.io/anime/api/v1/works.csv`
- `https://kafka2306.github.io/anime/api/v1/facets.json`

`manifest.json`には件数、生成元スキーマ版、各配布ファイルのバイト数とSHA-256を収録します。クライアントはSHA-256が前回値と同じ場合、再取り込みを省略できます。

## データ辞書

`works.json`は`canonical_id`順で安定ソートされます。主要フィールドは次のとおりです。

| フィールド | 意味 |
| --- | --- |
| `canonical_id` | `danime:<work_id>`形式の安定主キー |
| `work_id` | dアニメストア公開カタログの作品ID |
| `title` | 公式公開作品名 |
| `years` | 年別タグへの所属年。複数年の場合がある |
| `favorite_count` | 取得時点の気になる登録数 |
| `my_list_count` | 取得時点のマイリスト数 |
| `primary_genre` | 正規化した主ジャンル。根拠不足は保留値 |
| `canonical_tags` | 検索・集計用の正規タグ |
| `classification_status` | `classified`、`needs-review`等の品質状態 |
| `attribute_source_url` | 属性根拠の公式公開URL |
| `attribute_fetched_at` | 属性取得日時 |

`facets.json`は`year`、`primary_genre`、`source_origin`、`classification_status`、`tag`ごとに、件数と該当`canonical_id`を提供します。全件走査せずに絞り込み候補を構築できます。

## 取得例

```bash
curl -fsS https://kafka2306.github.io/anime/api/v1/manifest.json
curl -fsS https://kafka2306.github.io/anime/api/v1/works.json -o works.json
```

```python
import json
from urllib.request import urlopen

url = "https://kafka2306.github.io/anime/api/v1/works.json"
with urlopen(url, timeout=30) as response:
    payload = json.load(response)

sf = [work for work in payload["works"] if work.get("primary_genre") == "SF"]
print(len(sf))
```

## 更新・互換性

- API v1は正準データ更新時または配信コード変更時に再生成します。
- 同じ入力では同じJSON/CSVバイト列を生成します。
- v1内では既存フィールドを削除しません。破壊的変更は`/api/v2/`へ分離します。
- 欠損値は推測で補完せず、`null`または空配列のまま配布します。
- 配信状況や登録数は取得時点の公開情報であり、最新状態は公式サイトを確認してください。

## 出典・利用条件

出典、取得範囲、取得時刻は`data/manifest.json`およびAPIの`manifest.json`で追跡します。本リポジトリはdアニメストア公式ではありません。公式サイトの利用条件、著作権、商標権を優先し、再配布物はカタログメタデータに限定します。
