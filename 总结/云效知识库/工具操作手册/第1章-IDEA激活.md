# 第1章 IDEA 激活

来源：linux.do/t/topic/694120，脚本作者 ckey.run。适配 Win / Linux / Mac。

测试过的系统：Windows 10、Ubuntu 24.04.2 LTS、macOS Sequoia 15.2。

## 一、Windows（最常用）

以**管理员**身份打开 PowerShell（Win + X → Windows PowerShell 管理员），**复制**下面命令运行，别手输：

```powershell
irm ckey.run|iex
```

脚本会自动扫描装好的 JetBrains 全系列软件，稍等片刻自动激活完，不用输激活码。

| 需求 | 命令 |
|---|---|
| 看脚本处理了哪些文件 | `irm ckey.run/debug|iex` |
| 查看脚本源码（去掉 iex） | `irm ckey.run` |
| 取消激活 | `irm ckey.run/uninstall|iex` |

## 二、Linux

```bash
# 激活
wget --no-check-certificate ckey.run -O ckey.run && bash ckey.run

# debug
wget --no-check-certificate ckey.run/debug -O ckey.run && bash ckey.run

# 取消激活
wget --no-check-certificate ckey.run/uninstall -O ckey.run && bash ckey.run
```

## 三、Mac

Mac 默认没有 wget，用 curl（装了 wget 也能用上面的 Linux 命令）：

```bash
# 激活
curl -L -o ckey.run ckey.run && bash ckey.run

# debug
curl -L -o ckey.run ckey.run/debug && bash ckey.run

# 取消激活
curl -L ckey.run/uninstall -o ckey.run && bash ckey.run
```

## 四、离线激活

下载 `ckey_run.zip`（365.2 KB）后：

1. 解压
2. 进解压目录，执行 `scripts` 下面对应的 `install`
3. 复制 `code` 里的编码，粘到 IDEA 激活窗口

要自定义激活信息（名字、邮箱之类）去激活站 https://ckey.run 生成。
