import fs from "node:fs";
import path from "node:path";

export function createFixtureDocs(root: string): void {
  const docsDir = path.join(root, "docs");
  fs.mkdirSync(docsDir, { recursive: true });

  fs.writeFileSync(path.join(docsDir, "redis-cache-design.md"), [
    "---",
    "id: redis-cache-design",
    "title: Redis Cache Design",
    "type: design",
    "defines:",
    "  - RedisTimeoutError",
    "---",
    "# Redis Cache Design",
    "",
    "## Defines",
    "",
    "- `RedisTimeoutError`: Redis timeout surfaced to callers.",
    ""
  ].join("\n"), "utf8");

  fs.writeFileSync(path.join(docsDir, "auth-v2-design.md"), [
    "---",
    "id: auth-v2-design",
    "title: Auth v2 Design",
    "type: design",
    "defines:",
    "  - AuthService",
    "depends_on:",
    "  - redis-cache-design",
    "implements:",
    "  - src/auth/AuthService.ts",
    "---",
    "# Auth v2 Design",
    "",
    "## Session Refresh",
    "",
    "`AuthService` handles `RedisTimeoutError` during session refresh.",
    ""
  ].join("\n"), "utf8");
}

export function createAlphaFixtureDocs(root: string): void {
  const docsDir = path.join(root, "docs");
  const adrDir = path.join(docsDir, "adr");
  const apiDir = path.join(docsDir, "api");
  const runbookDir = path.join(docsDir, "runbooks");
  const incidentDir = path.join(docsDir, "incidents");
  const srcAuthDir = path.join(root, "src", "auth");
  const srcCacheDir = path.join(root, "src", "cache");
  const srcRoutesDir = path.join(root, "src", "routes");
  const scriptsDir = path.join(root, "scripts");
  fs.mkdirSync(adrDir, { recursive: true });
  fs.mkdirSync(apiDir, { recursive: true });
  fs.mkdirSync(runbookDir, { recursive: true });
  fs.mkdirSync(incidentDir, { recursive: true });
  fs.mkdirSync(srcAuthDir, { recursive: true });
  fs.mkdirSync(srcCacheDir, { recursive: true });
  fs.mkdirSync(srcRoutesDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(path.join(srcAuthDir, "AuthService.ts"), "export class AuthService {}\n", "utf8");
  fs.writeFileSync(path.join(srcAuthDir, "AuthServiceV3.ts"), "export class AuthServiceV3 {}\n", "utf8");
  fs.writeFileSync(path.join(srcCacheDir, "redis.ts"), "export class RedisTimeoutError extends Error {}\n", "utf8");
  fs.writeFileSync(path.join(srcRoutesDir, "auth.ts"), "export const loginRoute = '/api/auth/login';\n", "utf8");
  fs.writeFileSync(path.join(scriptsDir, "restart-auth.ps1"), "Write-Output 'restart auth'\n", "utf8");

  fs.writeFileSync(path.join(adrDir, "adr-001-cache-failure-policy.md"), [
    "---",
    "id: adr-001-cache-failure-policy",
    "title: Cache Failure Policy ADR",
    "type: adr",
    "defines:",
    "  - CacheFailurePolicy",
    "---",
    "# Cache Failure Policy ADR",
    "",
    "## Decision",
    "",
    "`CacheFailurePolicy` requires login to fail closed when cache timeout data is unreliable.",
    ""
  ].join("\n"), "utf8");

  fs.writeFileSync(path.join(docsDir, "redis-cache-design.md"), [
    "---",
    "id: redis-cache-design",
    "title: Redis Cache Design",
    "type: design",
    "defines:",
    "  - RedisTimeoutError",
    "depends_on:",
    "  - adr-001-cache-failure-policy",
    "source_refs:",
    "  - src/cache/redis.ts",
    "---",
    "# Redis Cache Design",
    "",
    "## Timeout Handling",
    "",
    "`RedisTimeoutError` follows `CacheFailurePolicy` and returns retry guidance to callers.",
    ""
  ].join("\n"), "utf8");

  fs.writeFileSync(path.join(docsDir, "auth-v2-design.md"), [
    "---",
    "id: auth-v2-design",
    "title: Auth v2 Design",
    "type: design",
    "status: superseded",
    "defines:",
    "  - AuthService",
    "depends_on:",
    "  - redis-cache-design",
    "  - adr-001-cache-failure-policy",
    "implements:",
    "  - src/auth/AuthService.ts",
    "deprecated_by:",
    "  - auth-v3-design",
    "---",
    "# Auth v2 Design",
    "",
    "## Session Refresh",
    "",
    "`AuthService` handles `RedisTimeoutError` during login session refresh.",
    "See [login API](api/login-api.md).",
    ""
  ].join("\n"), "utf8");

  fs.writeFileSync(path.join(docsDir, "auth-v3-design.md"), [
    "---",
    "id: auth-v3-design",
    "title: Auth v3 Design",
    "type: design",
    "defines:",
    "  - AuthServiceV3",
    "depends_on:",
    "  - redis-cache-design",
    "implements:",
    "  - src/auth/AuthServiceV3.ts",
    "supersedes:",
    "  - auth-v2-design",
    "---",
    "# Auth v3 Design",
    "",
    "## Session Refresh",
    "",
    "`AuthServiceV3` preserves the cache timeout behavior from [[auth-v2-design#session-refresh]].",
    ""
  ].join("\n"), "utf8");

  fs.writeFileSync(path.join(apiDir, "login-api.md"), [
    "---",
    "id: login-api",
    "title: Login API",
    "type: api",
    "defines:",
    "  - GET /api/auth/login",
    "depends_on:",
    "  - auth-v2-design",
    "implements:",
    "  - src/routes/auth.ts",
    "---",
    "# Login API",
    "",
    "`GET /api/auth/login` calls `AuthService` and surfaces retryable `RedisTimeoutError` responses.",
    ""
  ].join("\n"), "utf8");

  fs.writeFileSync(path.join(docsDir, "login-flow.md"), [
    "---",
    "id: login-flow",
    "title: Login Flow",
    "type: spec",
    "defines:",
    "  - LoginFlow",
    "depends_on:",
    "  - login-api",
    "---",
    "# Login Flow",
    "",
    "`LoginFlow` uses `GET /api/auth/login` and observes `RedisTimeoutError` as a retryable result.",
    ""
  ].join("\n"), "utf8");

  fs.writeFileSync(path.join(runbookDir, "auth-retry-runbook.md"), [
    "---",
    "id: auth-retry-runbook",
    "title: Auth Retry Runbook",
    "type: runbook",
    "defines:",
    "  - AuthRetryRunbook",
    "depends_on:",
    "  - redis-cache-design",
    "source_refs:",
    "  - scripts/restart-auth.ps1",
    "---",
    "# Auth Retry Runbook",
    "",
    "Operators use `AuthRetryRunbook` when `RedisTimeoutError` affects `LoginFlow`.",
    "Set `AUTH_RETRY_LIMIT` conservatively before restarting auth workers.",
    ""
  ].join("\n"), "utf8");

  fs.writeFileSync(path.join(incidentDir, "redis-timeout-incident.md"), [
    "---",
    "id: redis-timeout-incident",
    "title: Redis Timeout Incident",
    "type: incident",
    "depends_on:",
    "  - redis-cache-design",
    "---",
    "# Redis Timeout Incident",
    "",
    "The incident showed `RedisTimeoutError` can slow `LoginFlow` and trigger `AuthRetryRunbook`.",
    ""
  ].join("\n"), "utf8");
}

export function createCjkFixtureDocs(root: string): void {
  const docsDir = path.join(root, "docs");
  const zhDir = path.join(docsDir, "zh");
  const zhApiDir = path.join(zhDir, "api");
  const zhRunbooksDir = path.join(zhDir, "runbooks");
  const jaDir = path.join(docsDir, "ja");
  const srcAuthDir = path.join(root, "src", "auth");
  const srcCacheDir = path.join(root, "src", "cache");
  const srcPaymentDir = path.join(root, "src", "payment");
  const srcRoutesDir = path.join(root, "src", "routes");
  const scriptsDir = path.join(root, "scripts");
  fs.mkdirSync(zhApiDir, { recursive: true });
  fs.mkdirSync(zhRunbooksDir, { recursive: true });
  fs.mkdirSync(jaDir, { recursive: true });
  fs.mkdirSync(srcAuthDir, { recursive: true });
  fs.mkdirSync(srcCacheDir, { recursive: true });
  fs.mkdirSync(srcPaymentDir, { recursive: true });
  fs.mkdirSync(srcRoutesDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });

  fs.writeFileSync(path.join(srcAuthDir, "AuthService.ts"), "export class AuthService {}\n", "utf8");
  fs.writeFileSync(path.join(srcCacheDir, "redis.ts"), "export class RedisTimeoutError extends Error {}\n", "utf8");
  fs.writeFileSync(path.join(srcPaymentDir, "risk.ts"), "export class RiskCheckService {}\n", "utf8");
  fs.writeFileSync(path.join(srcRoutesDir, "auth.ts"), "export const loginRoute = '/api/zh/login';\n", "utf8");
  fs.writeFileSync(path.join(scriptsDir, "restart-auth.ps1"), "Write-Output 'restart auth'\n", "utf8");

  fs.writeFileSync(path.join(zhDir, "cache-timeout-design.md"), [
    "---",
    "id: zh-cache-timeout-design",
    "title: 缓存超时策略",
    "type: design",
    "defines:",
    "  - 缓存超时策略",
    "  - Redis缓存超时",
    "source_refs:",
    "  - src/cache/redis.ts",
    "---",
    "# 缓存超时处理",
    "",
    "缓存超时处理说明了 Redis 缓存超时如何影响登录流程。",
    ""
  ].join("\n"), "utf8");

  fs.writeFileSync(path.join(zhDir, "login-flow.md"), [
    "---",
    "id: zh-login-flow",
    "title: 登录流程",
    "type: spec",
    "defines:",
    "  - 登录流程",
    "depends_on:",
    "  - zh-login-api",
    "  - zh-cache-timeout-design",
    "---",
    "# 登录流程",
    "",
    "登录流程会调用 [登录接口](api/login-api.md)，当 Redis缓存超时时进入认证重试运行手册。",
    ""
  ].join("\n"), "utf8");

  fs.writeFileSync(path.join(zhApiDir, "login-api.md"), [
    "---",
    "id: zh-login-api",
    "title: 登录接口",
    "type: api",
    "defines:",
    "  - POST /api/zh/login",
    "  - 登录接口",
    "depends_on:",
    "  - zh-cache-timeout-design",
    "implements:",
    "  - src/routes/auth.ts",
    "---",
    "# 登录接口",
    "",
    "`POST /api/zh/login` 读取 `AuthService` 并在 Redis缓存超时 时返回可重试结果。",
    ""
  ].join("\n"), "utf8");

  fs.writeFileSync(path.join(zhRunbooksDir, "auth-retry-runbook.md"), [
    "---",
    "id: zh-auth-retry-runbook",
    "title: 认证重试运行手册",
    "type: runbook",
    "defines:",
    "  - 认证重试运行手册",
    "  - AUTH_RETRY_LIMIT",
    "depends_on:",
    "  - zh-cache-timeout-design",
    "  - zh-login-flow",
    "source_refs:",
    "  - scripts/restart-auth.ps1",
    "---",
    "# 认证重试运行手册",
    "",
    "当登录流程遇到 Redis缓存超时时，运维人员会使用认证重试运行手册。",
    "设置 `AUTH_RETRY_LIMIT` 之前先确认缓存超时策略。",
    ""
  ].join("\n"), "utf8");

  fs.writeFileSync(path.join(jaDir, "payment-risk.md"), [
    "---",
    "id: ja-payment-risk",
    "title: 決済リスク設計",
    "type: design",
    "defines:",
    "  - 決済リスク設計",
    "  - RiskCheckService",
    "implements:",
    "  - src/payment/risk.ts",
    "---",
    "# 決済リスク設計",
    "",
    "決済リスク設計は RiskCheckService で高リスク取引を判定する。",
    ""
  ].join("\n"), "utf8");
}
