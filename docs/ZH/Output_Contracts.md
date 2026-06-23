# MDGraph 输出契约

本文记录 0.1 CLI 表面的稳定顶层 JSON 形状。除非另有说明，嵌套记录字段遵循 `src/types.ts` 中的公开 TypeScript 模型。

## `index --json`

`mdgraph index --json` 返回对象：

- `files`、`changed`、`deleted`、`unchanged`：索引计数。
- `mode`：`full` 或 `incremental`。
- `counts`：图计数，包含 `documents`、`sections`、`entities`、`sourceRefs`、`edges`、`chunks` 和 `vectors`。

## `status --json`

`mdgraph status --json` 直接返回图计数：

- `documents`、`sections`、`entities`、`sourceRefs`、`edges`、`chunks`、`vectors`。

如果索引不存在，则返回：

- `indexed: false`、`projectRoot`、`database`。

`mdgraph status --storage --json` 返回：

- `counts`：与 `status --json` 相同的图计数。
- `storage.database`：`pageSize`、`pageCount`、`freelistCount`、`estimatedBytes`、`journalMode` 和 `walCheckpoint`。
- `storage.objects`：`dbstatAvailable` 以及表、索引、FTS shadow 对象条目。
- `storage.pathGroups`：按顶层路径分组的文档和 chunk 内容贡献。
- `storage.edgeKinds`：按边类型统计的边数量和平均分值。
- `storage.highDegreeNodes`：非包含边度数最高的图节点。
- `storage.vectors`：向量总数以及 provider/model/dimensions 分布。

## `search --json`

`mdgraph search <query> --json` 返回搜索结果数组。每个结果包含：

- `document`：图文档记录。
- `section`：可选的图章节记录。
- `score`：数值排序分。
- `reason`：解释为什么命中。
- `content`：选中的 chunk 或章节内容。
- `matchedEntities`：参与命中的图实体记录。

## `context --json`

`mdgraph context <query> --json` 返回：

- `query`：原始查询文本。
- `maxChars`：配置的上下文预算。
- `usedChars`：已打包字符数。
- `items`：上下文条目，包含 `path`、`title`、可选 `heading`、可选 `lines`、`reason`、`matchedEntities` 和 `content`。

## `node --json`

`mdgraph node <query> --json` 在找到节点时返回：

- `id`、`label`、`kind`、`data`。

当章节查询有歧义时，返回：

- `error: "ambiguous_section"`、`query`、`candidates`。

当找不到节点时，返回：

- `error: "not_found"`、`query`。

## `trace --json`

`mdgraph trace <from> <to> --json` 返回：

- `from`、`to`、`found`、`steps`、可选 `message`。
- 每个 step 包含 `fromId`、`fromLabel`、`edgeFromId`、`edgeToId`、`edgeKind`、`toId`、`toLabel`、`traversalDirection`、`confidence` 和 `provenance`。

## `doctor --json`

`mdgraph doctor --json` 返回：

- `projectRoot`。
- `summary`：`documents`、`orphanDocs`、`deadLinks`、`staleSourceRefs`、`missingDefinitions`、`weaklyLinkedDocs`、`possibleContradictions`、`contentRisks` 和 `staleIndex`。
- `staleIndex`：`stale`、`recommendation` 和 `issues`。
- 问题数组：`orphanDocs`、`deadLinks`、`staleSourceRefs`、`missingDefinitions`、`weaklyLinkedDocs`、`possibleContradictions` 和 `contentRisks`。

`mdgraph doctor --strict` 保持相同输出形状。当 `summary` 中除 `documents` 外的任一问题计数大于零时，以非零状态退出。