---
description: "Use when writing or updating MDGraph tests, fixtures, integration scenarios, CLI/MCP smoke checks, regression tests, or agent evaluation prompts. 中文测试约束。"
name: "MDGraph Testing"
applyTo: ["__tests__/**/*.ts", "tests/**/*.ts", "docs/EN/Evaluation_Questions.md", "docs/EN/Implementation_Review_*.md"]
---

# MDGraph 测试说明

- 测试框架是 Vitest，配置在 [vitest.config.ts](../../vitest.config.ts)。常用命令：`npm test`、`npm test -- __tests__/parser.test.ts`、`npm run typecheck`、`npm run build`。
- 优先测试确定性索引：同一文档集应生成稳定 documents、sections、entities、source refs、edges、chunks、FTS rows 和可选 vectors。
- fixture 使用小而真实的文档仓库，覆盖 specs、designs、runbooks、incidents、source_refs、depends_on、implements、deprecated/superseded 关系。
- 单元测试重点覆盖 front matter normalization、Markdown link、WikiLink、heading anchor、entity kind/role、edge provenance/weight/confidence、budget trimming。
- 集成测试要断言 search/context/trace 的可解释结果，不只断言排序；至少检查 reason、matched entities、edge kind、source path 或 line 信息。
- 加负向测试防止噪声实体污染图扩散，例如 `Config`、`Error`、`Service`、`API`、`User`、`Data`。
- source reference 行为要单独覆盖：`source_refs` 和 `implements` 应生成 `source_ref` 节点及 `REFERENCES_SOURCE`/`IMPLEMENTS` 边；源码路径反查优先通过 `resolveNode`、MCP `mdgraph_node` related edges 或 `trace` 验证，不要假设普通 FTS search 是唯一入口。
- CLI/MCP 变更要补 smoke 或 handler 测试，确保五个 MCP 工具 schema、错误输入和未索引项目输出保持稳定。
- agent 评估问题维护在 [Evaluation_Questions.md](../../docs/EN/Evaluation_Questions.md)，不要把未运行过的 A/B 结果写成已验证结论。
