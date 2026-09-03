# 编译与运行深度指南 (build-guide)

> 核心编译 / 测试 / 启动步骤见根 [AGENTS.md §2](../AGENTS.md)。本文档补充环境变量细节、跨平台说明、故障排查与配置校验流程。
>
> 当前版本：v1.0.1

---

## 1. 工具链与环境变量

### 1.1 Windows 便携工具链（项目主环境）

项目根目录内置便携 Rust 工具链与离线依赖缓存，每次新开 PowerShell 终端需注入：

```powershell
$env:PATH = "$PWD\.toolchain\cargo\bin;$PWD\.toolchain\rustc\bin;$env:PATH"
$env:CARGO_HOME = "$PWD\.cargo-home"
```

- `.toolchain/`：便携 cargo + rustc 二进制
- `.cargo-home/`：离线依赖缓存（registry + git）
- 注入后 `cargo --version` / `rustc --version` 应正常输出

> ⚠️ CI 中**禁止**使用便携链——CI 运行在 ubuntu-latest，用标准 rustup（见 [cicd-guide.md](./cicd-guide.md)）。`.toolchain/` 与 `.cargo-home/` 已被 gitignore。

### 1.2 macOS / Linux（标准 rustup）

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
```

编译 / 测试 / 启动命令与 Windows 相同，仅路径分隔符为 `/`，复制用 `cp` 替代 `Copy-Item`。

---

## 2. 编译与双副本同步

核心命令见根 AGENTS.md §2 步骤一。要点：

- 编译目标：`wasm32-unknown-unknown`，`--release`
- 产物路径：`target\wasm32-unknown-unknown\release\sim_wasm.wasm`
- **必须复制到两个位置**（缺一不可）：
  - `frontend\rust\sim_wasm.wasm`（`rustworld.js` 实际 fetch 的主路径）
  - `frontend\sim_wasm.wasm`（根目录静态备用）
- 不要用 wasm 字节数判断是否更新——不同构建可能字节完全相同，以 `node tools/test-wasm.js` 实际输出为准

---

## 3. 测试与校验

### 3.1 WASM 回归测试（唯一长期保留的自动化验证）

```powershell
node tools/test-wasm.js
```

输出 `ALL_TESTS_DONE` 即通过。覆盖：同种子逐字节确定性、坐标防越界、数值防 NaN、长程稳定性。

### 3.2 配置一致性校验（改参后必跑）

```powershell
node tools/config-check.js
```

交叉解析 `frontend/js/config.js` 与 `crates/sim_core/src/config.rs`，捕获四类问题并以非零退出码报错：

1. **孤儿字段**：前端有 / Rust 无
2. **缺失字段**：Rust 有 / 前端无
3. **类型错配**：`usize/u64` 与浮点混淆
4. **数值漂移**：默认值不一致

通过时输出字段数对比，并自动刷新 `docs/config-reference.md`（参数速查表，**勿手改**）。

> 发布前双绿：`test-wasm.js` + `config-check.js` 均通过方可发布。

### 3.3 Rust 原生编译检查

```powershell
cargo test --lib
```

当前源码无持久化单元测试（见 AGENTS.md §4.10 混沌系统定位），命令通过即代表编译无误。

---

## 4. 前端开发服务器

```powershell
node frontend/server.js
```

- 默认端口 `3000`，内置 `.wasm` MIME（`application/wasm`）
- **若 3000 已被占用，说明用户已手动启动服务，Agent 不要重复启动**——直接访问 `http://localhost:3000`
- server.js 在端口占用时会自动递增重试（3001 → 3002 …），重复启动可能导致多实例并存
- 每次重编译 WASM 后浏览器 `Ctrl + F5` 强制刷新清理缓存
- server.js 以自身所在目录（`frontend/`）为静态根，须在项目根目录执行

---

## 5. 数值热调优（免编译）

所有仿真超参集中在 `frontend/js/config.js`（`window.SIM_CONFIG`），直接编辑保存后浏览器 `Ctrl+F5` 即生效，无需重编译 WASM。

- Rust 侧通过 `SimConfig` 结构体接收，逻辑层一律 `self.config.<字段>` 引用，禁止散落字面量
- 新增超参须在 `config.rs` 三处同步：命名 `const`（默认值唯一真相源）+ `SimConfig` 字段 + `Default` 映射
- 改参后必跑 `node tools/config-check.js`（§3.2）

---

## 6. 故障排查

| 现象 | 原因与处理 |
| :--- | :--- |
| `cargo: command not found` | 便携工具链环境变量未注入，执行 §1.1 的两条 `$env:` 命令 |
| 编译报依赖下载失败 | `CARGO_HOME` 未指向 `.cargo-home`，或离线缓存缺失；确认 `$env:CARGO_HOME = "$PWD\.cargo-home"` |
| 浏览器加载旧逻辑 | WASM 双副本未同步（§2），或浏览器缓存未清（`Ctrl+F5`） |
| `CompileError: Invalid WebAssembly` | MIME 不对。本地 server.js 已内置正确 MIME；若用其他服务器需确保 `.wasm → application/wasm` |
| `test-wasm.js` 确定性失败 | 新增随机消耗破坏了 WorldRng 确定性顺序（AGENTS.md §4.3）；检查新增的 `rng` 调用是否按 agent 顺序消费 |
| `config-check.js` 报字段漂移 | 改了 `config.rs` 但没同步 `config.js`（或反之）；按报错字段名双向对齐 |
| 端口 3000 占用 | 用户已启动服务，直接访问 `http://localhost:3000`；不要重复 `node frontend/server.js` |
| 页面 404 | 确认在项目根目录执行 `node frontend/server.js`；server.js 以 `frontend/` 为静态根 |
