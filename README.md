# TeX Sauce Maker

数式画像からTeX Sauce形式のコードブロックや解説を生成するWebアプリケーションです。

## バージョン履歴

### v1.7.6
- Obsidianエクスポート時の `difficulty` 判定で、生成済みの解答・解説内容も参照するように変更。

### v1.7.5
- Obsidianエクスポート時に `terms` / `methods` / `fields` を分類別プロパティとして出力。
- 従来通り `tags` には全タグをまとめて出力。

### v1.7.4
- Obsidianエクスポート時の `difficulty` 判定で、生成したタグも参照するように変更。
- タグ内容に応じて難易度を1〜5の範囲で補正する処理を追加。

### v1.7.3
- Obsidianエクスポート時に重複していたファイル名見出しを削除。
- Obsidianエクスポートのセクション構成を整理。

### v1.7.2
- Obsidianエクスポート時の `unit` プロパティを空欄（手動設定用）に変更。

### v1.7.1
- Obsidianエクスポート時のファイル名を任意に設定できる機能を追加。
- Obsidianプロパティ表示のためのMarkdownフォーマット修正。

### v1.7.0
- Obsidian用 .md エクスポート機能を追加。
- メタデータ解析に `gemini-3-flash-preview` を採用。
- Chrome/Edge での「名前を付けて保存」ダイアログに対応。

### v1.6.3
- 利用可能な生成AIモデルに `gemini-3-flash-preview` を追加。
