# 第4章 Docker 操作

## 一、下载安装

| 平台 | 地址 | 说明 |
|---|---|---|
| macOS（Apple Silicon） | https://desktop.docker.com/mac/main/arm64/Docker.dmg | M1/M2/M3 |
| macOS（Intel） | https://desktop.docker.com/mac/main/amd64/Docker.dmg | Intel 芯片 |
| Windows | https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe | WSL2 后端 |
| Linux | https://docs.docker.com/engine/install/ | 按发行版选 |
| 所有版本 | https://docs.docker.com/desktop/release-notes/ | 历史版本回退 |

## 二、安装验证

```bash
docker --version              # 版本
docker compose version        # Compose 插件版本（v2 之后是 docker compose，中间有空格）
docker info                   # 引擎是否在跑
```

## 三、四层模型

```
Dockerfile  --build-->  Image  --run-->  Container
                          |                    |
                          +------> Registry <--+   (push / pull)
```

- **Dockerfile**：指令文件，描述镜像怎么搭出来
- **Image**：只读模板
- **Container**：镜像跑起来的实例
- **Registry**：镜像仓库，Docker Hub 是公共的

## 四、镜像管理

```bash
docker search nginx              # 搜镜像
docker pull nginx:alpine         # 拉镜像
docker images                    # 本机镜像列表
docker rmi 镜像ID或名字           # 删镜像
docker image prune -a            # 清掉所有没被容器用的镜像
docker save -o x.tar 镜像名       # 导出成文件
docker load -i x.tar             # 从文件导入
```

## 五、容器管理

```bash
docker run -d --name my-nginx -p 8080:80 nginx        # 后台跑，端口映射
docker run --rm -it alpine sh                          # 跑完就删，进交互 shell
docker ps                                              # 运行中的容器
docker ps -a                                           # 含已停止的
docker logs -f 容器名                                   # 跟日志
docker exec -it 容器名 sh                               # 进容器
docker stop / start / restart 容器名
docker rm 容器名                                        # 删容器（先停）
docker rm -f 容器名                                     # 强删
docker stats                                           # 实时资源占用
```

## 六、数据与网络

```bash
docker run -v /宿主机/目录:/容器/目录 镜像            # 挂载目录
docker run -v 卷名:/容器/目录 镜像                    # 挂载具名卷
docker volume create 卷名
docker volume ls
docker network ls
docker run --network 网络名 镜像
```

## 七、Docker Compose

```bash
docker compose up -d          # 按 docker-compose.yml 起全部服务
docker compose down           # 停并删容器、网络
docker compose stop           # 只停，保留容器
docker compose up -d --build  # 重新构建镜像再起
docker compose logs -f 服务名
docker compose ps
docker compose restart 服务名
docker compose exec 服务名 sh
```

## 八、清理

```bash
docker container prune        # 删所有停止的容器
docker image prune -a         # 删所有没被使用的镜像
docker system prune -a        # 一次性清容器/镜像/网络/缓存
docker builder prune          # 清构建缓存
```

## 九、知微项目速查

```bash
# 启动全部基础设施
cd E:\study\zhiwei-cloud
docker compose up -d

# 查看所有服务状态
docker compose ps

# 查看 Nacos 日志
docker compose logs -f nacos

# 只重启 Nacos
docker compose restart nacos

# 停止全部（保留数据卷）
docker compose stop
```

备选写法（不在项目目录里时）：

```bash
docker compose -f zhiwei-cloud/docker-compose.yml up -d
docker compose down nacos
docker compose up -d nacos
docker logs -f zhiwei-nacos
docker compose ps
```

## 十、Dockerfile 多阶段构建

```dockerfile
# 构建阶段
FROM maven:3.9-eclipse-temurin-27 AS build
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn clean package -DskipTests

# 运行阶段（最终镜像很小）
FROM eclipse-temurin:27-jre-alpine
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

| 指令 | 作用 |
|---|---|
| `FROM` | 基础镜像 |
| `COPY` vs `ADD` | 复制文件（ADD 额外支持解压和 URL） |
| `RUN` | 构建时执行命令 |
| `EXPOSE` | 声明端口（仅文档作用） |
| `ENV` | 环境变量 |
| `ENTRYPOINT` | 固定入口命令 |
| `CMD` | 默认参数（可被覆盖） |
