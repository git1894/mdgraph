---
description: "Use when designing or changing MDGraph architecture, data model, graph edges, query behavior, CLI commands, MCP tools, or product scope. 中文架构约束。"
name: "MDGraph Architecture"
applyTo: ["docs/**/*.md", "src/**/*.ts", "package.json", "tsconfig.json"]
---

# MDGraph 架构说明

- 改架构、数据模型、查询行为、CLI/MCP 接口前，先读 [Architecture.md](/docs/EN/Architecture.md)、相关 `src/` 模块和对应测试。如果实现行为变化，在同一改动中更新相关文档和测试。
- 保持产品边界窄而硬：服务 AI 编程项目文档的跨文档推理，不扩展成通用知识库、重型图数据库或云依赖 RAG。
- 保持管线形状稳定：scanner -> parser -> extractor/resolver -> SQLite storage -> query engine -> CLI/MCP。
- SQLite + FTS5 是 MVP 的存储/搜索基础；本地 hash embedding 只是可选增强层，不能成为默认必需能力。
- 核心节点概念是 `document`、`section`、`entity`、`source_ref`、`chunk`；变更这些概念会影响 schema、repositories、query、MCP 和测试。
- 强边语义要明确：`CONTAINS`、`DEFINES`、`REFERENCES`、`DEPENDS_ON`、`LINKS_TO`、`IMPLEMENTS`、`REFERENCES_SOURCE`、`SUPERSEDES`、`DEPRECATED_BY`。`SAME_AS`、`RELATED_TO`、`CONTRADICTS` 当前是保留 kind，MVP 不在索引阶段主动产生。
- 每条 graph edge 必须保留 `weight`、`confidence`、`provenance` 和必要 metadata，保证 search/context/trace 能解释结果。
- `source_refs` 和 `IMPLEMENTS` 是索引/图查询关键能力；`trust_tier` 和 `status` 影响 search score；staleness/content-risk 目前由 `doctor` 报告。不要在简化实现时抹掉这些入口。
- MCP 工具面保持小而稳定：`mdgraph_search`、`mdgraph_context`、`mdgraph_node`、`mdgraph_trace`、`mdgraph_status`。
