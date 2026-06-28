# MDGraph 输出契约

本文记录当前 CLI 表面的稳定顶层 JSON 形状。除非另有说明，嵌套记录字段遵循 `src/types.ts` 中的公开 TypeScript 模型。稳定性标签、兼容规则和 1.0 readiness 条件见 [Public_Contracts.md](Public_Contracts.md)。

## `index --json`

`mdgraph index --json` 返回对象：

- `files`、`changed`、`deleted`、`unchanged`、`skipped`：索引计数。
- `skippedFiles`：当文件无法在资源预算内解析时，返回带项目相对 `path` 和 `reason` 的跳过文件数组。
- `mode`：`full` 或 `incremental`。
- `counts`：图计数，包含 `documents`、`sections`、`entities`、`sourceRefs`、`edges`、`chunks` 和 `vectors`。

## `status --json`

`mdgraph status --json` 直接返回图计数：

- `documents`、`sections`、`entities`、`sourceRefs`、`edges`、`chunks`、`vectors`。

如果索引不存在，则返回：

- `indexed: false`、`projectRoot`、`database`。

`mdgraph status --freshness --json` 通过 additive 结构保留默认 status 形状，返回：

- `counts`：与 `status --json` 相同的图计数。
- `freshness`：轻量 freshness diagnostics，包含 `state`（`fresh`、`stale` 或 `unknown`）、`recommendation`、可选 `lastIndexedAt`、可选 `checkedAt`，以及可选 `issues`。每个 issue 包含 `path` 和 reason（`added`、`modified` 或 `deleted`）。
`mdgraph status --storage --json` 返回：

- `counts`：与 `status --json` 相同的图计数。
- `storage.database`：`pageSize`、`pageCount`、`freelistCount`、`estimatedBytes`、`journalMode` 和 `walCheckpoint`。
- `storage.objects`：`dbstatAvailable` 以及表、索引、FTS shadow 对象条目。
- `storage.pathGroups`：按顶层路径分组的文档和 chunk 内容贡献。
- `storage.edgeKinds`：按边类型统计的边数量和平均分值。
- `storage.highDegreeNodes`：非包含边度数最高的图节点。
- `storage.vectors`：向量总数、紧凑存储 `format` 以及 provider/model/dimensions 分布。

当 `--storage` 和 `--freshness` 组合使用时，JSON object 包含 `counts`、`storage` 和 `freshness`。

## `usage --json`

`mdgraph usage --json` 返回 agent-friendly workflow guide：

- `projectRoot`：示例命令使用的已解析项目根目录。
- `commonOptions`：对 agent 和脚本普遍有用的 CLI options。
- `workflows`：具名 workflow 条目，包含 `name`、`purpose`、`commands`，以及可选 `notes`。

文本形式会打印相同的 workflow 分组。`usage` 不读取或写入 graph index。
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
- `items`：上下文条目，包含 `nodeId`、`documentId`、可选 `sectionId`、可选 `anchor`、`path`、`title`、可选 `heading`、可选 `lines`、`reason`、`matchedEntities`、可选 `edgePath`、可选 `sourceRefs`、可选 `riskNotes` 和 `content`。

`riskNotes` 可包含生命周期/trust 提醒，以及确定性的内容风险提示，例如 prompt-injection 文本、active HTML/data URI 或隐藏 Unicode 格式字符。

`nodeId`、`documentId`、`sectionId`、`anchor` 和 `lines` 是恢复字段，用于从打包后的 context item 跳转到 `node`、`trace` 或 raw Markdown。`edgePath` 在 graph expansion 贡献该条目时出现；每个 step 包含 `fromId`、`fromLabel`、`edgeFromId`、`edgeToId`、`edgeKind`、`toId`、`toLabel`、`traversalDirection`、`confidence` 和 `provenance`。

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

## `export graphjson --json`

`mdgraph export graphjson --json` 返回确定性的结构化互操作导出：

- `format: "mdgraph-graphjson"` 和 `formatVersion: 1`。
- `schemaVersion`、`mdgraphVersion`、`exportProfile: "structural"`、`graphHash` 和 `sourceHash`。
- `counts`：与 `status --json` 相同的完整 repository counts。
- `exportedCounts`：实际导出的 document、section、entity、source-ref、node 和 edge 计数。
- `nodes`：document、section、entity 和 source-ref 节点。
- `edges`：端点都包含在 `nodes` 中的结构化边。

Structural profile 不包含 chunks、chunk content、section content、vectors、SQLite rowid、SQLite 数据库路径或绝对项目根目录。因为会省略 chunk endpoint edges，`counts.edges` 可能大于 `exportedCounts.edges`。

## `import graphjson --verify --json`

`mdgraph import graphjson graph.json --verify --json` 只校验 GraphJSON 文件，不写 `.mdgraph/graph.db`，返回：

- `valid`：布尔结果。
- `errors`：结构化校验错误，包含 `code`、`message`、可选 `evidence` 和 `remediation`。
- `warnings`：非致命兼容性说明。
- 可读取时的 `format`、`formatVersion`、`schemaVersion`、`graphHash`、`counts` 和 `exportedCounts`。

当 `valid` 为 `false` 时命令返回非零退出码。0.7 不支持 GraphJSON merge import。过大或过深嵌套的 GraphJSON 会在校验前被拒绝。

## `export mermaid trace --json`

`mdgraph export mermaid trace <from> <to> --json` 返回：

- `format: "mdgraph-mermaid"` 和 `formatVersion: 1`。
- `diagramType: "trace"`。
- `found`：是否找到 graph trace。
- `diagram`：Mermaid flowchart 文本。
- `trace`：与 `trace --json` 相同的 trace result shape。

不带 `--json` 时只输出 Mermaid 文本。图只渲染已有 graph trace 事实，不生成 LLM 摘要。

## `export docs-site --json`

`mdgraph export docs-site --json` 返回：

- `format: "mdgraph-docsite-index"` 和 `formatVersion: 1`。
- `sourceFormat: "mdgraph-graphjson"` 和 `graphHash`。
- `documents`：每个文档的 path、title、status、document type、trust tier、defined entities、source refs、outbound links 和 inbound links。

`mdgraph export markdown-index` 会输出基于相同图事实的 Obsidian-friendly Markdown 视图。

## `export source-bridge --json`

`mdgraph export source-bridge --provider codegraph --artifact codegraph.json --json` 返回只读 source bridge report：

- `format: "mdgraph-source-bridge"` 和 `formatVersion: 1`。
- `provider: "codegraph"`。
- `status`：`ready` 或 `unsupported`。
- 可用时的 `reason`。
- `sourceRefs`、`matched` 和 `unmatched`。

Bridge 只读取显式传入的本地 CodeGraph-style JSON artifact，并会在匹配前拒绝过大或过深嵌套的 JSON。它不创建 graph edges，也不影响 indexing、search、context 或 MCP 工具。

## `bundle create --json`

`mdgraph bundle create --profile private --json` 会在 `.mdgraph/bundles/private/` 下创建私有目录 artifact，并返回：

- `bundleDir`：创建出的 bundle 目录绝对路径。
- `manifestPath`：`manifest.json` 的绝对路径。
- `manifest`：bundle manifest，包含 `format`、`formatVersion`、`schemaVersion`、`mdgraphVersion`、`createdAt`、`visibility`、`sourceHash`、`configHash`、`provenance`、`counts`、`documents` 和可选 `reports`。

私有 bundle 包含 `manifest.json`、`graph.db`、`config.json` 和 `reports/status-storage.json` 快照。`sourceHash` 来自规范化配置与按路径排序的文档 path/hash 记录；不包含 Markdown 正文或绝对项目根目录。0.6 不支持 public 或脱敏 bundle profile。

## `bundle verify --json`

`mdgraph bundle verify <dir> --json` 返回：

- `bundleDir`：被检查 bundle 目录的绝对路径。
- `valid`：校验结果。
- `errors`：校验失败原因。
- `manifest`：可读取时的 manifest。
- `counts`：可读取时，从 bundle 内 `graph.db` 计算出的图计数。
- `schemaVersion`、`sourceHash` 和 `configHash`：可计算时的 bundle 内重算值。
- `freshness`：`state`（`fresh`、`stale` 或 `unknown`）和 `reason`；可行时会把 bundle source hash 与当前工作区比较。

当 `valid` 为 `false` 时，命令以非零状态退出。

## `report --json`

`mdgraph report --json` 返回适合 CI 使用的图工作流报告：

- `projectRoot`、`generatedAt`、`mdgraphVersion` 和 `indexed`。
- `schema`：已索引时的 schema metadata，包含 `schemaVersion`、`createdByVersion`、`updatedAt` 和 `baseline`。
- `counts`、`storage` 和 `source`：已索引时的图计数、存储诊断，以及 source/config/document hashes。
- `doctor`：已索引时的 doctor summary、warning counts 和 top warning codes。
- `eval`：提供 `--eval` 时的 evaluation query set、summary 和 ranking metadata。
- `bundle`：提供 `--bundle <dir>` 时的 bundle verification result。
- `diff`：提供 `--base <ref>` 时的 graph diff result。
- `benchmark`：提供 `--benchmark <file>` 时的 paired benchmark result。
- `trend`：`first_run`、`previous_report_loaded` 或 `previous_report_missing`。Trend 只反映显式传入的 `--previous-report <file>`；MDGraph 不会写入隐藏的 report history。

## `report --benchmark <file> --json`

`mdgraph report --benchmark benchmark-runs.json --json` 会读取结构化 agent run records，并在 report 中嵌入 `benchmark` 对象。输入必须是 run record JSON 数组，或包含 `runs` 数组的对象。MDGraph 不解析完整 transcript、不调用模型，也不运行 agent。

每个 `AgentRunRecord` 包含 `id`、`questionId`、`question`、`mode`（`with_mdgraph` 或 `without_mdgraph`）、时间戳、`toolCalls`、`directFileReads`、`textSearches`、`mdgraphCalls`、`finalCitations`、`rawFileFallback`、可选 `tokenEstimate`、可选 `characterBudget` 和 `latencyMs`。

嵌入的 `benchmark` 对象返回：

- `format: "mdgraph-benchmark"` 和 `formatVersion: 1`。
- `records`：解析到的 run record 数量。
- `summary`：question 数、完整 pair 数、skipped pair 数和 aggregate deltas。Delta 定义为 `with_mdgraph - without_mdgraph`。
- `pairs`：每个完整 pair 的 `withMdgraph`、`withoutMdgraph` 和 `delta` 指标，覆盖 file reads、text searches、tool calls、MDGraph calls、字符/token 预算、延迟、raw-file fallback 和引用正确率。
- `skipped`：不完整、重复或 question 文本不一致的 pair。完整 pair 必须恰好包含一个 `with_mdgraph` 和一个 `without_mdgraph` record。

当 `questionId` 匹配内置 evaluation case 时，引用正确率会自动按 expected document/section path 判定。非 evaluation 问题使用 run record 中显式的 `correct: true`、`correct: false` 或 `correct: "unknown"`。`unknown` 单独计数，不进入正确率分母。

## `diff --json`

`mdgraph diff --base <ref> --json` 会把当前已索引图与从 Git base revision 隔离临时索引出的图进行比较，并返回：

- `mode`：当前为 `base_ref`。
- `base`：请求的 `ref`、解析后的 Git `revision` 和 base `sourceHash`。
- `head`：当前图的 `sourceHash`。
- `summary`：`documentsAdded`、`documentsModified`、`documentsDeleted`、`documentsRenamed`、`sectionsChanged`、`sourceRefsChanged`、`edgesChanged` 和 `warningDelta`。
- `documents`：变更 Markdown 文档条目，包含 `path`、可选 `previousPath`、`change`、`hashChanged`、可选 `statusChanged`、`sectionDelta`、`sourceRefDelta` 和可选 `warningCodes`。
- `impact`：`changedSourceRefs`、`affectedDocs` 和简短 `prSummary`。

Diff 只比较 Markdown 图记录、source refs 和 doctor warning codes。它不会解析源码 AST，也不会推断运行时代码影响。Base index 会在临时目录中创建，不会替换当前 `.mdgraph/graph.db`。

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
