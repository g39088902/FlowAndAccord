---
name: cicd-fix-mime-overwrite-syntax
overview: "修复 deploy.yml 中两条 wasm MIME 覆写命令的参数位置错误：`coscmd -f upload` 改为 `coscmd upload -f`（-f 属 upload 子命令参数，强制覆盖同名对象），使 Content-Type: application/wasm 覆写得以执行。"
todos:
  - id: fix-upload-f-flag
    content: 修正 deploy.yml 两条 wasm MIME 覆写命令：-f 移至 upload 子命令之后
    status: completed
  - id: update-doc-version
    content: docs/cicd-guide.md 排障表补踩坑案例；版本号自增 v0.9.70（index.html / AGENTS.md / changelog 三处同步）
    status: completed
    dependencies:
      - fix-upload-f-flag
  - id: commit-merge-deploy
    content: YAML 语法校验后提交推送 test 并合并 master 触发重新部署
    status: completed
    dependencies:
      - update-doc-version
---

## 需求概述

修复 v0.9.69 部署运行中最后一处 CI 失败：

- **主上传已成功**：`15 files uploaded, 0 files skipped, 0 files failed`，`Synchronizing delete` 仅清理了 `js/` 与 `rust/` 两个目录占位对象（实际文件未受影响，属 coscmd 正常行为，无需处理）
- **失败点**：`.github/workflows/deploy.yml` 中两条 wasm MIME 覆写命令写成 `coscmd -f upload ...`，`-f` 被解析为全局参数导致 `coscmd: error: unrecognized arguments: -f`（exit 2）
- **已核实事实**：coscmd 的 `-f/--force`（强制覆盖同名文件上传）是 `upload` 子命令的选项，必须置于 `upload` 之后；全局参数位不接受 `-f`

## 验收标准

- 两条 wasm 覆写命令语法正确执行，`.wasm` 对象的 Content-Type 为 `application/wasm`
- 全流水线（构建 → 门禁 → 上传 → MIME 覆写 → 摘要）绿灯
- 遵循 AGENTS.md §4.9 版本号自增规范（v0.9.69 → v0.9.70，三处同步）
- 部署指南排障表补充本次踩坑案例

## 技术方案

### 修改点（.github/workflows/deploy.yml）

「上传至 COS」步骤最后两行命令修正参数位置：

```
coscmd upload -f -H "Content-Type: application/wasm" frontend/rust/sim_wasm.wasm /rust/sim_wasm.wasm
coscmd upload -f -H "Content-Type: application/wasm" frontend/sim_wasm.wasm /sim_wasm.wasm
```

- `-f` 移入 `upload` 子命令之后（强制覆盖已存在对象，确保 MIME 覆写生效）
- 保留 `-H` 设置 `Content-Type: application/wasm`（目录上传时 python mimetypes 不识别 `.wasm`，默认 `application/octet-stream` 会导致浏览器流式编译失败）
- 主上传命令 `coscmd upload -rsy --delete frontend/ /` 不变（已验证成功）

### 文档与版本同步

- `docs/cicd-guide.md` 第 6 节排障表补充：`unrecognized arguments: -f`（参数必须置于 upload 子命令之后）
- 版本号 v0.9.69 → v0.9.70：`frontend/index.html` 徽章、AGENTS.md 两处（Mermaid 节点 + 步骤四）、`docs/current/11-changelog.md` 顶部指针与文末条目
- 提交推送 `test` 并合并 `master` 触发重新部署

### 可靠性

- 仅改 CI 配置两行命令与文档，不触碰功能代码；修改后用 YAML 解析校验语法