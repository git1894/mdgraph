# 变更记录

所有 MDGraph 的重要变更都将记录在此文件中。

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-cn/1.1.0/) 的精神，并在 API 表面稳定后对公开发布使用语义化版本控制。

## 0.1.0 - 2026-06-22

### 新增

- 添加了 Linux 和 Windows CI 验证，包含构建输出 CLI 冒烟检查和打包工件冒烟检查。
- 添加了 `mdgraph doctor --strict`，当报告任何医生问题时以 CI 风格失败。
- 添加了 `mdgraph status --storage`，包含 SQLite 页/空闲列表/WAL 状态、对象大小、路径组贡献、边类型分布、高degree节点和向量提供商计数。
- 添加了逼真的 alpha 评估夹具语料库，涵盖 ADR、设计文档、运行手册、API 文档、事件、源引用和已替代文档。
- 添加了 watch + MCP 新鲜度回归覆盖，确保更改的 Markdown 文件对后续 MCP 工具调用可见。
- 添加了公共 CLI JSON 输出契约文档。

### 修复

- 修正了重复标题锚点解析，使 `#anchor` 目标指向第一个匹配章节，生成的后缀（如 `#anchor-2`）保持稳定。
- 防止内联代码跨度内的 WikiLinks 创建图链接，同时保持普通文本中的 WikiLinks 和围栏代码过滤不变。
- 使 `doctor` 在报告图健康之前检测过期索引，返回只读新鲜度诊断，而非混合当前文件与旧 SQLite 数据。
- 对齐 MCP 初始化 `rootUri` / `workspaceFolders` 与后续工具调用使用的默认项目根目录，无效根目录报告为输入错误。
- 为 CLI/MCP 节点查询添加了 `docs/file.md#anchor` 章节查找，为仅含标题的章节查询提供了结构化歧义输出。
- 当通过多条搜索路径到达文档或章节时，保留了合并的搜索解释和匹配实体。
- 修复了章节块边界，使父章节块在子标题之前停止，避免重复的块/FTS/上下文内容。
- 更新了监听模式，通过 Chokidar v4 可靠地接收文件变更事件：监听项目根目录，由索引器应用配置的 Markdown 包含/排除规则。
- 改进了扫描器和 SQLite 打开失败消息，提供可操作的下一步指导。

### 文档

- 更新了 README、架构文档、MCP 指南和核心正确性契约，涵盖过期索引医生行为、章节查找、搜索解释合并和块边界。
- 记录了存储增长、维护行为、`doctor --strict`、`status --storage` 和评估预期记录。

### 测试

- 添加了聚焦回归覆盖，涵盖锚点解析、WikiLink 提取边界、过期索引医生行为、MCP 项目根目录、节点查找歧义、搜索去重和块/上下文边界。

## 0.1.0-alpha - 2026-06-20

### 新增

- 从 front matter、标题、Markdown 链接、WikiLinks、代码块、内联代码、源引用和高置信度实体模式进行确定性 Markdown 索引。
- SQLite 图存储，用于文档、章节、实体、源引用、边、块、FTS5 数据和可选本地向量。
- CLI 工作流，包括 `init`、`index`、`status`、`search`、`context`、`node`、`trace`、`serve`、`watch` 和 `doctor`。
- 可解释的 `search`、`context`、`node` 和 `trace` 输出，包含原因、图元数据、来源和适用时的置信度。
- MCP stdio 服务器，包含 `mdgraph_search`、`mdgraph_context`、`mdgraph_node`、`mdgraph_trace` 和 `mdgraph_status`。
- 基于哈希的增量索引、删除清理和监听模式。
- 使用内置 `local-hash` 提供商的可选确定性本地语义向量。
- 基于规则的 `doctor` 报告，涵盖死链、过期源引用、缺失定义、弱链接、可能矛盾和内容风险。

### 说明

- MDGraph 有意保持为本地优先的 Markdown 文档图，而非通用 RAG 应用、云嵌入服务、Neo4j 部署、完整源代码图或个人知识管理系统。
- 需要 Node.js `>=22.5.0`，因为项目使用了 Node 内置的 `node:sqlite` 模块。即使命令成功，当前 Node 版本也可能打印实验性警告。

## 2026-06-18

初始 MDGraph
