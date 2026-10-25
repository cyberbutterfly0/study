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
