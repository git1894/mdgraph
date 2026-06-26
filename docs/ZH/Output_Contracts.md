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
- `storage.vectors`：向量总数、紧凑存储 `format` 以及 provider/model/dimensions 分布。

## `search --json`

`mdgraph search <query> --json` 返回搜索结果数组。每个结果包含：

- `document`：图文档记录。
- `section`：可选的图章节记录。
- `score`：数值排序分。
- `reason`：解释为什么命中。
- `content`：选中的 chunk 或章节内容。
- `matchedEntities`：参与命中的图实体记录。
- `semantic`：可选语义命中 metadata，包含 `source`、`provider`、`model` 和 `confidence`。

`mdgraph search <query> --explain --json` 返回：

- `query`、`limit`、`queryMode`、`entityCandidates`、`ftsQuery`、`semanticEnabled` 和 `semanticActive`。
- `ranking`：`fusion`、`fusionK`、`channels` 和 `optionalReranker`。
- `matchedEntities`：排序诊断使用的实体名称、类型和文档频次。
- `results`：与 `search --json` 相同的搜索结果记录。

## `context --json`

`mdgraph context <query> --json` 返回：

- `query`：原始查询文本。
- `maxChars`：配置的上下文预算。
- `usedChars`：已打包字符数。
- `items`：上下文条目，包含 `path`、`title`、可选 `heading`、可选 `lines`、`reason`、`matchedEntities` 和 `content`。

`mdgraph context <query> --debug --json` 保持相同字段，并增加 `debug`：

- `seedNodes`、`visitedNodes` 和 `expandedEdges`。
- `skippedVisitedNodes`、`skippedByNodeLimit` 和 `skippedByDepth`。
- `candidateCount`、`directCandidates` 和 `expandedCandidates`。
- `packingStrategy`、`packedItems`、`packedUniqueDocuments` 和 `packingDiversityRatio`。
- `budgetTruncatedItems` 和 `budgetSkippedItems`。

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

## `eval --json`

`mdgraph eval --json` 对已索引项目运行内置检索评估，并返回：

- `querySet`：默认是 `alpha`；传入 `--query-set ecc` 时为 `ecc`；传入 `--query-set cjk` 时为 `cjk`。
- `limit`：每个 case 使用的搜索结果上限。
- `ranking`：query mode、RRF 搜索融合、上下文打包策略、可选 reranker 状态、semantic-active case 数量、搜索通道、ranking reason 覆盖率和平均上下文多样性。
- `generatedAt`：评估运行时间。
- `summary`：`cases`、`passed`、`failed`、`averageTopKDocumentRecall`、`averageExpectedSectionRecall`、`averageContextPrecision`、`averageContextDiversity`、`averageLatencyMs` 和 `averageReturnedChars`。
- `cases`：每个 case 的 `id`、`query`、`passed`、`expected`、`observed` 和 `metrics`。

每个 case 的 `expected` 包含预期文档、章节、实体、边类型和 source refs。`observed` 包含排序后的搜索文档路径、上下文条目路径/标题/reason、匹配实体、已解析实体、已解析 source refs、观测到的边类型、可选 trace 结果和排序诊断。`metrics` 包含 top-K 文档召回、预期章节召回、上下文精度、实体召回、source-ref 召回、边类型覆盖、trace 成功率、延迟、返回字符数、预算适配、fanout、reason 覆盖率、ranking reason 覆盖率和上下文多样性。

`--query-set ecc` 使用 ECC 风格 path-only 期望记录；`--query-set cjk` 使用中文/日文期望记录，用于度量轻量 CJK n-gram 预处理基线下的检索质量。`--query-mode semantic` 请求可选语义搜索，并报告本地语义 reranker 是否实际生效。`mdgraph eval` 不会自动索引目标项目，运行前需先执行 `mdgraph index`。

## `semantic status --json`

`mdgraph semantic status --json` 返回：

- `projectRoot`。
- `state`：`disabled`、`not_indexed`、`ready`、`unsupported_provider` 或 `needs_reindex`。
- `enabled`、`provider`、`model`、`dimensions` 和 `providerSupported`：当前配置的 embedding provider 状态。
- `indexed`、`chunks`、`vectors`、`vectorStorageFormat` 和 `indexedProviders`。
- `guidance`：可行动的下一步，例如运行 `mdgraph index --semantic`、provider 变化后重新 embedding，或 unsupported provider 降级到 FTS5 和 graph search。

## `doctor --json`

`mdgraph doctor --json` 返回：

- `projectRoot`。
- `summary`：`documents`、`orphanDocs`、`deadLinks`、`staleSourceRefs`、`missingDefinitions`、`weaklyLinkedDocs`、`possibleContradictions`、`contentRisks` 和 `staleIndex`。
- `staleIndex`：`stale`、`recommendation` 和 `issues`。
- 问题数组：`orphanDocs`、`deadLinks`、`staleSourceRefs`、`missingDefinitions`、`weaklyLinkedDocs`、`possibleContradictions` 和 `contentRisks`。

`mdgraph doctor --strict` 保持相同输出形状。当 `summary` 中除 `documents` 外的任一问题计数大于零时，以非零状态退出。
