# 第3章 Maven 操作

## 一、下载

| 渠道 | 地址 | 说明 |
|---|---|---|
| 官网 | https://maven.apache.org/download.cgi | 最新稳定版 |
| 历史版本 | https://archive.apache.org/dist/maven/maven-3/ | 所有历史版本 |
| 阿里云镜像 | https://mirrors.aliyun.com/apache/maven/maven-3/ | 国内快，推荐 |

文档写作时的最新稳定版是 3.9.9。知微团队用 **Maven 3.9+**（本机装的是 3.9.16）。

## 二、常用命令

| 场景 | 命令 | 说明 |
|---|---|---|
| 编译 | `mvn compile` | 只编译源码，不跑测试 |
| 编译+测试 | `mvn test` | 编译并运行单元测试 |
| 打包 | `mvn package -DskipTests` | 编译+打包，跳过测试 |
| 安装到本地 | `mvn install -DskipTests` | 装到 `~/.m2/repository` |
| 完整构建 | `mvn clean install` | 清理 + 编译 + 测试 + 安装 |
| 只打包当前模块 | `mvn clean package -pl 模块名 -am` | `-pl` 指定模块，`-am` 同时构建依赖 |
| 离线模式 | `mvn install -o` | 不检查远程仓库，已有依赖时快很多 |
| 强制更新 | `mvn install -U` | 强制拉 SNAPSHOT 更新 |
| 多线程构建 | `mvn install -T 4` | 4 线程，`-T 1C` = 按 CPU 核心数 |
| 查看依赖树 | `mvn dependency:tree` | 排查依赖冲突 |
| 运行单个测试类 | `mvn test -Dtest=类名` | 如 `-Dtest=UserServiceTest` |
| 跳过所有插件 | `mvn install -DskipTests -Dmaven.javadoc.skip=true` | 最快构建 |
| 查看有效 pom | `mvn help:effective-pom` | 看合并父 pom 后的最终配置 |

## 三、知微项目构建速查

```bash
# 全量构建（跳过测试）
cd E:\study\zhiwei-cloud
mvn clean install -DskipTests

# 只构建 system 模块及依赖
mvn clean install -pl zhiwei-module-system -am -DskipTests

# 多线程加速
mvn clean install -DskipTests -T 1C
```

注意：文档原文写的是 macOS 路径 `/Users/liming/projects/zhiwei-cloud`，Windows 上换成 `E:\study\zhiwei-cloud`。
