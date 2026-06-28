# MDGraph 公开契约

本文记录 `0.8` 契约强化线引入的公开契约边界。它补充 [Output_Contracts.md](Output_Contracts.md)、[Architecture.md](Architecture.md) 和 [Release_Checklist.md](Release_Checklist.md)。

## 稳定性标签

- `stable`：用户和 agent 可以依赖该形状。允许追加字段；`1.0` 后删除或重命名已记录字段属于破坏性变更。
- `stable-additive`：既有字段和语义稳定；只要旧消费者继续有效，该 surface 可以增加 optional 字段或指标。
- `experimental`：`1.0` 前可用，但语义可能随 changelog 和 focused tests 调整。
- `reserved`：为未来用途保留名称；在 emitter 或 workflow 被记录和测试前不代表已启用。
- `internal`：实现细节，不提供兼容承诺。

## 契约 Ledger

| Surface | 状态 | Owner | 契约 |
|---|---|---|---|
| CLI command names 和已记录 flags | stable | `src/bin/mdgraph.ts` | `init`、`index`、`status`、`search`、`context`、`node`、`trace`、`eval`、`semantic status`、`bundle create/verify`、`export`、`import graphjson --verify`、`diff`、`report`、`serve --mcp`、`watch` 和 `doctor`。 |
| 顶层 CLI JSON output shapes | stable | `docs/ZH/Output_Contracts.md` | Output Contracts 中记录的必需字段稳定；命令内嵌 graph record 遵循 `src/types.ts`，除非另有说明。 |
| MCP tool names 和 input schemas | stable | `src/mcp/tools.ts` | 固定五个工具：`mdgraph_search`、`mdgraph_context`、`mdgraph_node`、`mdgraph_trace` 和 `mdgraph_status`；schema 拒绝未声明属性。 |
| MCP text output wording | experimental | `src/mcp/tools.ts` | 文本是面向人的提示；机器契约优先使用 `structuredContent`。 |
| Context recovery fields | stable-additive | `src/query/context-builder.ts` | Context item 暴露 `nodeId`、`documentId`、可选 `sectionId`、可选 `anchor`、line range、source refs、risk notes 和 graph-expansion `edgePath`，让 agent 无需从 prose 猜测即可恢复节点和 provenance。 |
| `.mdgraph/config.json` fields | stable | `src/config/load-config.ts` | `docs`、`index`、`search`、`entities` 和 `embedding` 默认字段稳定。当前 merge 逻辑会忽略未知字段。 |
| `.mdgraph` file governance | stable | `src/config/load-config.ts`、`src/bin/mdgraph.ts` | `mdgraph init` 保持 `.mdgraph/config.json` 可跟踪，在没有等价 ignore 规则时通过根 `.gitignore` 保护本地 `.mdgraph` artifacts，并默认构建初始 graph index。`.mdgraph/graph.db` 和生成的 `.mdgraph` artifacts 属于本地 workflow state，不是 source files。需要只生成配置时使用 `--no-index`。 |
| SQLite schema metadata | stable | `src/db/schema.sql`、`src/db/connection.ts` | `schema_metadata.schema_version` 是兼容 gate。未来 schema version 会在应用本地 schema 前失败。 |
| SQLite table internals | internal | `src/db/schema.sql` | rowid、FTS shadow table、vector blob 表示细节和 private bundle database 内容不是 public API。 |
| Public graph record types | stable | `src/types.ts` | `GraphDocument`、`GraphSection`、`GraphEntity`、`SourceRef`、`GraphEdge`、`GraphChunk`、`ChunkVector`、`SearchResult` 和 `TraceStep`。 |
| Edge kinds | stable/reserved | `src/types.ts` | 已启用 edge kind 稳定。`SAME_AS`、`RELATED_TO` 和 `CONTRADICTS` 是 reserved，直到 emitter 被记录和测试。 |
| Doctor warning shape | stable | `src/analysis/doctor.ts` | Warning 包含 `code`、`severity`、`message`、`evidence`、`affectedNodes` 和 `remediation`。warning code 通过 changelog 和 tests 管理版本。 |
| GraphJSON export 和 verify | stable format v1 | `src/export/graphjson.ts` | `format: "mdgraph-graphjson"`、`formatVersion: 1`、structural profile、确定性排序和 `graphHash` 验证。 |
| Bundle manifest | experimental | `src/bundle/bundle.ts` | `formatVersion: 1` private workflow artifact。它不是公开 sanitized exchange format。 |
| Report、diff 和 benchmark JSON | experimental | `src/reporting`、`src/diff`、`src/benchmark` | 面向 CI 的 workflow 输出；必需顶层字段已记录，详细 metrics 在 `1.0` 前仍可能扩展。 |
| Semantic vector provider behavior | experimental | `src/semantic/*` | 可选本地 provider 不可用或不支持时，必须降级到 FTS5/graph search。 |

## 兼容策略

- 当已有字段语义不变时，允许追加 JSON 字段。
- `1.0` 后删除、重命名或改变已记录 stable 字段类型属于破坏性变更。
- 在默认行为不变时，可以新增 optional CLI flag。
- MCP tool name 和 required input 稳定；新增 optional input 时旧客户端必须继续工作。
- 当必需 v1 字段有效时，可忽略未知 GraphJSON future fields。
- 不支持的未来 `formatVersion` 必须返回可行动的升级 guidance。
- 已经返回结构化错误的命令应提供稳定 `code` 和 remediation。
- verify 失败、bundle verify 无效、strict doctor gate 和非法命令用法的非零退出属于契约。

## Schema And Config 策略

- 没有 metadata 的既有数据库在 metadata table 创建后标记为 `legacy`。
- future `schema_version` 会在本地 schema SQL 应用前失败。
- 当 public graph record 保持兼容时，现有 migration helper 可以更新 storage internals。
- 无法安全迁移的 schema change 必须给出 rebuild 或 upgrade guidance。
- 新 config 字段必须有默认值；除非明确记录为 breaking，否则不能让既有 config 文件失效。
- Config numeric 和 path 相关限制是安全契约，不是可选调参建议。

## Release Matrix

`0.9` context/evidence hardening 发布前：

- 运行 `npm run typecheck`、focused contract tests、`npm test`、`npm run build`、`npm run smoke:cli`、`npm run smoke:eval`、`npm run smoke:pack`、`npm run task:public-check` 和 `git diff --check`。
- 当 package metadata 或 included public docs 变化时运行 `npm pack --dry-run`。
- 验证 Node.js `>=22.5.0`；常规开发基线是当前 Node 22.x。
- Linux 和 Windows full CI 是 release gate 基线；`1.0` 前 macOS 由 CI smoke 覆盖 build-output CLI 和 packed-artifact 行为。
- 对平台相关的长运行 surface 使用 release maintainer smoke，而不是 CI：`serve --mcp`、`watch`，以及适用时通过 `MDGRAPH_EXTERNAL_ECC_PATH` 运行 external corpus smoke。
- 当 scanner、parser、storage、query、MCP 或 doctor 行为对外部语料产生实质变化时，必须运行 external corpus smoke。

## 1.0 Readiness

只有满足以下条件后，MDGraph 才应从 `0.9` 进入 `1.0`：

- 上述 ledger 覆盖每个 public surface。
- 关键 public shape 已由 focused tests 或 smoke gates 保护。
- Experimental 和 internal surface 已在文档中明确标注。
- 已知 output-shape 不一致已经被规范化，或被明确记录为刻意保留。
- Release checklist 能捕获意外 public contract drift。
