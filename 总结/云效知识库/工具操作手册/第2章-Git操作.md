# 第2章 Git 操作

## 一、安装

Windows 安装包：https://git-scm.com/install/windows

## 二、下载项目

```bash
# https 方式
git clone https://codeup.aliyun.com/5f10495a6207a1a8b17f5729/study/tcm-admin.git

# ssh 方式
git clone git@codeup.aliyun.com:5f10495a6207a1a8b17f5729/study/tcm-admin.git
```

ssh 方式要先在 Codeup 配公钥，https 方式要配克隆账号密码。

## 三、分支

| 场景 | 命令 |
|---|---|
| 查看所有分支（含远程） | `git branch -a` |
| 查看当前分支 | `git branch` |
| 删本地分支 | `git branch -d branch-name` |
| 删远程分支 | `git push origin --delete branch-name` |
| 手动推送 | `git push branch-name` |
| 设置上游分支（本地关联远程） | `git push --set-upstream branch-name` |
| 撤消还没完成的合并 | `git merge --abort` |

## 四、查某个文件被谁改过

```bash
git log --stat --full-history --simplify-merges -- A/index.js
```

## 五、代码回退

| 参数 | 效果 |
|---|---|
| 默认 `-soft` | 已 commit 的修改退回暂存区 |
| `--hard` | 修改直接丢弃 |

```bash
git reset --hard HEAD^          # 回退到上一个版本
git reset --hard HEAD~3         # 回退到前 3 次提交之前
git reset --hard commit_id      # 退到/进到指定 commit
git push origin HEAD --force    # 回退后强推远程
```

## 六、清除远程已合并的非活跃分支（危险）

会**直接删除远程分支**。先备份仓库，在备份里跑通再动真仓库。

```bash
for branch in `git branch -r --merged | grep -v HEAD`; do
  echo -e `git show --format="%ci %cr" $branch | head -n 1` \\t$branch
done | sort -r | grep -i "2022-" | grep -v "remotes/" | awk -F "origin/" '{print $2}' | xargs git push origin --delete
```

- 想连未合并的也清掉：去掉 `--merged`
- 测试方法：`git clone --bare 原仓库 .` → `git push --mirror 新测试仓库` → 在测试仓库上跑脚本

## 七、Mac 上删掉 .DS_Store（附录）

Mac 的 Finder 会到处生成 `.DS_Store`，老冲突。一次性清掉：

```bash
find . -name .DS_Store -print0 | xargs -0 git rm -f --ignore-unmatch
git add .
git commit -m "删除.DS_Store"
```
