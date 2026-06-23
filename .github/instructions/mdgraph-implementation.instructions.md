---
description: "Use when implementing MDGraph TypeScript source code, parsers, extractors, resolvers, SQLite storage, query engine, CLI, watcher, MCP server, or doctor checks. 中文实现约束。"
name: "MDGraph Implementation"
applyTo: ["src/**/*.ts", "scripts/**/*.mjs", "package.json", "tsconfig.json"]
---

# MDGraph 实现说明

- 遵循现有模块边界；跨层逻辑要放回对应模块，而不是在 CLI/MCP handler 中直接拼 SQL、正则或路径规则。
- 项目是 TypeScript ESM / NodeNext。源码本地导入使用 `.js` 扩展；公共领域类型优先放在 [src/types.ts](../../src/types.ts)。
- 使用 `stableId`/hash 保持索引确定性，避免 UUID、mtime 或非确定性排序影响增量重建和测试稳定性。
- front matter 字段按文档使用 snake_case，例如 `depends_on`、`source_refs`、`trust_tier`；TypeScript 中按现有接口访问，不要随意改字段名。
- Markdown 解析使用 `yaml`、`unified`、`remark-parse`、`remark-gfm` 和 `src/parser/*` helper。不要用临时字符串切割替代 AST/front matter/link 解析。
- 只从高置信位置提升强实体/边：front matter、`Defines` 章节、heading、inline code、code block、Markdown link、WikiLink、文件路径、命令、API route、error code、config key。
- 不要把普通正文里的裸 PascalCase 或宽泛大写词直接提升为强 graph edge；需要时只作为 FTS 候选或低置信 ranking 线索，并尊重 `stopEntities`。
- SQLite 访问通过 `GraphRepository` 和 `sqlite-adapter`。`node:sqlite` 的 experimental warning 不是失败；不要仅为消除 warning 引入新 SQLite 依赖。
- search/context/trace 的预算和排序职责不同：`search` 使用 status/trust/high-frequency 调整分数；`context` 限制字符数、扩展节点数、图深度并按边权重去重；`trace` 使用 depth budget。输出中保留相关 reason/path/provenance/confidence。
- CLI 和 MCP 的输出要 text-first 且 JSON-compatible；错误边界要显式处理 config、scan、parse、db、MCP input、watch event。
