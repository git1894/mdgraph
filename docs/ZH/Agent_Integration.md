# MDGraph Agent 集成指南

本文是 0.3 阶段面向 coding agent 的共享集成契约。不同宿主的适配应保持很薄：启动同一个 MCP server，暴露同一组五个工具，并教 agent 在直接读取 Markdown 文件前先查询 MDGraph。

## 核心行为

把 MDGraph 当作被显式邀请的文档上下文层，而不是隐藏记忆，也不是源码图谱。

1. 如果不确定工作区是否已有索引，先调用 `mdgraph_status`。
2. 跨文档问题优先用 `mdgraph_context`，例如设计文档、ADR、runbook、API 文档、source reference、incident 或 feature chain。如果任务已经给出项目相对文档路径或源码路径，通过 MCP `knownFiles` 传入；如果宿主上下文预算较紧，通过 `maxChars` 控制返回字符数。
3. 快速查关键字、实体、路径、命令、配置键、API route 或错误码时，用 `mdgraph_search`。
4. 已经知道文档路径、章节锚点、实体名、源码路径或 graph id 时，用 `mdgraph_node`。
5. 需要回答两个文档、实体或 source reference 之间如何关联时，用 `mdgraph_trace`。
6. 只有在索引不可用、返回上下文不足、需要精确相邻原文，或用户明确要求读文件时，才回退到 raw file reads。

对于 coding task，把任务描述写进 `mdgraph_context` 查询，并通过 `knownFiles` 传入已知文件路径。这样 MDGraph 可以返回更像 task-start documentation brief 的结果：相关文档、source refs、risk notes、provenance、确定性的 auto-mode metadata 和 `suggestedNextQueries`。

## 共享 Instruction Template

```text
Use MDGraph before reading multiple Markdown files manually.

- Start with mdgraph_status if index availability is unclear.
- Use mdgraph_context for cross-document design, ADR, runbook, API, incident, source-ref, or feature-chain questions. Include knownFiles and maxChars when the host supports MCP arguments.
- Use mdgraph_search for quick keyword/entity/path lookup.
- Use mdgraph_node for known document paths, section anchors, entities, source paths, or graph ids.
- Use mdgraph_trace for relationship questions between two known documents, entities, or source references.
- Prefer returned context when it includes enough content, reasons, provenance, source refs, and risk notes.
- Fall back to normal file reads when MDGraph is inactive, stale for the task, too sparse, or when exact source text is required.

Do not treat MDGraph as hidden memory, a source AST index, or an authority beyond the indexed Markdown corpus.
```

## MCP 配置

所有支持 MCP 的 client 都使用相同的 stdio command：

同一套 instructions、宿主示例、配置示例和 prompt templates 也会随 [`agent-pack/`](../../agent-pack/) 发布。

```json
{
  "mcpServers": {
    "mdgraph": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/absolute/path/to/mdgraph/dist/bin/mdgraph.js",
        "serve",
        "--mcp",
        "--path",
        "/absolute/path/to/project"
      ]
    }
  }
}
```

依赖 MCP server 前，先在目标项目执行一次：

```bash
node /absolute/path/to/mdgraph/dist/bin/mdgraph.js init --docs "docs/**/*.md"
```

## 宿主说明

| 宿主 | 配置形态 | 回退指南 |
|---|---|---|
| Claude Code | 把 MCP server 加到 project 或 user MCP config，并把共享 instruction template 放进项目指令。 | 如果 `mdgraph_status` inactive，继续使用普通文件工具，除非用户要求创建索引。 |
| Cursor | 在 Cursor 的 MCP settings 中添加同一个 stdio server，并把共享 instruction 放进 project rules。 | 用 MDGraph 获取 Markdown 上下文；实现细节仍用编辑器搜索或源码读取。 |
| Copilot Chat | 在支持 MCP 的位置添加 server，并把共享 instruction 放进 `.github/copilot-instructions.md` 或等价 workspace guidance。 | 如果 MCP tools 不可用，只有在用户要求时才手动使用 `mdgraph` CLI。 |
| Codex CLI | 把 stdio MCP server 加到 Codex MCP configuration，并在 repo instructions 中保留本指南。 | 大范围读文档前先查 MDGraph；未索引时回退到 shell/file tools。 |
| Generic MCP client | 使用上面的 JSON 配置。 | 把工具结果当作带 provenance 的文档上下文，不要当作代码执行证据。 |

## 推荐工作流

Task-start documentation brief：

1. `mdgraph_status`
2. 使用任务描述、`knownFiles` 和必要时的 `maxChars` 调用 `mdgraph_context`
3. 只对仍需确认的具体文档调用 `mdgraph_node` 或 raw file reads

关系问题：

1. 如果名称不明确，先分别用 `mdgraph_search` 定位两端
2. 对解析出的节点调用 `mdgraph_trace`
3. 如果 trace 路径还需要上下文，再调用 `mdgraph_context`

文档健康检查：

1. `mdgraph_status`
2. 当用户要求 docs health 或 CI gate 时，使用 CLI `mdgraph doctor --json`
3. 只有在 doctor 输出点名 affected documents 后才编辑原文件

## 当前限制

- MDGraph 索引 Markdown 文档，不索引源码 AST 或任意文件。
- MCP surface 故意保持五个工具：search、context、node、trace、status。
- Agent auto mode 是确定性且很窄的策略：MCP search/context 会根据 query 形态、索引规模、`knownFiles` 和 `maxChars` 选择默认 limit、depth 和字符预算；宿主侧 token budget 仍应由 agent 或 client 处理。
- `mdgraph_status` 会做轻量 Markdown 路径和 mtime freshness 检查；完整 stale-index hash 检查和文档健康结论仍应使用 `mdgraph doctor --json`。
- 有限范围的 file-read 对比案例记录在 [Agent_File_Read_Comparison.md](Agent_File_Read_Comparison.md)。结构化 with/without-MDGraph run-record delta 使用 `mdgraph report --benchmark <file>`；完整 transcript 捕获和 agent runtime hosting 不属于 MDGraph。
