# MDGraph 评估

这些问题将计划中的代理评估指导转化为可复用的冒烟测试集。在索引后，针对真实的项目文档语料库使用它们。

1. 为什么某个特定的错误码会影响特定的用户流程？
2. 给定的设计文档依赖于哪些早期决策？
3. 某个特定的 API 路由在哪里定义、又在哪里被引用？
4. 修改某个配置键会影响哪些运行手册或运维笔记？
5. 哪些文档已被更新的设计文档所取代？
6. 与某个事故报告相关的设计假设有哪些？
7. 哪些文档对应某个特定的源码路径？
8. 哪些文档提到了相同的实体但彼此之间没有链接？
9. 哪些设计文档缺少 `source_refs`？
10. 一个特定功能从需求到实现的完整文档链是什么？

## 参考语料库预期记录

仓库测试 fixture `createAlphaFixtureDocs` 定义了一组小型参考语料库。以下记录是确定性的冒烟预期，不代表已经完成真实代理 A/B 基准测试。

| ID | 查询重点 | 预期文档 | 预期实体 | 预期边 | 预期 source refs |
|---|---|---|---|---|---|
| 1 | `RedisTimeoutError` 对 `LoginFlow` 的影响 | `docs/redis-cache-design.md`, `docs/login-flow.md`, `docs/runbooks/auth-retry-runbook.md` | `RedisTimeoutError`, `LoginFlow`, `AuthRetryRunbook` | `REFERENCES`, `DEPENDS_ON` | `src/cache/redis.ts`, `scripts/restart-auth.ps1` |
| 2 | `Auth v2 Design` 依赖的较早决策 | `docs/auth-v2-design.md`, `docs/adr/adr-001-cache-failure-policy.md`, `docs/redis-cache-design.md` | `AuthService`, `CacheFailurePolicy`, `RedisTimeoutError` | `DEPENDS_ON`, `DEFINES` | `src/auth/AuthService.ts`, `src/cache/redis.ts` |
| 3 | `GET /api/auth/login` 的定义和引用 | `docs/api/login-api.md`, `docs/login-flow.md`, `docs/auth-v2-design.md` | `GET /api/auth/login`, `AuthService`, `RedisTimeoutError` | `DEFINES`, `IMPLEMENTS`, `DEPENDS_ON` | `src/routes/auth.ts` |
| 4 | `AUTH_RETRY_LIMIT` 的运维影响 | `docs/runbooks/auth-retry-runbook.md`, `docs/redis-cache-design.md`, `docs/login-flow.md` | `AUTH_RETRY_LIMIT`, `AuthRetryRunbook`, `LoginFlow` | `REFERENCES`, `DEPENDS_ON` | `scripts/restart-auth.ps1` |
| 5 | 被取代的设计文档 | `docs/auth-v2-design.md`, `docs/auth-v3-design.md` | `AuthService`, `AuthServiceV3` | `SUPERSEDES`, `DEPRECATED_BY` | `src/auth/AuthService.ts`, `src/auth/AuthServiceV3.ts` |
| 6 | 与事故相关的设计假设 | `docs/incidents/redis-timeout-incident.md`, `docs/redis-cache-design.md`, `docs/runbooks/auth-retry-runbook.md` | `RedisTimeoutError`, `LoginFlow`, `AuthRetryRunbook` | `DEPENDS_ON`, `REFERENCES` | `src/cache/redis.ts`, `scripts/restart-auth.ps1` |
| 7 | `src/routes/auth.ts` 对应的文档 | `docs/api/login-api.md`, `docs/login-flow.md` | `GET /api/auth/login`, `LoginFlow` | `IMPLEMENTS`, `DEPENDS_ON` | `src/routes/auth.ts` |
| 8 | 提到相同实体但没有直接链接的文档 | `docs/redis-cache-design.md`, `docs/incidents/redis-timeout-incident.md`, `docs/runbooks/auth-retry-runbook.md` | `RedisTimeoutError`, `LoginFlow` | `REFERENCES`, 图邻居扩展 | `src/cache/redis.ts`, `scripts/restart-auth.ps1` |
| 9 | 缺少 `source_refs` 的设计文档 | 预期 `docs/auth-v3-design.md` 通过 `IMPLEMENTS` 关联源码；干净语料库中不预期存在 stale source ref | `AuthServiceV3` | `IMPLEMENTS` | `src/auth/AuthServiceV3.ts` |
| 10 | 登录功能从需求到实现的文档链 | `docs/login-flow.md`, `docs/api/login-api.md`, `docs/auth-v2-design.md`, `docs/redis-cache-design.md`, `docs/adr/adr-001-cache-failure-policy.md` | `LoginFlow`, `GET /api/auth/login`, `AuthService`, `RedisTimeoutError`, `CacheFailurePolicy` | `DEPENDS_ON`, `IMPLEMENTS`, `DEFINES` | `src/routes/auth.ts`, `src/auth/AuthService.ts`, `src/cache/redis.ts` |

## 测量说明

对于每个问题，对比附加 MDGraph 前后代理的行为：

- 最终答案是否引用了正确的文档。
- 避免了多少次直接的文件读取或文本搜索。
- 答案是否包含可解释的图路径。
- MDGraph 返回的上下文是否足够，无需进一步检查文件。
- 整个代理运行的时间和工具调用次数。

当前仓库已有单元测试、集成测试、MCP 测试、CLI 测试、语义测试、增量测试和 doctor 测试，但尚未针对这些问题运行真实的代理 A/B 基准测试。