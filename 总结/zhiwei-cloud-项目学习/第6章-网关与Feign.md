# 第6章 网关与 Feign

## 一、网关（zhiwei-gateway）

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

### 路径变迁的坑

Spring Cloud Gateway 4.3 起把 `spring.cloud.gateway.*` 整体废弃，新路径是 `spring.cloud.gateway.server.webflux.*`。

- 4.3 还能兼容旧路径（打警告）
- 5.x 彻底移除

本项目实际是 **5.0.3**，所以必须写新路径，写旧的直接不生效。

### 自动路由

开了 `discovery.locator.enabled` 后，Nacos 里注册了什么服务，网关就自动生成路由：

```text
/zhiwei-system-server/**  →  zhiwei-system-server
```

新增微服务不用改网关配置。

### 网关层错误也统一成 Ret（11-06 新增）

`zhiwei-gateway/src/main/java/cloud/zhiwei/gateway/handler/GlobalErrorWebExceptionHandler.java`（151 行）：

```java
@Component
@Order(-1)
public class GlobalErrorWebExceptionHandler implements ErrorWebExceptionHandler
```

要解决的问题：请求到不了后端时（没有匹配路由、服务全部下线），错误是**网关自己**产生的，走的是 WebFlux 的 `ErrorWebExceptionHandler`，和业务服务的 `@RestControllerAdvice` 完全无关。以前返回空 body，前端 `JSON.parse` 直接炸，看不出是 404 还是 503。

几个实现要点：

- `@Order(-1)` 排在 Spring Boot 默认的 `DefaultErrorWebExceptionHandler` 前面，否则轮不到它
- 把「无路由 404」「服务全下线 503」「500」都包成 `Ret`（httpCode/code/msg/requestId/timestamp 齐全）
- 响应已经提交（`response.isCommitted()`）时不再改写，否则会抛重复写响应的异常
- 文案是硬编码中英双语，按 `Accept-Language` 请求头判断——**WebFlux 环境用不了 Servlet 的 `LocaleContextHolder`**
- 网关模块没引 Lombok，日志用手写 Logger；序列化用 `ZhiWeiJson`

这层和业务服务的 `GlobalExceptionHandler` 是两套，别搞混：

| 层 | 类 | 触发场景 |
|---|---|---|
| 网关 | `GlobalErrorWebExceptionHandler`（WebFlux） | 没路由、服务不可用、网关自身异常 |
| 业务服务 | `GlobalExceptionHandler`（Servlet） | Controller/Service 里抛出的异常 |

## 二、Feign 跨服务调用

三个文件配合：

### 1. 接口定义（在 `-api` 模块）

```java
@FeignClient(name = "zhiwei-system-server", path = "/api/system")
public interface SystemHealthApi {
    @GetMapping("/health")
    Ret<String> health();
}
```

**契约写法的硬约束**（2026-11-02 提交 `9b937dc` 统一整改过）：

- 路径前缀写在 `@FeignClient` 的 `path` 属性上，**不能**在接口上加类级 `@RequestMapping`
- 原因一：OpenFeign 4.x 的 `SpringMvcContract.processAnnotationOnClass` 碰到 `@FeignClient` 接口上的类级 `@RequestMapping` 会直接抛 `IllegalArgumentException: @RequestMapping annotation not allowed on @FeignClient interfaces`，启动就失败
- 原因二：`@FeignClient(path = ...)` 不会被 Spring MVC 继承，所以**提供方 Controller 要自己写类级 `@RequestMapping`**，方法上只加 `@Override`
- 规范原文在 `zhiwei-ai-governance/standards/backend-coding-standards.md`

| 位置 | 写法 | 结果 |
|---|---|---|
| 错误 | 接口上 `@RequestMapping("/api/system")` + `@FeignClient(name="...")` | 启动报 `IllegalArgumentException` |
| 正确 | `@FeignClient(name="...", path="/api/system")` + 方法级 `@GetMapping` | 正常 |
| 提供方 | Controller 类上 `@RequestMapping("/api/system")`，方法 `@Override` | 路由正确 |

### 2. 提供方实现

`system-server` 的 `HealthController implements SystemHealthApi` —— 实现契约，不用再写映射注解。

### 3. 调用方注入

`infra-server` 的 `FeignTestController` 注入 `SystemHealthApi`，直接当普通方法调：

```java
SystemHealthApi api;
Ret<String> ret = api.health();
```

### 运行时链路

```text
浏览器 → infra-server(48082)
  → Feign 动态代理
  → 查 Nacos 拿到 system-server 实例地址
  → HTTP GET http://ip:48081/api/system/health
  → 解析 JSON 回填 Ret<String>
```

`@FeignClient` 的 `name` **必须等于** Nacos 里注册的服务名（`spring.application.name`），写错就找不到实例。
