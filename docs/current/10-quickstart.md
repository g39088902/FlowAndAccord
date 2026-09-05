# 10. 🚀 快速启动与体验

> **模块索引**：[← 返回 current.md 全景索引](../current.md)

---

## 方式 1：浏览器体验（推荐）

启动本地 HTTP 服务（默认端口 3000）：
```bash
node frontend/server.js
```
访问浏览器：`http://localhost:3000`

> 若 3000 端口已被占用，说明前端服务已在运行，直接访问即可，无需重复启动。

> ⚠️ **v1.27.0 启动存档门禁 / ★ v1.28.0 自动读档**：页面打开后模拟默认暂停。若已连接默认存档文件（自动槽 1 = 浏览器记住的默认目录 + 默认文件名 `flowaccord-save1.json`，句柄经 IndexedDB 恢复）则**直接读取其内容续演**；首次使用需点击「建立存档文件」创建/连接一个本地 `.json` 存档文件（File System Access API），写入成功后才解除门禁开始模拟。请使用最新版 Chrome 或 Edge（Firefox 不支持）。

### 编译 WASM（改 Rust 代码后）
```powershell
# 注入便携工具链
$env:PATH = "$PWD\.toolchain\cargo\bin;$PWD\.toolchain\rustc\bin;$env:PATH"
$env:CARGO_HOME = "$PWD\.cargo-home"
# 编译
cargo build -p sim_wasm --target wasm32-unknown-unknown --release
# 双副本同步
Copy-Item "target\wasm32-unknown-unknown\release\sim_wasm.wasm" -Destination "frontend\rust\sim_wasm.wasm" -Force
Copy-Item "target\wasm32-unknown-unknown\release\sim_wasm.wasm" -Destination "frontend\sim_wasm.wasm" -Force
```
编译后在浏览器按 `Ctrl + F5` 强制刷新清理 WASM 缓存。

## 方式 2：Node.js 自动化回归测试
```bash
node tools/test-wasm.js
```
输出 `ALL_TESTS_DONE` 即代表确定性测试、坐标防越界、数值防 NaN 校验 100% 通过。

## 方式 3：配置一致性校验
```bash
node tools/config-check.js
```
输出「字段集、类型、默认值完全一致，无漂移」即代表前后端配置同步。同时自动刷新 `docs/config-reference.md`。

## 方式 4：Rust 内核编译检查
```bash
cargo build -p sim_core
```
> 项目定位为混沌系统，不持久化保存单元测试脚本（详见根 AGENTS.md §4.10）。`cargo test --lib` 仅验证编译通过，无测试用例。

## 常用交互
| 操作 | 快捷键/方式 |
| :--- | :--- |
| 暂停/继续 | `Space` 空格键 |
| 选中部落民 | 鼠标左键点击小人 |
| 查看房屋/地标 | 鼠标左键点击 |
| 缩放 | 鼠标滚轮 |
| 平移 | 右键拖拽 |
| 重置模拟 | 顶部「重置模拟」按钮 |
| 强制刷新 | `Ctrl + F5`（重编译 WASM 后） |
