# zhiwei-cloud 项目学习笔记

- 状态: 进行中
- 最后更新: 2026-10-25
- 待解决: 0
- 主题一句话: 知微 SaaS 微服务脚手架的模块结构、启动流程、配置体系、数据库连接与框架层代码。

> 来源：`E:\study\zhiwei-cloud` 源码与配置里的教学注释（负责人 liming 编写）
> 整理时间：2026-10-25
> 用途：把这套脚手架的"设计意图"系统化，方便开工前通读一遍

---

## 一、项目是什么

知微 SaaS，基于 Spring Cloud Alibaba 的微服务脚手架。当前是**骨架阶段**：框架层、网关、system、infra 有真代码，其余业务模块（pay、member、booking、wx、mall）只有目录和 pom，Java 文件还是 IDEA 生成的 `Main.java`。

### 技术栈（版本以根 pom 为准）

| 组件 | 版本 | 用途 |
|------|------|------|
| JDK | 27 | 运行环境（Eclipse Temurin） |
| Spring Boot | 4.1.2 | 应用框架 |
| Spring Cloud | 2025.1.3 | 微服务基础设施 |
| Spring Cloud Alibaba | 2025.1.0.0 | Nacos/Sentinel 集成 |
| Nacos | 服务端 2.4.3 / 客户端 3.1.1 | 注册中心 + 配置中心 |
| Spring Cloud Gateway | 5.0.3 | API 网关（WebFlux 版） |
| OpenFeign | 随 SC | 声明式 HTTP 调用 |
| MyBatis-Plus | 3.5.17 | ORM |
| Druid | 1.2.28 | 连接池 |
| Redisson | 4.8.0 | Redis 客户端 + 分布式锁 |
| Lombok / MapStruct / Hutool | 1.18.48 / 1.7.0.Beta2 / 5.8.48 | 工具 |
| SpringDoc + Knife4j | 3.1.1 / 4.5.0 | API 文档 |

---

## 二、模块地图

### 分层

```
根 pom（版本管理 + BOM + 聚合）
├── zhiwei-dependencies      BOM 模块，统一依赖版本，可对外发布
├── zhiwei-framework         公共框架聚合（6 个 starter，全部是 jar，不独立启动）
│   ├── zhiwei-common                    最底层：Ret 统一返回、ErrorCode、ServiceException
│   ├── zhiwei-spring-boot-starter-web   Web 层：全局异常、i18n、traceId
│   ├── zhiwei-spring-boot-starter-mybatis
│   ├── zhiwei-spring-boot-starter-redis
│   ├── zhiwei-spring-boot-starter-security
│   └── zhiwei-spring-boot-starter-biz-tenant
├── zhiwei-gateway            API 网关（可独立启动）
├── zhiwei-module-system      系统管理：用户/角色/菜单/权限/租户/字典
├── zhiwei-module-infra       基础设施：文件存储/参数配置/操作日志
├── zhiwei-module-pay         支付（骨架）
├── zhiwei-module-member      会员（骨架，子模块目录名 seven 疑似笔误）
├── zhiwei-module-booking     预约（骨架，子模块目录名 sever 疑似笔误）
├── zhiwei-module-wx          微信（骨架）
└── zhiwei-module-mall        商城（骨架）
```

**约定**：聚合模块是 Pom，子模块是 `<parent>-api`（DTO + Feign 接口，被别的模块依赖）和 `<parent>-server`（Controller/Service/Mapper，可独立启动）。

### 端口约定（都在 4808x 段，避开 8080）

| 服务 | 端口 | 说明 |
|------|------|------|
| zhiwei-gateway | 48080 | 网关，所有请求入口 |
| zhiwei-system-server | 48081 | 系统管理 |
| zhiwei-infra-server | 48082 | 基础设施 |

---

## 三、启动环境（完整流程）

### 3.1 前置条件

```powershell
java -version        # 要 JDK 27（不是 17）
mvn -v               # 要 Maven 3.9+
docker --version     # Docker Desktop 已启动
```

### 3.2 第一步：起中间件（Redis + Nacos）

```powershell
cd E:\study\zhiwei-cloud
docker compose up -d
docker compose ps
```

`docker-compose.yml` 里只有两个服务：

- `zhiwei-redis` → `redis:7.4-alpine`，映射 6379
- `zhiwei-nacos` → `nacos/nacos-server:v2.4.3`，映射 8848（控制台）、9848（客户端 gRPC）

**MySQL 不在 compose 里**，Nacos 和业务都连外部阿里云 PolarDB（见下一节）。

Nacos 控制台：<http://localhost:8848/nacos>，账号密码都是 `nacos`。

> 判断 Nacos 是否起好：`docker compose logs -f nacos`，看到 `Nacos started successfully` 即可。

### 3.3 第二步：构建

```powershell
cd E:\study\zhiwei-cloud
mvn clean install -DskipTests
```

首次要下载依赖，耗时长。`target` 目录出现即成功。

### 3.4 第三步：启动服务

**顺序**：system-server → infra-server → gateway（gateway 最后，它只是转发）。

方式 A（推荐，开发时用）：IDEA 里直接运行主类

- `cloud.zhiwei.system.SystemServerApplication`
- `cloud.zhiwei.infra.InfraServerApplication`
- `cloud.zhiwei.gateway.GatewayApplication`

方式 B：命令行。注意各 pom **没有声明 `spring-boot-maven-plugin`**，所以 `mvn spring-boot:run` 会报 `No plugin found for prefix 'spring-boot'`。要用全限定坐标：

```powershell
cd zhiwei-module-system\zhiwei-module-system-server
mvn org.springframework.boot:spring-boot-maven-plugin:4.1.2:run
```

### 3.5 第四步：验证

```powershell
# 系统服务
curl http://localhost:48081/api/system/health
# → {"httpCode":200,"code":0,"data":"system-server is running",...}

# 基础设施服务
curl http://localhost:48082/api/infra/health
# → infra-server is running

# Feign 跨服务调用（infra 调 system）
curl http://localhost:48082/api/infra/call-system

# 走网关（发现路由自动转发）
curl http://localhost:48080/zhiwei-system-server/api/system/health
```

---

## 四、数据库连接

### 4.1 开发环境连接信息

| 项 | 值 |
|----|-----|
| 类型 | 阿里云 PolarDB（MySQL 8.0 兼容） |
| 主机 | `ydmap-ops.mysql.polardb.rds.aliyuncs.com` |
| 端口 | `3306` |
| 数据库 | `test_ming_study`（开发环境统一库） |
| 用户名 | `ydmap_dev` |
| 密码 | `lkjwe98821!!@lkjl133`（开发共享账号，见 `application-dev.yml`） |
| 连接参数 | `useSSL=false&serverTimezone=Asia/Shanghai&allowPublicKeyRetrieval=true` |

三条服务（system / infra / gateway）用的都是这一套，写在各自的 `application-dev.yml` 里。

### 4.2 用图形客户端连（Navicat / DBeaver / IDEA Database）

以 IDEA 为例：右侧 **Database** 面板 → `+` → Data Source → MySQL：

- Host: `ydmap-ops.mysql.polardb.rds.aliyuncs.com`
- Port: `3306`
- Database: `test_ming_study`
- User: `ydmap_dev`
- Password: `lkjwe98821!!@lkjl133`
- 点 **Test Connection**，成功即通

**连不上先查白名单**：PolarDB 默认有 IP 白名单，家里/公司出口 IP 变了就连不上，要让负责人把新 IP 加进白名单（或在阿里云控制台加）。报错通常是 `Connection timed out` 或 `Access denied`。

命令行版本（装了 mysql 客户端）：

```powershell
mysql -h ydmap-ops.mysql.polardb.rds.aliyuncs.com -P 3306 -u ydmap_dev -p test_ming_study
# 输入密码时 password 里的 !! 和 @ 由 mysql 自己处理，不用转义
```

### 4.3 代码里怎么配置的

`application-dev.yml`：

```yaml
spring:
  datasource:
    url: jdbc:mysql://ydmap-ops.mysql.polardb.rds.aliyuncs.com:3306/test_ming_study?useSSL=false&serverTimezone=Asia/Shanghai&allowPublicKeyRetrieval=true
    username: ydmap_dev
    password: lkjwe98821!!@lkjl133
    driver-class-name: com.mysql.cj.jdbc.Driver
```

JDBC URL 参数逐个解释：

- `jdbc:mysql://` — 协议前缀，告诉 Java 用 MySQL 驱动
- `useSSL=false` — 内网连接不加密，省握手开销（生产用 `true`）
- `serverTimezone=Asia/Shanghai` — 时区东八区，否则时间字段差 8 小时
- `allowPublicKeyRetrieval=true` — MySQL 8 的 caching_sha2_password 认证需要取公钥

### 4.4 三个环境的数据库差异

| 环境 | 库名 | 地址来源 | 密码来源 |
|------|------|----------|----------|
| dev | `test_ming_study` | 硬编码 PolarDB 域名 | 明文写在文件里 |
| test | `zhiwei_test` | `${DB_HOST:127.0.0.1}` 环境变量 | `${DB_PASS:zhiwei_test}` 带默认值 |
| prod | `zhiwei` | `${DB_HOST:127.0.0.1}` 无默认值 | `${DB_PASS}` 无默认值，没设就启动失败 |

这是刻意设计的：生产环境宁可启动失败，也不能用错配置连错库。

### 4.5 Nacos 的数据库

Nacos 自己也用 MySQL 存配置（容器里那份，不是 PolarDB 上这个业务库）：

- `docker-compose.yml` 里 `MYSQL_SERVICE_HOST` 指向 `ydmap-ops.mysql.polardb.rds.aliyuncs.com`
- `MYSQL_SERVICE_DB_NAME=nacos_ming`，用户 `ydmap_dev`
- 建表脚本在仓库 `sql/nacos-mysql-schema.sql`（来自 Nacos 2.4.3 官方，172 行）
- 注意脚本头注释写的是 `USE test_ming_study;`，但 compose 实际用的库名是 `nacos_ming`，执行前要按实际库改

---

## 五、配置体系：三层叠加

```
application.yml               公共配置（服务名、激活哪个 profile、Nacos 地址）
  ↓ 被覆盖
application-{profile}.yml     环境专属（端口、数据源、Redis、日志级别）
  ↓ 再覆盖
Nacos 里的 dataId 配置         zhiwei-gateway-dev.yaml 等，运行时从配置中心拉
```

关键机制：

1. **profile 切换**：`application.yml` 里 `spring.profiles.active: dev` 决定加载哪个环境文件
2. **Nacos 配置导入**：Spring Cloud 2025.x 废除了 `bootstrap.yml`，改成在 `application.yml` 里显式写 `spring.config.import: nacos:zhiwei-gateway-${spring.profiles.active}.yaml`
3. **缺配置不致命**：Nacos 里没有对应的 dataId 时**不会启动失败**，只打 WARN：`NacosConfigDataLoader - config[dataId=...] is empty`。所以首次启动前不用先去 Nacos 建配置文件，但业务参数会缺失
4. **环境变量注入**：`${DB_HOST:127.0.0.1}` 冒号前是环境变量名、后面是默认值

---

## 六、框架层代码讲解（zhiwei-common + starter-web）

### Ret&lt;T&gt; — 统一响应体

所有 Controller 都返回 `Ret<T>`，结构：

```json
{ "httpCode": 200, "code": 0, "msg": null, "data": ..., "requestId": "a1b2c3...", "timestamp": 1690000000000 }
```

- `httpCode`：HTTP 状态码（200/400/401/403/500），用 `ResponseEntity` 保证响应头一致
- `code`：业务错误码，0 = 成功，1xxx = 业务异常
- `requestId`：从 MDC 取 traceId，一个请求的日志和响应能对上号

静态工厂：`Ret.ok()` / `Ret.ok(data)` / `Ret.ok(msg, data)` / `Ret.error(httpCode, code, msg)`

### ErrorCode — 错误码枚举

`SUCCESS(0)`、`BAD_REQUEST(400)`、`UNAUTHORIZED(401)`、`FORBIDDEN(403)`、`NOT_FOUND(404)`、`INTERNAL_ERROR(500)`，业务码 `USER_NOT_FOUND(1001)`、`USER_PASSWORD_ERROR(1002)`、`TENANT_NOT_FOUND(1003)`。

每个枚举值带 `msgKey`（如 `error.bad_request`），实际文案由 i18n 资源文件提供。

### ServiceException — 业务异常

Service 层主动抛出，`GlobalExceptionHandler` 统一拦截转成 `Ret`。`message` 存的是 i18n key，不是最终文案。

### GlobalExceptionHandler — 全局异常处理

`@RestControllerAdvice`，三类兜底：

| 异常 | HTTP 码 | 处理 |
|------|---------|------|
| `ServiceException` | 自定义 | 业务异常，原样返回 code/msg |
| `MethodArgumentNotValidException` / `BindException` | 400 | `@Valid` 校验失败，拼字段错误 |
| `Exception` | 500 | 兜底，打完整堆栈，不泄露内部信息 |

### TraceIdFilter + LogTraceUtil — 链路追踪

- `TraceIdFilter` 是优先级最高的 Servlet Filter（`Integer.MIN_VALUE`）
- 优先读请求头 `X-Trace-Id`（跨服务传递），没有就生成 UUID 前 16 位
- 放进 MDC，日志自动带 `[traceId]`；`Ret` 响应体也带 `requestId`
- `finally` 里清理 MDC，防止线程池复用串号

### MessageUtils + I18nConfig — 国际化

- `basename=i18n/messages`，自动匹配 `messages.properties`（英文默认）和 `messages_zh_CN.properties`（中文）
- `AcceptHeaderLocaleResolver` 按请求头 `Accept-Language` 切换，默认简体中文
- 用法：`MessageUtils.get("error.bad_request")`，找不到 key 时返回 key 本身

---

## 七、网关（zhiwei-gateway）

启动类两个注解：

- `@SpringBootApplication` — 自动配置 + 组件扫描
- `@EnableDiscoveryClient` — 启动向 Nacos 注册

配置里最关键的一段（`application.yml`）：

```yaml
spring:
  cloud:
    gateway:
      server:
        webflux:                      # ← 5.x 必需的新路径
          discovery:
            locator:
              enabled: true
              lower-case-service-id: true
```

**路径变迁的坑**：Spring Cloud Gateway 4.3 起把 `spring.cloud.gateway.*` 整体废弃，新路径是 `spring.cloud.gateway.server.webflux.*`。4.3 还能兼容旧路径（打警告），5.x 彻底移除。本项目是 5.0.3，所以必须写新路径。

开了 `discovery.locator.enabled` 后，Nacos 里注册了什么服务，网关就自动生成路由：`/zhiwei-system-server/**` → `zhiwei-system-server`，新增微服务不用改网关配置。

---

## 八、Feign 跨服务调用链路

三个文件配合：

1. `zhiwei-module-system-api` 里的 `SystemHealthApi`（接口）：
```java
@FeignClient(name = "zhiwei-system-server", path = "/api/system")
public interface SystemHealthApi {
    @GetMapping("/health")
    Ret<String> health();
}
```
2. `system-server` 的 `HealthController implements SystemHealthApi` —— 提供方实现契约
3. `infra-server` 的 `FeignTestController` —— 调用方注入 `SystemHealthApi`，直接当普通方法调用

运行时链路：

```
浏览器 → infra-server(48082)
  → Feign 动态代理
  → 查 Nacos 拿到 system-server 实例地址
  → HTTP GET http://ip:48081/api/system/health
  → 解析 JSON 回填 Ret<String>
```

`@FeignClient` 的 `name` 必须等于 Nacos 里注册的服务名（`spring.application.name`）。

---

## 九、已知坑与注意事项

1. **没有 `spring-boot-maven-plugin`**：各 pom 都没声明，`mvn spring-boot:run` 报 `No plugin found for prefix 'spring-boot'`。要么用全限定坐标 `mvn org.springframework.boot:spring-boot-maven-plugin:4.1.2:run`，要么在 IDEA 里跑主类。
2. **目录名笔误**：`zhiwei-module-member/zhiwei-module-member-seven` 应为 `-server`，`zhiwei-module-booking/zhiwei-module-booking-sever` 应为 `-server`。改名会影响根 pom 的 `<module>` 和 IDE 配置，动之前先问负责人。
3. **dev 配置密码是明文**：`application-dev.yml` 里写死了 PolarDB 密码，赶工阶段可以，但推到公共仓库前要意识到这是敏感信息。
4. **Nacos 缺配置只 WARN**：首次启动不用先去 Nacos 建配置文件，但业务参数会缺失，后面要补 `zhiwei-gateway-dev.yaml`、`zhiwei-system-server-dev.yaml`、`zhiwei-infra-server-dev.yaml`。
5. **docker-compose 不含 MySQL**：只起 Redis + Nacos，业务库用外部 PolarDB。
6. **`.flattened-pom.xml`**：`flatten-maven-plugin` 的构建产物，`mvn` 跑过就在模块根目录出现，`.gitignore` 已忽略，不要提交。
7. **`.mvn` 目录**：Maven Archetype 生成模块时的副产物，`maven.config` / `jvm.config` 都是空文件，对构建无影响。
8. **依赖下载慢**：仓库配了阿里云镜像（`~/.m2/settings.xml`），首次 `mvn clean install` 仍要下几百 MB，耐心等。
