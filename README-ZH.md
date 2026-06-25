<div align="center">

# MDGraph

### AI 编码工作流的确定性 Markdown 文档图谱

**将你的文档索引为可解释的知识图谱 — 零云端依赖即可搜索、追溯与上下文打包。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/Node-%3E%3D22.5.0-brightgreen.svg)](https://nodejs.org/)
[![npm version](https://img.shields.io/badge/version-0.1.0-blue.svg)]()

<br>
<a href="./README.md">ENGLISH</a> • <a href="./docs/ZH/Architecture.md">架构说明</a> • <a href="./docs/ZH/Agent_Integration.md">Agent 集成</a> • <a href="./docs/ZH/Evaluation_Questions.md">使用评估</a>
<br>

**MDGraph 是 AI 编码代理的文档智能层。**
它将你的 Markdown 文档 — 规格说明、架构决策记录（ADR）、运维手册、API 参考、设计文档 — 转化为本地 SQLite 图谱，代理直接查询图谱，无需在一堆 `.md` 文件中逐个 grep 搜索。

<br>

</div>

---

## 快速开始

### 1. 克隆并构建

```bash
git clone <仓库地址>
npm install
npm run build
```

### 2. 初始化项目

```bash
cd 你的项目目录
node /path/to/mdgraph/dist/bin/mdgraph.js init --docs "docs/**/*.md"
```

这将创建 `.mdgraph/config.json`，其中包含你的 Markdown 包含/排除 glob 模式。

### 3. 索引文档

```bash
node /path/to/mdgraph/dist/bin/mdgraph.js index
```

构建确定性图谱：文档、章节、实体、边 — 全部从结构中派生，不存在 LLM 幻觉。

### 4. 连接你的代理

将 MCP 服务器与你的代理一起启动：

```bash
# 启动 MCP 服务器
node /path/to/mdgraph/dist/bin/mdgraph.js serve --mcp --path .

# 或在代理的 MCP 设置中配置自动启动：
# { "mcpServers": { "mdgraph": { "type": "stdio", "command": "node", "args": ["/path/to/mdgraph/dist/bin/mdgraph.js", "serve", "--mcp", "--path", "/your/project"] } } }
```

你的代理现在可以使用 MDGraph 的五种工具探索文档，无需再逐个读取文件。

### 5. 自动保持最新

```bash
node /path/to/mdgraph/dist/bin/mdgraph.js watch --semantic
```

监听模式启动时会先执行一次索引，随后基于哈希的增量同步会跟踪后续文件变更。重启代理时记得停止并重新启动 MCP 服务器。

---

## 为什么选择 MDGraph？

当 AI 代理需要理解项目的架构时，它通常会在 Markdown 文件中逐行搜索 — 每次读取都消耗工具调用次数和 token，且无法理解文档之间的关联关系。

**MDGraph 为代理提供预索引的文档图谱** — 实体通过语义边（DEFINES、DEPENDS_ON、LINKS_TO、IMPLEMENTS）相连，支持 FTS5 全文搜索和可解释的图遍历。代理只需一次工具调用就能查询图谱，无需打开五个文件。

| 没有 MDGraph | 使用 MDGraph |
|---|---|
| 代理在 20 个文件中 grep 搜索 "timeout config" | 一次 `mdgraph_search` 调用返回按实体匹配排序的章节 |
| 代理逐个读取所有链接文档来理解设计链 | 一次 `mdgraph_trace` 调用显示完整的图谱路径，包含边类型和来源 |
| 代理一个个打开文件来为问题收集上下文 | 一次 `mdgraph_context` 调用返回打包好的上下文包，每项都附有包含原因 |
| 代理无法验证文档健康度或过期引用 | 一次 `mdgraph doctor` 调用暴露失效链接、缺失定义和内容风险 |

**每个结果都是可解释的** — 图谱记录了章节为何匹配（FTS 命中、实体匹配、语义向量、图遍历），什么边连接了两个文档，以及置信度和来源。

---

## 关键特性

| | |
|---|---|
| **确定性提取** | 无需 LLM 调用，无需云端 — 一切从 Markdown 结构派生：标题、前置元数据、链接、WikiLinks、代码块。可重现、可审计。 |
| **可解释搜索** | 每个结果都附带原因 — FTS5 命中、精确实体匹配、语义向量相似度或图谱邻居扩展。 |
| **图谱追溯** | 两节点间的有界 BFS 遍历返回完整路径，每一步都包含边类型、来源和置信度。 |
| **上下文构建器** | 将搜索和扩展结果打包为字符预算内的上下文包 — 非常适合代理提示词。 |
| **基于哈希的增量索引** | 仅重新索引变更的文件。内容哈希检测修改；已删除文件自动清理。 |
| **监听模式** | 基于 Chokidar 的文件监听器，可配置防抖 — 启动时索引一次，之后每次保存都重新索引。 |
| **可选的语义向量** | 本地确定性哈希嵌入（无需外部模型）。通过 `--semantic` 启用。 |
| **文档健康检查（Doctor）** | 分析文档图谱：失效链接、过期源码引用、缺失定义、弱链接、潜在矛盾、内容风险、图健康、存储健康和生命周期误用。 |
| **MCP 服务器** | 为 AI 代理提供五种专注的工具 — 搜索、上下文、节点、追溯、状态。 |
| **100% 本地** | SQLite 数据库位于 `.mdgraph/`。数据不会离开你的机器。 |

---

## 工作原理

```
┌─────────────────────────────────────────────────────────────────┐
│                        AI 编码代理                               │
│                                                                  │
│  "认证超时如何影响登录流程？"                                      │
│      → 直接调用 MDGraph 工具 — 无需读取文件                      │
│                              │                                   │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     MDGraph MCP 服务器                           │
│                                                                  │
│   mdgraph_search · mdgraph_context · mdgraph_node               │
│   mdgraph_trace · mdgraph_status                                 │
│                              │                                   │
│                              ▼                                   │
│                     SQLite 文档图谱                               │
│   documents · sections · entities · source_refs · edges         │
│   FTS5 全文搜索 · 可选的本地向量                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 处理流水线

```
Markdown 文件 → 扫描器 → 解析器 → 实体提取器 → 图谱构建器 → SQLite
                      ↓                                            ↓
                 链接解析器                                 查询引擎
                      ↓                                            ↓
               增量同步                                    CLI · MCP 服务器
```

1. **扫描** — 查找匹配包含/排除 glob 模式的 Markdown 文件。默认启用根目录 `.gitignore` 过滤，也可通过配置关闭。

2. **解析** — 使用 `yaml` + `remark-parse` 提取前置元数据（YAML）、标题、Markdown 链接、WikiLinks、代码块、内联代码和源码引用。

3. **提取** — 识别实体（符号、API 路由、错误码、配置键、文件路径、命令、包、概念）并构建带有类型化边的图谱记录：
   - `CONTAINS` — 文档 → 章节，章节 → 实体
   - `DEFINES` — 实体定义上下文
   - `REFERENCES` — 跨文档链接
   - `DEPENDS_ON` — 前置元数据声明的依赖
   - `LINKS_TO` — WikiLink 和 Markdown 链接目标
   - `IMPLEMENTS` — 文档实现了被引用的规格/实体
   - `SUPERSEDES` / `DEPRECATED_BY` — 版本管理和决策过期

4. **解析** — 跨文档链接解析：Markdown 链接目标 → 文档/章节锚点，WikiLinks → 已索引实体。

5. **索引** — 基于哈希的增量同步仅写入变更的文档；通过 `--full` 进行完全重建。可选的本地语义向量生成。

6. **服务** — CLI 和 MCP 暴露搜索、上下文、节点、追溯、状态和 doctor 操作。

---

## CLI 参考

```bash
# 初始化
node dist/bin/mdgraph.js init --docs "docs/**/*.md"    # 创建 .mdgraph/config.json

# 索引
node dist/bin/mdgraph.js index                          # 基于哈希的增量同步
node dist/bin/mdgraph.js index --full                   # 完全重建
node dist/bin/mdgraph.js index --full --semantic        # 完全重建（含向量）

# 检查
node dist/bin/mdgraph.js status                         # 图谱计数和数据库健康度
node dist/bin/mdgraph.js status --json                  # 机器可读输出
node dist/bin/mdgraph.js status --storage --json        # 计数和存储诊断

# 查询
node dist/bin/mdgraph.js search "authentication timeout"             # FTS5 + 实体搜索
node dist/bin/mdgraph.js search "authentication timeout" --semantic   # 包含向量搜索
node dist/bin/mdgraph.js search "AuthService" --limit 10             # 限制结果数
node dist/bin/mdgraph.js search "AuthService" --explain --json       # 查询/排序诊断
node dist/bin/mdgraph.js context "why does RedisTimeoutError affect login"   # 上下文包
node dist/bin/mdgraph.js context "why does RedisTimeoutError affect login" --debug --json # 打包诊断
node dist/bin/mdgraph.js node "AuthService"                          # 按名称/路径/ID 解析
node dist/bin/mdgraph.js node "docs/auth-v2-design.md#session-refresh" # 按路径锚点解析章节
node dist/bin/mdgraph.js trace "AuthService" "RedisTimeoutError"     # 两节点间的图谱路径
node dist/bin/mdgraph.js trace "AuthService" "RedisTimeoutError" --depth 8  # 自定义深度

# 检索评估
node dist/bin/mdgraph.js eval                              # 运行内置 alpha 检索评估
node dist/bin/mdgraph.js eval --json                       # 机器可读指标
node dist/bin/mdgraph.js eval --path /your/project --json  # 评估显式指定的已索引项目
node dist/bin/mdgraph.js eval --query-set ecc --path /path/to/ecc --json # ECC path-only 期望记录

# MCP 服务器
node dist/bin/mdgraph.js serve --mcp                       # 启动 stdio MCP 服务器
node dist/bin/mdgraph.js serve --mcp --path /your/project  # 指定项目根目录

# 监听
node dist/bin/mdgraph.js watch                             # 立即索引，然后在文件变更时自动重新索引
node dist/bin/mdgraph.js watch --semantic                   # ...含向量
node dist/bin/mdgraph.js watch --debounce 500               # 自定义防抖时间（毫秒）

# 健康检查
node dist/bin/mdgraph.js doctor                            # 文档健康度报告
node dist/bin/mdgraph.js doctor --json                     # 机器可读
node dist/bin/mdgraph.js doctor --strict                   # 发现问题时返回非零退出码
node dist/bin/mdgraph.js doctor --fail-on warn             # 只按告警严重级别控制退出码
node dist/bin/mdgraph.js doctor --changed --json           # 限定为 Git 工作区中的变更 Markdown
node dist/bin/mdgraph.js doctor --since main --json        # 限定为某个基线提交以来的变更

# 帮助
node dist/bin/mdgraph.js help                              # 所有命令
node dist/bin/mdgraph.js help search                       # 特定命令的帮助
```

所有查询命令都支持 `--json`，为代理和脚本提供结构化输出。`mdgraph eval` 报告 search/context/trace 质量的轻量检索指标；它是确定性 smoke 检查，不是真实 agent A/B benchmark。默认 `alpha` query set 面向内置 fixture 语料；`--query-set ecc` 面向已索引的 ECC 风格工作区，只使用 path-only 期望记录，不复制外部内容。稳定的顶层字段记录在 [Output_Contracts.md](docs/ZH/Output_Contracts.md)。

---

## MCP 工具

作为 MCP 服务器运行时，MDGraph 暴露五种专注的工具：

| 工具 | 用途 | 使用时机 |
|------|------|----------|
| `mdgraph_search` | 按关键字或实体名称搜索文档、章节和实体；未显式传入 limit 时，MCP 结果包含确定性的 auto-mode limit metadata | 快速查找 — 在读取文件之前 |
| `mdgraph_context` | 为跨文档问题构建可解释的上下文包；MCP 支持 `knownFiles`、`maxChars`、source refs、risk notes 和 suggested follow-up queries 用于 task-start brief | 理解某个功能、调试流程 — 需要来自多个文件的文档 |
| `mdgraph_node` | 查看文档、实体、源码引用、章节或块的详细信息；章节可用 `docs/file.md#anchor` 定位 | 你知道名称、路径或锚点，想获取完整记录 |
| `mdgraph_trace` | 查找两个节点间的可解释图谱路径 | "A 和 B 有什么关系" — 关系发现 |
| `mdgraph_status` | 报告索引可用性、计数、数据库路径和轻量 Markdown freshness state | 在依赖索引之前验证它是否活跃且没有明显 stale |

在没有 `.mdgraph/` 索引的工作区中，服务器会宣告自己为非活跃状态 — 代理回退到常规文件工具，是否索引由你决定。

### 代理使用指引

MDGraph 的 MCP 服务器会自动向你的代理传递以下指引：

- **在手动阅读多个文档之前，先使用 `mdgraph_context`** — 它返回打包后的相关章节，每项都附带包含原因。
- **coding task 开始时，把任务描述和已知文件路径传给 `mdgraph_context`** — MCP 支持 `knownFiles` 和 `maxChars`，用于更紧凑的 brief。
- **快速关键字或实体查找使用 `mdgraph_search`** — 结果按相关性排序，匹配的实体高亮显示；未显式传入 limit 时，MCP 输出会记录自动选择的 limit。
- **当你知道要查找什么时使用 `mdgraph_node`** — 按名称、路径、`docs/file.md#anchor` 或图谱 ID 解析。
- **关系类问题使用 `mdgraph_trace`** — 返回路径的每一步，包含边类型、来源和置信度。
- **把 `mdgraph_status` 作为轻量 readiness check** — 它会扫描配置范围内的 Markdown 路径，提示 added、deleted 或 modified 文件；完整健康检查仍使用 `mdgraph doctor --json`。
- **当返回的上下文内容足够且包含原因时，优先直接使用它**。仅在 MDGraph 不可用或返回的上下文明显不足时再读取文件。

宿主配置说明和共享 instruction template 见 [Agent_Integration.md](docs/ZH/Agent_Integration.md)。
有限范围的 file-read 对比案例记录见 [Agent_File_Read_Comparison.md](docs/ZH/Agent_File_Read_Comparison.md)。
可复用 instructions、MCP config 和 prompt templates 随 [agent-pack/](agent-pack/) 一起发布。

---

## 配置

配置文件位于 `.mdgraph/config.json`，由 `mdgraph init` 创建。

```json
{
  "docs": {
    "include": ["docs/**/*.md", "**/*.md"],
    "exclude": [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.git/**",
      "**/.mdgraph/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/.cache/**",
      "temp/**",
      "**/temp/**",
      "tmp/**",
      "**/tmp/**"
    ]
  },
  "index": {
    "parseMdx": false,
    "followGitignore": true,
    "maxFileBytes": 524288
  },
  "search": {
    "defaultLimit": 8,
    "maxDepth": 2,
    "maxContextChars": 28000,
    "highFrequencyEntityThreshold": 50
  },
  "entities": {
    "enabledKinds": ["symbol", "api_route", "error_code", "config_key", "file_path", "command", "package", "concept"],
    "stopEntities": ["Config", "Error", "Service", "API", "User", "Data"]
  },
  "embedding": {
    "enabled": false,
    "provider": "local-hash",
    "model": "mdgraph-local-hash-v1",
    "dimensions": 128
  }
}
```

### 配置字段

| 配置段 | 字段 | 默认值 | 说明 |
|--------|------|--------|------|
| `docs.include` | | `["docs/**/*.md", "**/*.md"]` | 要索引的 Markdown 文件 glob 模式 |
| `docs.exclude` | | 常见生成物/依赖目录，例如 `**/node_modules/**`、`**/dist/**`、`**/.git/**`、`**/.mdgraph/**`、`**/temp/**`、`**/tmp/**` | 要排除的 glob 模式 |
| `index.parseMdx` | | `false` | 启用 MDX 解析（将来支持） |
| `index.followGitignore` | | `true` | 跳过匹配根目录 `.gitignore` 的文件 |
| `index.maxFileBytes` | | `524288` | 跳过大于 512 KiB 的文件 |
| `search.defaultLimit` | | `8` | 搜索的默认最大结果数 |
| `search.maxDepth` | | `2` | 上下文构建器的图谱扩展深度 |
| `search.maxContextChars` | | `28000` | 上下文包的字符预算 |
| `search.highFrequencyEntityThreshold` | | `50` | 出现在超过此数量文档中的实体将被降权 |
| `entities.enabledKinds` | | `[默认 8 种]` | 索引期间要提取的实体类型 |
| `entities.stopEntities` | | `["Config", "Error", "Service", "API", "User", "Data"]` | 要忽略的实体名称 |
| `embedding.enabled` | | `false` | 启用本地语义向量 |
| `embedding.provider` | | `"local-hash"` | 向量提供者（仅 `local-hash` 可用） |
| `embedding.model` | | `"default"` | 模型名称（为将来预留） |
| `embedding.dimensions` | | `128` | 向量维度 |

语义搜索是完全可选的。没有向量，MDGraph 仍然通过 FTS5 和图谱遍历正常工作。

---

## 存储增长与维护

SQLite 数据库会随着有效文档正文、章节数、实体数、边数量、FTS 行以及可选向量行增长。普通手写 Markdown 的增长通常应近似线性。误扫生成物/依赖/temp 目录、过宽的实体提取、高维 JSON 向量或删除后遗留的 SQLite 页面都会放大体积。

MDGraph 使用 external-content FTS5 表，因此 chunk 文本不会再复制到 FTS shadow content 表中。章节内容和 chunk 内容仍会分别存储：章节保留 Markdown 结构，chunk 是搜索和上下文打包单位。

使用 `node dist/bin/mdgraph.js status --storage --json` 查看页数、freelist、WAL checkpoint 状态、表/索引/FTS shadow 对象、按路径分组的文档贡献、边类型分布、高度数节点和向量 provider。如果数据库异常增长，先检查是否排除了 `node_modules`、`dist`、归档、临时目录和本地索引目录。

维护行为：

- `mdgraph index --full` 会执行完整重建、FTS optimize、WAL checkpoint 和 `VACUUM`。
- 增量索引会移除变更/删除文档的记录，优化 FTS，并 checkpoint WAL，但不会在每次保存时 vacuum。
- SQLite 删除数据后不会自动缩小数据库文件；需要压缩文件体积时运行 `mdgraph index --full`。

---

## Doctor — 文档健康度分析

`mdgraph doctor` 是一个基于规则的文档健康度检查工具。它分析图谱并报告：

在报告图谱健康状态之前，doctor 会先比较当前 Markdown 文件与 SQLite 索引。如果文件新增、删除、修改或 document id 变化，它会返回只读的 stale-index 诊断并提示先运行 `mdgraph index`，避免把当前文件和旧图谱数据混合成普通健康结论。

| 问题 | 说明 |
|------|------|
| **失效链接** | 指向不存在的文档或锚点的 Markdown 链接和 WikiLinks |
| **过期源码引用** | `source_refs` 条目中引用的文件在磁盘上已不存在 |
| **缺失定义** | 设计、ADR、API、运维手册和规格文档中没有任何入向定义边的情况 |
| **弱链接文档** | 非包含边少于 2 条的文档 — 图谱中潜在的孤立节点 |
| **孤立文档** | 非包含边为零的文档 — 完全与图谱断开连接 |
| **潜在矛盾** | 相同归一化名称的实体定义指向了多个不同文档（保留 — 索引期间尚未生成 `CONTRADICTS` 边） |
| **内容风险** | 标记的模式：提示注入文本、script/iframe HTML、活跃 data URI 和隐藏 Unicode 格式字符 |
| **规范告警** | 保守的 tag 和本地链接规范，例如小写 slug tag，以及 Markdown 链接中可跨平台的 `/` 分隔符 |
| **陈旧索引** | 当前 Markdown 文件与 `.mdgraph/graph.db` 不一致；依赖 doctor 结论前先运行 `mdgraph index` |
| **图健康** | 可解释的摘要：最连接的文档、弱链接、重复定义、缺失定义和缺失决策链接 |
| **存储健康** | 来自 `status --storage` 的可行动信号：生成/依赖路径组、过大的数据库、FTS shadow 膨胀、高度数节点和向量异常 |

```bash
node dist/bin/mdgraph.js doctor

# 示例输出：
# MDGraph health report
# Project: /your/project
# Documents: 42
# Orphan docs: 3
# Dead links: 2
# Stale source refs: 4
# Missing definitions: 1
# Weakly linked docs: 5
# Possible contradictions: 0
# Content risks: 1
# Stale index: 0
```

Doctor 检查旨在为维护者指出可能的清理工作 — 它们不是索引的阻塞条件。当任意 summary 问题都应该让命令失败时，可在 CI 或发布检查中使用 `mdgraph doctor --strict`；当希望按 warning 严重级别控制失败时，可使用 `--fail-on <severity>`。`--changed` 和 `--since <ref>` 会包含变更 Markdown 路径、rename/untracked/deleted 元数据，以及直接相关的一跳图谱文档；索引已刷新后，删除路径会作为 typed warning 报告。

---

## 库使用方式

MDGraph 可以以编程方式导入和使用：

```typescript
import {
  scanMarkdownFiles,
  parseMarkdownDocument,
  buildGraphRecords,
  searchGraph,
  buildContext,
  traceNodes,
  indexProject,
  GraphRepository,
  openDatabase,
  loadConfig,
  runDoctor
} from "mdgraph";

// 加载项目配置
const config = loadConfig("/path/to/project");

// 索引文档
const result = await indexProject("/path/to/project", { full: true, semantic: false });
console.log(`索引了 ${result.files} 个文件`);

// 打开仓库并查询
const repository = new GraphRepository(openDatabase("/path/to/project"));
try {
  const searchResults = searchGraph(repository, config, "authentication timeout");
  const context = buildContext(repository, config, "why does RedisTimeoutError affect login");
  const trace = traceNodes(repository, "AuthService", "RedisTimeoutError", 6);
} finally {
  repository.close();
}

// Doctor 分析
const report = await runDoctor("/path/to/project");
```

---

## 数据模型

SQLite 数据库位于 `.mdgraph/graph.db`，存储以下记录类型：

| 表 | 记录 |
|----|------|
| `documents` | 每个 Markdown 文件一行 — 路径、内容哈希、类型（spec/design/adr/api/runbook/incident/meeting/guide/memory/other）、信任层级（authored/generated/validated/external/untrusted）、元数据 |
| `sections` | 标题分隔的区域 — 锚点、层级、行范围、内容 |
| `entities` | 命名的符号 — 类型（symbol/api_route/error_code/config_key/file_path/command/package/concept/decision）、归一化名称、可选的命名空间 |
| `source_refs` | 文档引用的文件路径 — doctor 用于检测过期的引用 |
| `edges` | 图谱关系 — 类型（CONTAINS/DEFINES/REFERENCES/DEPENDS_ON/LINKS_TO/IMPLEMENTS/REFERENCES_SOURCE/SUPERSEDES/DEPRECATED_BY）、权重、置信度、来源（frontmatter/markdown_link/wikilink/declared_section/heading/inline_code/code_block/regex）、元数据 |
| `chunks` | 带有 token 估算的文本块 — 用于搜索和上下文打包 |
| `chunks_fts` | FTS5 全文索引，用于快速关键字搜索 |
| `chunk_vectors` | 可选的本地语义向量（默认 128 维） |

### 边类型

| 边类型 | 源 → 目标 | 来源 | 置信度 |
|--------|-----------|------|--------|
| `CONTAINS` | 文档 → 章节，章节 → 实体 | structure | 高 |
| `DEFINES` | 实体 → 块 | heading / frontmatter | 高 |
| `REFERENCES` | 文档 → 实体，章节 → 实体 | markdown_link / wikilink / inline_code | 高 |
| `DEPENDS_ON` | 文档 → 文档 | frontmatter `depends_on` | 显式 |
| `LINKS_TO` | 文档 → 文档，章节 → 章节 | markdown_link / wikilink | 高 |
| `IMPLEMENTS` | 文档 → 实体 | frontmatter `implements` | 显式 |
| `REFERENCES_SOURCE` | 文档 → SourceRef | frontmatter `source_refs` | 显式 |
| `SUPERSEDES` | 文档 → 文档 | frontmatter `supersedes` | 显式 |
| `DEPRECATED_BY` | 文档 → 文档 | frontmatter `deprecated_by` | 显式 |
| `SAME_AS` | （保留） | — | — |
| `RELATED_TO` | （保留） | — | — |
| `CONTRADICTS` | （保留） | — | — |

---

## 架构

| 模块 | 路径 | 职责 |
|------|------|------|
| CLI | `src/bin/mdgraph.ts` | 基于 Commander 的 CLI — init、index、status、search、context、node、trace、serve、watch、doctor |
| 配置 | `src/config/load-config.ts` | `.mdgraph/config.json` 创建、默认值、安全合并 |
| 扫描器 | `src/scanner/file-scanner.ts` | 基于 glob 的 Markdown 文件发现，可选支持 gitignore |
| 解析器 | `src/parser/*` | 前置元数据（yaml）、Markdown AST（remark-parse、GFM）、标题、链接、WikiLinks、代码块 |
| 提取 | `src/extraction/*` | 从解析的文档中提取实体；图谱记录组装 |
| 解析 | `src/resolution/link-resolver.ts` | 跨文档链接目标解析 |
| 存储 | `src/db/*` | SQLite 模式、连接、GraphRepository、记录替换、增量更新 |
| 查询 | `src/query/*` | FTS5 + 实体搜索排名、带图谱扩展的上下文打包、BFS 图谱追溯 |
| 语义 | `src/semantic/local-embedding.ts` | 确定性本地哈希向量生成和余弦相似度 |
| MCP | `src/mcp/*` | JSON-RPC stdio MCP 服务器、工具处理器、服务器指令 |
| 监听 | `src/watcher/file-watcher.ts` | 基于 Chokidar 的文件监听器，带防抖增量重新索引 |
| 分析 | `src/analysis/doctor.ts` | 基于规则的文档健康：失效链接、过期引用、孤立检测、内容风险 |

完整详情：[Architecture.md](../EN/Architecture.md) | [中文架构](Architecture.md)

---

## 环境要求

- **Node.js `>=22.5.0`** — 使用内置的 `node:sqlite` 模块
- **npm** — 用于安装和构建

在当前 Node 版本上，`node:sqlite` 可能会输出实验性启动警告。这是正常现象 — 该警告并不意味着运行失败。

---

## 当前的取舍

- **语义向量是确定性的，而非学习得到的** — 内置的 `local-hash` 提供者是轻量级嵌入，支持余弦评分，但不如专用嵌入模型的质量。语义搜索完全是可选的。
- **监听模式会更新数据库** — 启动时索引一次，之后在变更时增量更新。MCP 工具每次调用都会打开当前状态。
- **Doctor 检查基于规则** — 它们为维护者指出可能的清理工作，不是索引的阻塞条件。
- **存储诊断是报告，不是修复工具** — 使用 `status --storage` 检查增长信号，需要压缩时运行 `index --full`。
- **`SAME_AS`、`RELATED_TO` 和 `CONTRADICTS` 是保留的边类型** — 确定性的 MVP 在索引期间不会生成它们。类似矛盾的信号由 doctor 报告，而不是作为图谱边插入。
- **仅限于标准 Markdown** — MDX 和其他扩展 Markdown 方言尚未完全支持。

---

## 故障排查

**"未找到 MDGraph 索引"** — 首先运行 `node dist/bin/mdgraph.js init`，然后运行 `node dist/bin/mdgraph.js index`。

**索引速度慢** — 检查 `node_modules`、`dist` 和其他大目录是否在排除列表中。使用 `--debug` 或检查 `doctor` 输出。

**搜索没有结果** — 查询可能过于具体，或者语料库可能不包含匹配的术语。尝试更宽泛的术语，检查索引是否已构建（`mdgraph status`），并验证包含 glob 模式是否能获取到预期文件。

**MCP 服务器无法连接** — 确保项目已初始化并索引。验证 `--path` 参数指向了项目根目录。检查 `node:sqlite` 是否可用（Node 22.5+）。

**启动时出现实验性警告** — 这是 Node.js 对 `node:sqlite` 模块的警告。不影响功能。如果需要，可以使用 `--no-warnings` 抑制。

**监听模式检测不到变更** — 验证 chokidar 能否访问文件系统。在某些平台上，网络驱动器可能需要轮询模式。

**数据库文件持续增长** — 运行 `node dist/bin/mdgraph.js status --storage --json` 查找较大的路径分组、FTS shadow 对象、向量行和 freelist 页面。先验证排除规则；需要重建并压缩时运行 `node dist/bin/mdgraph.js index --full`。

---

## 评估问题

MDGraph 旨在回答以下类别的 AI 代理文档问题：

1. 为什么某个特定错误码会影响到特定的用户流程？
2. 某个设计文档依赖于哪些较老的决策？
3. 某个 API 路由在哪里定义，在哪里被引用？
4. 更改某个特定配置键会影响哪些运维手册或操作说明？
5. 哪些文档已被更新的设计所取代？
6. 哪些设计假设与某个特定的事故报告相关？
7. 哪些文档对应特定的源码路径？
8. 哪些文档提到了相同的实体但彼此之间没有链接？
9. 哪些设计文档缺少源码引用？
10. 从需求到实现，某个特定功能的完整文档链是什么？

完整评估方法论：[Evaluation_Questions.md](../EN/Evaluation_Questions.md) | [中文评估](Evaluation_Questions.md)

---

## 开发

```bash
npm run typecheck         # TypeScript 类型检查
npm test                  # 运行测试套件（Vitest）
npm run clean             # 删除 dist/
npm run build             # tsc + 资源复制
npm run smoke:cli         # 构建产物 CLI 冒烟检查
npm run smoke:pack        # npm pack 安装并运行冒烟检查
npm run test:watch        # 监听模式运行测试
```

---

## 许可证

MIT

---

<div align="center">

**为 AI 编码代理而生 — 将文档发现从多次文件读取减少为单次图谱查询。**

[架构文档](../EN/Architecture.md) · [评估](../EN/Evaluation_Questions.md) · [更新日志](../../CHANGELOG.md) · [中文版](README-ZH.md)

</div>
