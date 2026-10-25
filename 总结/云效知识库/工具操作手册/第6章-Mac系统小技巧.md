# 第6章 Mac 系统小技巧

文档里只收了两件小事，都是 Mac 上容易卡住的点。

## 一、装机网站

| 用途 | 地址 |
|---|---|
| 各类软件 | https://macwk.com/ 、https://www.macw.com/ |
| JetBrains 系列软件 | https://macwk.com/article/jetbrains-crack |
| JetBrains 破解地址 | https://jetbra.in/5d84466e31722979266057664941a71893322460 |

（Windows 上激活 IDEA 用第 1 章的 ckey.run，Mac 上也可以先试那个，不行再用这里的破解地址。）

## 二、耳机没声音

Mac 切了设备之后突然没声音，重启音频服务：

```bash
sudo killall coreaudiod
```

执行后系统会自动重开音频服务，耳机一般就恢复了。
