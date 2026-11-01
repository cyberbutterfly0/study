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
| 第 5 章 | 框架层代码 | 看 Ret / 异常 / traceId / i18n 怎么实现的 |
| 第 6 章 | 网关与 Feign | 请求怎么进网关、服务间怎么调 |
| 第 7 章 | 已知坑 | 踩之前先看一眼 |
| 第 8 章 | 前端项目 | 启动管理端、前端目录结构、和旧截图的差别 |

## 架构图

[zhiwei-cloud-架构图.html](zhiwei-cloud-架构图.html) —— 一张图把「工程结构 → 运行时服务 → 数据与注册中心」串起来，双击用浏览器打开，可悬停看连线。

## 项目现状

骨架阶段：框架层、网关、system、infra 有真代码；pay、member、booking、wx、mall 只有目录和 pom，Java 文件还是 IDEA 生成的 `Main.java`。

- 版本以根 `pom.xml` 为准（和云效文档写的版本有出入，见第 1 章）
- 最后核对：2026-11-01（已从本地 `c-1.1` 切到 `master`，拉到团队 16 个新提交）

2026-11-01 拉 master 后新增的东西：

- **前端项目** `zhiwei-frontend/`（vben-admin 管理端 + uniapp 工作端/用户端），启动见第 8 章
- **AI 治理模块** `zhiwei-ai-governance/`（规范文档：`standards/api-naming.md` 等）
- **数据库脚本** `sql/`（`nacos-mysql-schema.sql`、`template_biz_table.sql`、`base/`）
- 根目录新增 `.env` / `.env.example`（配置从代码里挪到环境变量）、`lefthook.yml`、`AGENTS.md`
- Nacos 服务端升级到 `nacos/nacos-server:v3.3.0-RC`（负责人说 3.3 带 AI MCP 功能）
