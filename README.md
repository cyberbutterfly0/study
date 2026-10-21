# 学习

把 `总结/` 里的学习笔记打包成装得进手机的 PWA：离线阅读、刷题、错题本，外加一个能问 DeepSeek 的对话框。

手机上用浏览器打开地址 → 「添加到主屏幕」，之后断网也能翻笔记、刷题。

- 在线版：<https://cyberbutterfly0.github.io/study/>
- 题库覆盖：单片机（STM32F103 / TI MSPM0）、Java 集合 / 控制流 / 算法入门、软件使用
- 所有答题记录只存在手机本地，不上传

---

## 目录结构

```
总结/                     学习笔记的源头（Markdown），改这里
├── 单片机-智能车/        总览、第1章、错题本、术语表、平台对照
├── Java-集合框架/
├── Java-控制流/
├── Java-算法入门/
└── 软件使用/

app/                      PWA 本体，直接部署这个目录
├── index.html
├── sw.js                 离线缓存
├── manifest.webmanifest
├── assets/               样式与前端代码（无框架、无构建步骤）
├── data/                 由 tools 从 总结/ 生成，已入库供手机拉取
└── icons/

tools/
├── build-library.mjs     总结/*.md → app/data/library.json（阅读内容）
├── build-questions.mjs   总结/*.md 里的「选择题」→ app/data/questions.json
├── make-icons.mjs        生成 PWA 图标（手写 PNG 编码，无依赖）
├── serve.mjs             本地预览
└── sync-in.mjs           手机导出的答题记录 → 电脑端学情报告
```

## 日常怎么用

**内容有更新**（改了笔记或加题）：

```bash
npm run build     # 重新生成 library.json / questions.json
git add -A && git commit -m "内容更新" && git push
```

推上去之后，手机 PWA 连网打开时会自动从 GitHub 拉最新的 JSON，**不需要重新安装**。

**手机上刷题**：首页 → 点学科 → 开始刷题。答错的题自动进错题本，隔天提醒复习，连续答对两次才算掌握。

**把记录同步到电脑**：
1. 手机上「配置 → 同步到电脑」，导出 `study-sync-*.json`
2. 电脑上 `node tools/sync-in.mjs <文件路径>`
3. 生成 `总结/_同步报告.md`（各章正确率、错题清单）
4. 加 `--write-wrongbook` 可以把错题追加进 `错题本.md`

**本地预览**：

```bash
node tools/serve.mjs
# http://localhost:8099
```

不要用 `python -m http.server`，它给 `.js` 的 MIME 类型不对，module script 会加载失败。

## 题目的写法

在笔记里插一段 `**选择题**`，格式固定，`build-questions.mjs` 靠它解析：

```markdown
**选择题**

1. 题干一行
   - A. 选项
   - B. 选项
   - 答案: B
   - 判定: 逐个选项为什么对为什么错
   - 踩坑场景: 真实翻车现场
   **术语**
   | 术语 | 含义 | 通俗解释 |
   |---|---|---|
   | HSE | 外部高速时钟 | 板上那颗晶振 |
```

`答案`、`判定`、`踩坑场景`、`术语` 都可以省，但省了判题时就只有对错没有解释。

## 手机上装

**Android（Chrome / Edge）**：打开 <https://cyberbutterfly0.github.io/study/> → 右上角 ⋮ → 「添加到主屏幕」/「安装应用」。

**iOS**：Safari 打开同一地址 → 分享按钮 → 「添加到主屏幕」。

装完桌面会有个蓝色书本图标，点开是全屏无地址栏的独立窗口。第一次打开要联网（下载约 200 KB），之后断网也能看笔记、刷题。

## 部署

**GitHub Pages**：`.github/workflows/deploy.yml` 在每次 push 后重新构建并把 `app/` 发布出去。仓库 Settings → Pages → Source 选 GitHub Actions。已生效：<https://cyberbutterfly0.github.io/study/>

**Cloudflare Pages**（可选的第二个入口，`*.github.io` 在某些网络下打不开时用）：

1. 打开 <https://dash.cloudflare.com/> → **Workers 和 Pages** → **创建** → **Pages** → **连接到 Git**
2. 授权 GitHub，选中 `cyberbutterfly0/study` 仓库
3. 构建设置：
   - 框架预设：**无**
   - 构建命令：**留空**（`app/data/*.json` 已经是构建好的，直接发布就行）
   - 构建输出目录：`app`
4. 保存并部署，拿到 `https://study-xxxx.pages.dev`

以后每次 push，两个平台各自重新发布。

## 已知限制

- 答题记录存在浏览器 IndexedDB 里，清除浏览器数据会丢。定期导出备份。
- PWA 的 Service Worker 只在 HTTPS 下工作，局域网 `http://192.168.x.x` 装不了离线，必须走公网。
- 国内访问 `*.github.io` 有时候慢，装上桌面后不影响离线使用，只有更新题库那次需要联网。
