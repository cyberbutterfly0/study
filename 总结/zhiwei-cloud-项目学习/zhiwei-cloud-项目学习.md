# zhiwei-cloud 项目学习

从 `E:\study\zhiwei-cloud` 源码和配置里读出来的东西——和云效知识库分工不同：

- **云效知识库** = 团队文档原文（规范、工具手册、项目理念）
- **这里** = 代码实际长什么样（真实版本号、模块结构、框架层实现、坑）

有冲突时以这里为准，因为这里是对着 pom 和源码核过的。

## 目录

| 章 | 内容 | 什么时候看 |
|---|---|---|
| 第 1 章 | 模块结构与端口 | 想知道哪个模块干什么、端口怎么分 |
| 第 2 章 | 启动流程 | 第一次把服务跑起来 |
| 第 3 章 | 数据库连接 | 连 PolarDB、IDEA 里挂数据源 |
| 第 4 章 | 配置体系 | 改配置不知道改哪层、Nacos 配置没生效 |
| 第 5 章 | 框架层代码 | 看 Ret / 异常 / traceId / i18n / 参数校验 / 操作日志 / 安全链怎么实现的 |
| 第 6 章 | 网关与 Feign | 请求怎么进网关、服务间怎么调 |
| 第 7 章 | 已知坑 | 踩之前先看一眼 |
| 第 8 章 | 前端项目 | 启动管理端、前端目录结构、和旧截图的差别 |
| 第 9 章 | 团队开发规范 | 写代码前对齐命名/质量/团队文化，以及仓库自带的 AI 治理体系 |

## 架构图

[zhiwei-cloud-架构图.html](zhiwei-cloud-架构图.html) —— 一张图把「工程结构 → 运行时服务 → 数据与注册中心」串起来，双击用浏览器打开，可悬停看连线。

## 项目现状

骨架阶段：框架层、网关、system、infra 有真代码；pay、member、booking、wx、mall 只有目录和 pom，Java 文件还是 IDEA 生成的 `Main.java`。

**安全已经有实现，不是空的**：`zhiwei-spring-boot-starter-security` 里的 `SecurityAutoConfiguration` 提供 `SecurityFilterChain`（CSRF 关、无状态 Session、白名单 permitAll、其余 authenticated、JWT 过滤器）；但 JWT 签名密钥只有代码里的默认值，12 个 `application*.yml` 全都没覆盖（见第 5 章十一、坑 #20）。

- 版本以根 `pom.xml` 为准（和云效文档写的版本有出入，见第 1 章）
- 最后核对：2026-11-08（本地分支 `c-1.1`，HEAD `e8866c3`，与团队 `origin/master` 一致；11-07 之后是否有新提交未验证，本地 `git fetch` 跑不了）

2026-11-01 拉 master 后新增的东西：

- **前端项目** `zhiwei-frontend/`（vben-admin 管理端 + uniapp 工作端/用户端），启动见第 8 章
- **AI 治理模块** `zhiwei-ai-governance/`（规范文档：`standards/api-naming.md` 等）
- **数据库脚本** `sql/`（`nacos-mysql-schema.sql`、`template_biz_table.sql`、`base/`）
- 根目录新增 `.env` / `.env.example`（配置从代码里挪到环境变量）、`lefthook.yml`、`AGENTS.md`
- Nacos 服务端升级到 `nacos/nacos-server:v3.3.0-RC`（负责人说 3.3 带 AI MCP 功能）

2026-11-02 开完会后 master 又推了 8 个提交（`7142020..64ceb05`），规模 238 files changed / +6650 / −3785：

- **Feign 契约整改** `9b937dc`：所有 `-api` 接口去掉类级 `@RequestMapping`、改 `@FeignClient(path=...)`；`-server` Controller 加类级 `@RequestMapping` + 方法 `@Override`（原因见第 6 章、坑 #14）
- **system-api 补 17 个 Feign 接口**：`SysAuthApi`、`SysUserApi`、`SysRoleApi`、`SysMenuApi`、`SysDeptApi`、`SysPostApi`、`SysDictTypeApi`、`SysDictDataApi`、`SysConfigApi`、`SysNoticeApi`、`SysLoginLogApi`、`SysOperateLogApi`、`SysOrganizationApi`、`SysOrgPackageApi`、`SysOrgMenuApi`；infra-api 补 `FeignTestApi`、`FileApi`、`FileConfigApi`、`InfraHealthApi`
- **system-server 重构**：`controller/admin/*` 全部去掉 admin 目录、改名 `SysXxxController`；新增 `convert/SysXxxConverter`（`@Builder` 风格）；新增 `SysOrgMenu` 实体 + Mapper + Service；`AuthServiceImpl`(92 行)、`SysUserServiceImpl`(199 行)、`SysMenuServiceImpl`(130 行) 大改
- **数据库** `c974748`：`sql/base/20261031_01_zhiwei_base_tables.sql` 重命名，新增 `20261102_01_zhiwei_base_deleted_alter.sql`、`20261102_02_zhiwei_base_org_menu.sql`、`20261102_03_zhiwei_base_init_data.sql`、`sql/base/STRUCTURE.md`
- **其他**：`2665413` 统一时间返回说明、`b8a8b8f` Stream 用 for 处理、`b7bc9d5` Converter 用 `@Builder`、`e45374d` 调整授权方案、`64ceb05` 格式化代码、`6100b0e` 调整目录结构
- ai-governance 同步大改：新增 `decisions/004-menu-tenant-isolation.md`、`standards/api-module-structure.md`、`reports/api-module-structure-rectification-plan.md`、`reports/menu-tenant-isolation-plan.md`、`reports/sys-org-menu-design.md`
- 云效知识库同一天更新：「开发规范」新分组加 2 篇、基础信息补 2 篇、工具手册加了空的 RocketMQ 手册——全部整理进第 9 章

2026-11-03 ~ 11-06 又推了 22 个提交（`64ceb05..e8866c3`），主题集中在四件事：

- **配置外置** `0d75bc6` + `5ed3448` + `fde7738`：`.env` 移出版本控制，仓库只留 `.env.example`；切库改环境变量后，新同事要自己复制一份 `.env`（见第 2、4 章）
- **操作日志链路** `e46262a` → `0c007a6` → `1957731`：拦截器下沉到 `zhiwei-spring-boot-starter-security`，system/infra 各写一个 `OperateLogWriter` 落库，网关补统一错误响应（见第 5、6 章）
- **参数校验与异常** `aeb54d1` + `e46262a`：新增 `Args` 工具类（`common/Args.java`）替代 `Objects.requireNonNull`；`ServiceException` 支持 i18n 占位符与按 `ErrorCode` 推导 HTTP 码；`GlobalExceptionHandler` 补 405 / 400 / 上传超限 / 分布式锁 409
- **规范文档成体系** `f668fa2`、`80cf72b`、`103eecd`、`aeb54d1` 等：`zhiwei-ai-governance/standards/` 扩到 17 篇（执行边界、提前返回、DB 操作提取、参数校验、JavaDoc、命名），并加 5 个 Python 检查脚本（见第 9 章）

另外两个结构性变化：

- **前端拆独立仓库** `e8866c3`：`zhiwei-frontend/` 移出父仓库，独立远程 origin；父仓库不再跟踪，但根 `AGENTS.md` 里仍指向 `zhiwei-frontend/AGENTS.md`（引用已失效，见第 8 章、坑 #16）
- **数据库脚本重整** `4c53ed8` + `870dcb6`：`sql/base/` 按日期命名成套，逻辑删除统一 `deleted = id`、唯一索引必须含 `deleted`，system 侧补 6 张表的索引修复脚本（见第 3 章）
