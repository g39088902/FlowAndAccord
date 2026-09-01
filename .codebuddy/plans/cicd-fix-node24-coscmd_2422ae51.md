---
name: cicd-fix-node24-coscmd
overview: 修复 CI/CD 流水线两处失败：① coscmd upload 补 -y 跳过 --delete 交互确认（253 退出根因）；② 新增 Secrets 格式预检 + DNS 解析自检并精确定位 "Failed to resolve *.cos.*.myqcloud.com" 的配置错误（大写/引号/空格/错误地域），③ Node 升级到 24，同步更新排障文档与版本号。
todos:
  - id: fix-workflow
    content: 修改 deploy.yml：setup-node 升级到 24、新增 Secrets 预检步骤（格式校验 + DNS 预解析）、coscmd upload 加 -y 跳过确认
    status: completed
  - id: update-cicd-doc
    content: 更新 docs/cicd-guide.md：故障排查表补 exit 253 与 DNS 解析失败两条实测案例，Secrets 章节补格式要求
    status: completed
    dependencies:
      - fix-workflow
  - id: bump-version-and-merge
    content: 版本号自增 v0.9.69（index.html / AGENTS.md / changelog 三处同步），提交推送 test 并合并 master 触发重新部署
    status: completed
    dependencies:
      - update-cicd-doc
---

## 需求概述

修复首次 CI/CD 部署（master push 触发）失败的两个问题，并按用户要求将流水线 Node 版本提升至 24：

1. **coscmd 交互确认导致失败（exit 253）**：`coscmd upload -rs --delete` 的 `--delete` 参数会触发 `input()` 交互确认（`WARN: you are deleting some files ... [y/N]`），GitHub runner 无 stdin 导致进程以 253 退出，15 个文件全部上传失败；
2. **COS 域名 DNS 解析失败**：`Failed to resolve '<bucket>.cos.<region>.myqcloud.com' (Name or service not known)`，桶名/地域均来自 GitHub Secrets（日志中被掩码）。myqcloud.com 全球可解析，最可能根因是 Secret 值格式错误（含大写字母、缺 `-APPID` 后缀、误填域名/https 前缀、地域码填中文、首尾空格或引号），需在流水线中加入预检与针对性排障提示；
3. **Node 版本提升至 24**：用户明确要求。

## 验收标准

- workflow 中 `coscmd upload` 全程免交互（不再出现 [y/N] 提示与 exit 253）；
- Secrets 格式错误时在 coscmd 上传前即报错，并给出明确的中文排障指引（不回显 Secret 值）；
- 构建与测试运行在 Node 24 上；
- 文档故障排查表收录本次两条真实踩坑案例；
- 遵循 AGENTS.md §4.9 版本号自增规范（v0.9.68 → v0.9.69，三处同步）。

## 技术方案

### 关键技术事实（已核实）

- coscmd `upload` 子命令已定义 `-y/--yes`（"Skip confirmation"，argparse store_true）参数，与 `--delete` 组合即可跳过交互确认，无需管道 hack（来源：tencentyun/coscmd master 分支 `cos_cmd.py`，`kwargs['yes']` 透传至 `upload_folder`）；
- COS 域名格式为 `<bucket>.cos.<region>.myqcloud.com`，桶名仅接受小写字母/数字/连字符 + `-APPID` 后缀，地域码形如 `ap-guangzhou`、`ap-chengdu-1`；Secret 值含大写/引号/空格即产生 NXDOMAIN；
- `tools/test-wasm.js` 零依赖且无 engines 约束，Node 24 可直接运行。

### 修改点（.github/workflows/deploy.yml）

1. **build job**：在 checkout 后新增 `actions/setup-node@v4`，`node-version: '24'`；
2. **deploy job 新增「预检 Secrets」步骤**（在 coscmd config 之前）：

- 对 Secret 值先 `tr -d ' \t\r\n'` 去除首尾空白（防止误粘贴空格），用清洗后的值继续；
- 正则校验 `COS_BUCKET`（`^[a-z0-9][a-z0-9-]{1,61}-[0-9]+）与 `COS_REGION`（`^[a-z]{2}-[a-z]+(-[0-9]+)?），失败时以 `::error::` 输出中文格式要求（示例格式，不回显真实值）；
- `python3 -c` 用 `socket.gethostbyname` 预解析 `<bucket>.cos.<region>.myqcloud.com`，失败时输出针对性排障清单（大写字母 / 引号 / 空格 / 缺 APPID / 地域码错误）并终止，避免 coscmd 上传到一半才逐文件报 DNS 错；

3. **上传命令修正**：`coscmd upload -rsy --delete frontend/ /`（`-y` 跳过确认）；两条 wasm MIME 覆写命令同步加 `-f`（已存在）保持不变。

### 文档与版本同步

- `docs/cicd-guide.md` 第 6 节故障排查表追加两条实测案例：exit 253（--delete 交互确认）与 DNS 解析失败（Secret 值格式排查清单），并更新第 2 节 Secrets 说明（值必须小写、勿带引号/空格/https 前缀）；
- 版本号 v0.9.68 → v0.9.69：`frontend/index.html` 徽章、AGENTS.md 两处、`docs/current/11-changelog.md` 顶部指针与文末条目；
- 提交后推送 `test` 并合并到 `master` 触发重新部署（与用户此前操作流一致）。

### 性能与可靠性

- 预检为纯本地正则 + 单次 DNS 解析，开销可忽略；前置失败可将排障时间从「上传 15 文件逐个超时」缩短到秒级明确报错；
- 不改动 Rust/前端功能代码，blast radius 仅限 CI 配置与文档。