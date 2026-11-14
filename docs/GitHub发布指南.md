# 从本地项目到 GitHub 的新手发布指南

这份指南讲的是如何准备和上传当前「喵会错题」项目。你收到的是项目介绍、使用手册、发布教程和安全配置模板，不是已经替你上传的仓库，也不是完整源码压缩包。

建议依次完成：准备独立发布目录 → 检查隐私和许可 → 在干净环境试跑 → 建立私有 GitHub 仓库 → 上传核对 → 确认后再公开。下面两种上传方法任选其一，不需要都做。

## 一 先认识几个词

| 名称 | 可以怎样理解 |
|---|---|
| Git | 在本机记录代码变化的工具 |
| GitHub | 保存远程代码仓库的网站 |
| 仓库 repository | 一个项目的文件、提交历史和协作入口 |
| commit 提交 | 给当前一组文件变化保存一个本地版本 |
| push 推送 | 把本地提交上传到远程仓库 |
| README.md | 仓库首页自动显示的项目说明 |
| .gitignore | 告诉 Git 哪些未跟踪文件不该进入版本管理 |
| Private | 仓库内容默认只对获授权的人可见 |
| Public | 任何人通常都能查看和复制公开内容 |
| Release | 给一个版本写说明并附安装包等产物 |
| 部署 | 让服务器真正运行网站和后端 |

上传代码与部署网站是不同的步骤。GitHub 显示源代码，并不会自动启动你的 Node.js、Python、数据库或 AI 接口。当前项目不能只打开 GitHub Pages 就拥有完整后端能力。

## 二 当前电脑上的哪些内容不能直接上传

你提供的开发目录是：

```text
C:\Users\叶\Documents\Codex\2026-06-26\new-chat
```

这个目录混合了现有 Git 历史、其他产品原型、截图、恢复文件、运行配置和真实学习数据。它的根 README 还介绍另一个心理导航项目。因此，不建议在这个目录直接执行首次公开用的 `git add .` 和 `git push`。

当前目录实际存在 `.env`、本地模型配置、不同日期的配置备份、数据库备份、上传目录等。它们需要排除，不是只隐藏截图中的 API Key 就足够。

以下内容不进入源码发布：

- `server/.env` 以及各种带日期的 `.env` 备份。
- `server/model-config.local.json` 及其各种 `.bak` 或时间戳副本。
- `server/data.json`、`data.full-history-*.json`、`data.json.demo-backup` 等学习数据库。
- `server/uploads/`、`server/backups/`、带真实学生题目的截图和录屏。
- 运行日志、浏览器配置、会话令牌、私人部署密码与个人服务器配置。
- `node_modules/`、Python 缓存、便携运行时、大体积 APK/视频/源码压缩包等可重新生成的产物。

安全示例 `.env.example` 可以上传，但里面只能有空值、无效占位符和公开的参数名，不能把真实配置改个文件名当作“example”。

## 三 创建独立发布目录

示例使用：

```text
D:\CodexProjects\miaohui-cuoti-public
```

这是一个新的发布副本，不是让你搬走或删除原目录。旧项目、旧 `.git` 与开发证据继续保留；新的公开仓库可以从当前整理后的快照开始。这样不会保留旧提交的公开时间线，也不能把新仓库创建日期说成项目最初开始开发的日期。

在资源管理器中建立这个空文件夹。确认里面没有其他项目，不要把整个 `new-chat` 文件夹直接拖进去，也不要复制其隐藏 `.git`。

建议准备以下结构：

```text
miaohui-cuoti-public/
  README.md
  .gitignore
  docs/
    使用手册.md
    GitHub发布指南.md
  implementation/
    index.html
    相关网页模块和样式
    vendor/
    skills/
    tools/
  server/
    server.mjs
    package.json
    package-lock.json
    .env.example
    workflows/
    python/
    third_party/
    test/
```

### 从原项目复制哪些源码

1. 复制 `implementation` 中当前使用的网页、脚本、样式和必要静态资源。保留被页面引用的 vendor、skills、tools 等目录；排除临时运行生成物、`.bak` 与 `.keep-*` 备份。复制前检查是否混入真实题图或密钥。
2. 建立 `server`，复制 `server.mjs`、`package.json`、`package-lock.json`。
3. 复制 `server/workflows`、必要的 `server/python`、`server/third_party`。不要漏掉随附 Python 库和第三方许可证；排除 `__pycache__`、`.pyc` 和私人备份。
4. 若发布测试，复制测试文件及它们需要的无隐私夹具。夹具与示例图片要人工检查；不确定来源的真实照片先不要发布。只发布部分夹具时，不要声称所有测试可以完整复现。
5. 如果源码引用了额外静态数据或目录，需要一起保留。用干净目录试跑来确认，不要通过复制旧数据库“修复”缺依赖。
6. 部署与诊断脚本按需整理；脚本可能含本机绝对路径或示例服务器地址。先审查，不要把原目录全部脚本和截图一并复制。

这是文件准备清单，不是完成了全项目的源码发布审计。第一次对外发布前，仍要实际检查准备上传的每个目录。

### 把本次文档放在哪里

本次文档包中的 `README.md` 放到发布副本根目录，两个教程保留在 `docs` 下，`server/.env.example` 放到发布副本的 `server` 下，`.gitignore` 放到发布副本根目录。

不要把现有原项目根目录的心理导航 README 当成本项目说明。不要把这份“文档包”单独上传后就说已公开完整可运行源码。

## 四 检查 `.gitignore`

使用随文档提供的忽略模板作为基础。它覆盖 `.env`、本地模型配置及其备份、学习数据、上传目录、日志与常见构建产物；但忽略规则不是密钥扫描器，源码中硬编码的 Key 仍会被上传。

如果一个文件以前已经被 Git 跟踪，后来加入 `.gitignore` 并不会自动把它从历史中移除。这也是本次建议在独立干净副本建立首次公开仓库的原因之一。不要为了清理公开副本而删除原开发目录和历史。

检查结果应是：仓库里有配置示例和代码，没有你的真实配置和学习数据。

## 五 先决定许可和第三方内容的处理方式

### 你自己写的代码

在正式公开前，确定哪些代码你有权发布，再选择自有代码的许可证并加入根 `LICENSE`。MIT 是一种可选方案，但本次没有代你作出这个授权决定，也没有把整个项目统一改成 MIT。

公开仓库本身不等于已经给所有人授予任意商用、修改和分发的许可。没有确定许可证时，可以先私有整理，不要对外写“全项目 MIT、随便商用”。

### 第三方代码和课件

保留第三方源文件中的版权说明、LICENSE 和 NOTICE。特别是：

- `server/third_party/edulab`：保留对应 LICENSE、NOTICE 和实际引入的代码出处。
- Three.js、KaTeX、随附 Python 库等：按它们各自许可保留声明。
- 其他第三方代码、字体、图片与教材素材：也须逐项核查其许可。
- 教材、真题、插图和扫描图片：注明出处不等于已经取得所有再分发权。发布前检查每一类素材是否有权公开。

本发布包未包含铜匠实验室课件、独立化学工具与解析几何工具；使用手册只覆盖教材考法库、几何建模与物理电场。

## 六 在发布副本中重新试跑

不要直接用正在使用的 4180 数据服务做发布验收。在新的发布副本中打开 PowerShell，进入 `server`：

```powershell
Set-Location -LiteralPath 'D:\CodexProjects\miaohui-cuoti-public\server'
node --version
python --version
npm.cmd ci
Copy-Item -LiteralPath '.env.example' -Destination '.env'
notepad .env
```

上面的复制只在 `.env` 不存在时进行。把副本中的端口改为 4197，并把 `CORS_ORIGIN` 改为 `http://127.0.0.1:4197`，保留只监听本机。不要把 `DATA_FILE` 指向原开发项目的真实数据库。

先不填真实模型 Key，用于检查服务和只读页面：

```powershell
npm.cmd run start:model
```

在浏览器打开 `http://127.0.0.1:4197/`。后端应使用发布副本自己的空数据状态，不应显示原用户的错题、学生姓名和聊天记录。若显示了旧数据，停止副本服务并检查路径，不继续截图或上传。

另开一个 PowerShell，可检查：

```powershell
Invoke-RestMethod 'http://127.0.0.1:4197/health'
```

这一步是确认服务能运行，不是确认 AI 已成功调用。完整 AI 流程需要你自己在副本 `.env` 中填写有效 Key，使用虚构测试账号和无隐私题目检查。不要把检查中生成的新数据和 `.env` 加入上传列表。

检查后在副本运行终端按 `Ctrl+C` 停止它。原来 4180 的服务不应被这次发布验收停止或覆盖。

## 七 准备 GitHub 账号和仓库信息

用自己的 GitHub 账号登录网站。准备一个仓库名，例如 `miaohui-cuoti`，以及一句简介：

> 高中错题学习与复习项目，支持拍照与文字录题、AI 陪练、知识卡、间隔复习和教材考法检索。

简介不要写尚未验证的“所有学科全覆盖”“准确率 100%”“永久免费 API”“全部代码可商用”。还没有公网部署时，不填假的在线演示地址。

建议首次上传选择 **Private**，先检查远程内容；确认隐私、许可和可复现性后，再由你决定是否改为 Public。私有仓库也不适合存放真实 Key，它只是多一层整理缓冲。

## 八 方法 A 使用 GitHub Desktop

这一条适合不熟悉命令行的情况。请从 [GitHub Desktop 官方网站](https://desktop.github.com/) 安装并登录自己的账号。

1. 在 GitHub Desktop 选择 `File → Add Local Repository`，选择独立的发布副本目录。
2. 如果提示该目录不是 Git 仓库，按界面提供的 `create a repository here` 创建。确认最终仓库路径仍是发布副本，不是原来的 `new-chat`，也不要多套一个空文件夹。
3. 暂不自动添加另一个 README 或许可证覆盖已经准备的文件；自有代码许可按前一节的决定处理。
4. 回到 `Changes` 列表，逐个查看准备上传的文件。重点找 `.env`、`model-config`、`data.json`、照片、备份、日志。它们不应出现在提交中。
5. 在 `Summary` 填 `Initial public-source snapshot`，说明这是整理后的首个源码快照。这里保存的提交时间就是现在，不要改成暑假的日期。
6. 点击提交按钮，将检查过的文件保存为一个本地版本。
7. 点击 `Publish repository`，确认仓库名称、自己的账号和路径。
8. 第一次保留 `Keep this code private`，再执行发布。
9. 点击 `View on GitHub`，检查远程文件树与 README。只有此时，才算确认上传成功。

GitHub Desktop 的界面可能随版本变化，具体入口以 [官方添加本地仓库教程](https://docs.github.com/zh/desktop/adding-and-cloning-repositories/adding-a-repository-from-your-local-computer-to-github-desktop) 为准。上面步骤是给你执行的教程，本轮没有替你登录或点击发布。

## 九 方法 B 使用 Git 命令

### 安装并确认 Git

从 [Git 官方网站](https://git-scm.com/downloads) 安装 Windows Git，重新打开 PowerShell：

```powershell
git --version
```

出现版本号后继续。如果提示无法识别 `git`，先处理安装或终端环境，不要把后续命令逐行硬试。

### 建立一个空的远程仓库

在 GitHub 右上角选择新建仓库，填写仓库名与简介，第一次选择 Private。若你准备从本地推送已经整理的文件，创建时不要再勾选自动生成 README、`.gitignore` 或 LICENSE，以免产生两份不同的初始历史。

创建后复制 HTTPS 仓库地址，形如：

```text
https://github.com/你的用户名/miaohui-cuoti.git
```

其中“你的用户名”必须换成你自己的实际值。参见 [GitHub 创建仓库官方教程](https://docs.github.com/zh/repositories/creating-and-managing-repositories/creating-a-new-repository)。

### 初始化发布副本

仅在发布副本目录执行：

```powershell
Set-Location -LiteralPath 'D:\CodexProjects\miaohui-cuoti-public'
git init
git branch -M main
git config user.name '替换为你准备公开的提交者名字'
git config user.email '替换为你的GitHub提交邮箱'
git status --short
```

这两个 `git config` 没加 `--global`，只配置当前仓库。若不想公开自己的常用邮箱，可在 GitHub 邮箱设置中查看并使用 GitHub 提供的 noreply 提交邮箱，直接复制平台给你的完整地址，不要猜。

### 暂存并检查文件

确认 `.gitignore` 已在发布副本根目录后：

```powershell
git add .
git diff --cached --name-only
git status --short
```

`git add .` 只适用于你已整理、检查过的独立副本，不要回到原开发目录照抄。暂存清单里若出现密钥配置或私人数据，先停止，回到文件整理步骤；不要想着“先传上去再删”。

进一步可检查：

```powershell
git ls-files -ci --exclude-standard
git diff --cached --stat
```

第一条用于找“已跟踪但如今命中忽略规则”的路径，正常的干净首次上传应无此类输出。它不会检查源码里是否藏有 Key，也不能替代对文件内容的审查。

### 保存版本并连接远程

把下面 URL 的用户名和仓库名替换为你刚创建的真实值：

```powershell
git commit -m 'Initial public-source snapshot'
git remote add origin https://github.com/你的用户名/miaohui-cuoti.git
git remote -v
git push -u origin main
```

最后一条才是真正上传。认证时按 Git 的登录流程在浏览器或凭据管理器中完成；不要把 Token 拼进远程 URL，不要把 GitHub 登录密码当作 API Key，也不要把认证截图公开。

如果提示 `remote origin already exists`，先查看 `git remote -v`，核对它是不是目标仓库。不要随便删除远程或强制推送；干净新副本本来不应该继承原项目的远程地址。

## 十 上传后逐项核对

在 GitHub 网页打开仓库，检查：

- 首页显示“喵会错题”，不是心理导航原型。
- README 中的使用手册和发布指南链接能打开。
- `implementation` 和 `server` 下有必要源码，不是只有一个大 ZIP。
- 配置模板没有 Key，仓库中没有真实数据库、照片或备份。
- 原作者、第三方 LICENSE 与 NOTICE 保留完整。
- 没有把本机路径、内网地址当成可用在线演示。
- 文档所写功能与当前发布版本一致，不把试用功能写成全部题型可用。
- 仓库可见性符合你的选择。

下一步用新的目录重新下载或克隆这一个 GitHub 仓库，按 README 安装运行。只有“远程仓库的新副本能按说明启动”，才算完成基本的可复现性检查。不能用原开发目录正在运行来证明上传的文件齐全。

## 十一 后续更新

修改源码后，先把自己要发布的增量同步到发布副本，再检查变更、运行相关验证。使用 GitHub Desktop 时提交后点击 `Push origin`；使用命令行时：

```powershell
git status --short
git add README.md docs
git diff --cached --stat
git commit -m 'Describe the actual change'
git push
```

上面的暂存示例只更新 README 和文档。修改源码时，再明确添加对应路径，例如 `git add implementation/textbook-library.js implementation/toolbox.css`。发布副本长期使用时会生成新的 `.env` 和数据，不能因为第一次上传安全，就从此不看文件清单。

如果要发版本说明，可在 GitHub `Releases` 里选择创建新版本，写清新增功能、修复、运行要求和已知限制。安装包先做去密钥、去数据检查；不要直接把你正在运行的开发目录压缩成 Release 附件。

## 十二 以后想让别人直接在线使用

源码上传只是第一步。在线运行还需要 Node.js 与 Python 环境、模型配置、持久化数据目录、HTTPS、鉴权与备份；手机访问还需要正确的公网或局域网地址。

不要把真实 `.env` 放进前端静态目录，也不要把服务器数据文件放进可公开下载的路径。多人使用必须检查账号间的数据访问，而不只是看登录页能否打开。若暂时没有部署，就在 README 写“目前提供本地运行”，不要写不存在的在线体验链接。

## 十三 意外上传密钥或学生资料时

如果上传了有效 Key，先在提供方后台撤销或轮换。若上传私人学习数据，停止继续公开、评估曝光范围并处理相关副本。Git 中删除一个文件再提交，不能保证旧历史、克隆或缓存里没有它。

按照 [GitHub 敏感数据处理文档](https://docs.github.com/zh/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) 处理历史和必要的支持请求；不要盲目照抄强制推送、重置或清理命令，尤其不要对仍有开发改动的原目录执行它们。

## 十四 发布前最后确认

- [ ] 已使用独立发布副本，保留原目录和开发历史。
- [ ] 已确认有权公开的代码、素材和第三方内容范围。
- [ ] 已决定自有代码许可证，并保留第三方许可。
- [ ] 已排除真实 `.env`、Key、数据库、账号会话、原图和备份。
- [ ] 已用不含真实数据的新副本检查启动与主要入口。
- [ ] 已检查 README 功能边界、运行命令和内部链接。
- [ ] 已先私有上传并核对远程内容。
- [ ] 公开前由自己确认可见性和要公开的内容。

本轮准备的是文字材料和网页改进，没有执行 `git commit`、`git push`，没有创建远程仓库，也没有代你选择开源许可证。
