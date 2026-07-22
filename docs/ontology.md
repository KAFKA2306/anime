# Attribute ontology and assignment policy

Attribute values are assigned from the public dアニメストア work detail page. The pipeline stores the official source URL, rule identifier, matched terms, and confidence with every record.

## Fields

- `source_origin`: 原作ルーツ
- `primary_genre`: 主ジャンル
- `canonical_tags`: 正規タグ
- `official_genres`: dアニメストアの公式ジャンル
- `attribute_evidence`: 判定規則・一致語・根拠URL
- `attribute_confidence`: `verified` / `derived` / `unknown`

## Deterministic rules

### 原作ルーツ

The official staff credit is examined in the following order.

1. An explicit web platform name such as `小説家になろう` or `カクヨム` assigns `Web小説（なろう・カクヨム系）`.
2. Explicit game terminology assigns `ゲーム`.
3. Manga publication terminology such as `コミックス` assigns `漫画`.
4. Novel publication terminology such as `文庫` or `ノベル` assigns `ライトノベル・小説`.
5. No reliable signal leaves the value `null`. The pipeline does not guess from the title.

### 主ジャンル

1. Preserve the order of genres shown on the official detail page.
2. Normally normalize the first official genre as the primary genre.
3. Assign `異世界・ハイファンタジー` only when the official genres include `SF/ファンタジー` and the title or official synopsis contains an explicit world-setting signal such as `異世界`, `転生`, `召喚`, `勇者`, `魔王`, `冒険者`, `ダンジョン`, or `魔法`.

### 正規タグ

Every official genre is normalized mechanically. For example, official `アクション/バトル` becomes `バトル・アクション`. When the high-fantasy rule is satisfied, `異世界・ハイファンタジー` is also added.

## Preference exclusion

The Pages filter excludes a work when any exact value matches:

- `source_origin = Web小説（なろう・カクヨム系）`
- `primary_genre = 異世界・ハイファンタジー`
- `canonical_tags` contains `バトル・アクション`

Unknown values are retained and are not excluded.
