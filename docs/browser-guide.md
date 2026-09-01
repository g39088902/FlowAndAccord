# 🌐 浏览器自动化使用指南 (Browser Guide)

> 本指南由 2026-09-01 的实机验证沉淀而来（4/4 引擎全部通过），记录本机可驱动的浏览器工具链、标准操作流程、防卡死策略与易踩坑清单。需要「打开页面 / 渲染校验 / 截图 / 自动化交互」时按本文操作。

---

## 1. 本机可驱动的浏览器一览（已实测）

驱动工具为 **playwright-cli v0.1.18**，一套工具覆盖 4 个浏览器引擎：

| # | 浏览器引擎 | 来源 | 打开耗时 | 实测结论 |
|---|---|---|---|---|
| 1 | **Chromium** | playwright 内核 `chromium-1237`（`~/Library/Caches/ms-playwright/`） | 3s | ✅ PASS |
| 2 | **Firefox** | playwright 内核 `firefox-1539` | 1s | ✅ PASS |
| 3 | **WebKit** | playwright 内核 `webkit-2342`（Safari 的近似替代引擎） | 2s | ✅ PASS |
| 4 | **Chrome** | 系统已装 `/Applications/Google Chrome.app`，无需下载 | 2s | ✅ PASS |

实测基准：2026-09-01，目标页 `https://example.com`，渲染校验 `document.title` + `h1` 均正确，4 张 1280×720 截图全部有效（产物存于 `~/Downloads/browser-verify/`，报告 `report.md`）。

**无法直接驱动的浏览器**：

- **系统 Safari.app**：playwright-cli 不能驱动 Safari 本体，统一用 **WebKit 引擎**近似覆盖（渲染行为高度一致，报告/文档中须注明）；
- **Edge / Brave / Arc**：本机未安装，装好后 `--browser=msedge` 即可测。

---

## 2. 环境与安装

### 2.1 安装位置（重要）

`/usr/local/bin` 对当前用户**无写权限**（npm 全局安装会报 `EACCES`），因此 playwright-cli 装在**用户级前缀**：

```bash
npm install -g --prefix=$HOME/.local/pw-tools @playwright/cli@latest
# 二进制位置：~/.local/pw-tools/bin/playwright-cli
```

### 2.2 每次使用前先注入 PATH

```bash
export PATH="$HOME/.local/pw-tools/bin:$PATH"
playwright-cli --version   # 应输出 0.1.18
```

### 2.3 浏览器内核（已下载，重装系统后才需要再跑）

```bash
playwright-cli install-browser
# 下载 chromium / firefox / webkit 到 ~/Library/Caches/ms-playwright/
# Chrome 引擎直接驱动系统 Chrome，不占此缓存
```

---

## 3. 标准操作流程

原则：**每个浏览器用独立命名会话（`-s=<名字>`）**，任务结束立即 `close`；多 URL 任务复用同一会话，只在最后 close 一次。

```bash
export PATH="$HOME/.local/pw-tools/bin:$PATH"

# 1. 打开会话并导航（open 即启动浏览器）
playwright-cli -s=mytask open https://example.com
# 系统 Chrome 引擎：playwright-cli -s=mytask open https://example.com --browser=chrome

# 2. 渲染校验（读标题 / 关键 DOM）
playwright-cli -s=mytask eval "document.title"
playwright-cli -s=mytask eval "document.querySelector('h1').textContent"

# 3. 截图（务必用绝对路径落盘）
playwright-cli -s=mytask screenshot --filename=/Users/empathy/Downloads/shot.png

# 4. 收尾（必须！否则留僵尸浏览器进程）
playwright-cli -s=mytask close

# 兜底清理（卡死 / 异常退出后）
playwright-cli kill-all
```

其他常用能力：`snapshot`（可交互元素引用，输出到 `.playwright-cli/` 目录须 `cat` 读取）、`click <ref>`、`fill`、`console`（看页面日志）、`network`（看请求）、`resize 1920 1080`。

---

## 4. ⏱️ 防卡死策略（长期有效，卡死必杀）

浏览器工具以独立守护进程方式运行，**可能无响应挂起**，因此任何自动化脚本都必须限时包裹。

### 4.1 限时包装器 `pw-timeout.mjs`

macOS 无 coreutils `timeout` 命令，使用以下 Node 包装器（放到 `/tmp` 或 `tools/` 均可）：

```js
#!/usr/bin/env node
// 用法: node pw-timeout.mjs <timeout_sec> <cmd> [args...]
// 超时 -> SIGTERM 进程组，3s 后仍存活则 SIGKILL；退出码 124 表示超时
import { spawn } from 'node:child_process';

const [, , timeoutArg, cmd, ...args] = process.argv;
const timeoutMs = Number(timeoutArg) * 1000;
if (!cmd || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error('usage: node pw-timeout.mjs <timeout_sec> <cmd> [args...]');
  process.exit(2);
}

const child = spawn(cmd, args, { stdio: 'inherit', detached: true }); // 独立进程组，便于整树 kill

let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  console.error(`[pw-timeout] TIMEOUT after ${timeoutMs / 1000}s, killing pgid=${-child.pid}`);
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 3000).unref();
}, timeoutMs);

child.on('exit', (code, signal) => {
  clearTimeout(timer);
  process.exit(timedOut ? 124 : signal ? 125 : (code ?? 0));
});
child.on('error', (err) => { clearTimeout(timer); console.error(err.message); process.exit(127); });
```

### 4.2 推荐时限与处置序列

| 命令 | 时限 |
|---|---|
| `open`（含浏览器冷启动） | 40s |
| `eval` / `snapshot` | 20s |
| `screenshot` | 25s |
| `close` | 15s |
| **单浏览器会话总预算** | **90s** |

超时处置序列（按顺序升级）：

```bash
# 1) 包装器已对进程组 SIGTERM→SIGKILL（退出码 124 即为超时标记）
# 2) 会话级兜底：
playwright-cli kill-all
# 3) 进程级兜底（慎用，见 §5.3 坑点）：
pkill -f playwright
```

超时的浏览器标记为 `FAIL(超时)` 后**立即继续下一个目标，不阻塞整体流程**；严格串行逐个测，避免多浏览器互扰。

---

## 5. ⚠️ 易踩坑清单

1. **🔴 zsh 不对未加引号的 `$VAR` 做分词**：`P="playwright-cli -s=x"` 后 `node pw-timeout.mjs 40 $P open ...` 会把整串当一个命令名，报 `ENOENT`。解决：直接写全参数，或用 zsh 的 `${=P}` 强制分词。
2. **🔴 npm 全局安装 `EACCES`**：本机 `/usr/local/bin` 无写权限，禁止 `sudo npm -g`；一律 `--prefix=$HOME/.local/pw-tools` 并在使用前注入 PATH。
3. **🔴 `pkill -f chromium` 会误杀 IDE**：本机 RustRover/CodeBuddy 等基于 JCEF（内嵌 Chromium），模糊 pkill 会波及 IDE。清理只允许 `pkill -f playwright` / `playwright-cli kill-all`，并先 `pgrep -fl` 核对进程命令行再杀。
4. **🟠 `close` 必须在 finally 语义下执行**：成功、失败、超时路径都要收尾，否则留下守护进程与浏览器进程占用内存。
5. **🟠 `snapshot` 输出落盘不落 stdout**：默认写到 `.playwright-cli/page-*.yml`，须 `cat` 读取；该目录生成在**当前工作目录**（可能污染工作区），任务结束应清理，勿提交进 git。
6. **🟡 截图字节数相同 ≠ 未更新**：同一极简页面 + 相同视口，多引擎 PNG 可完全同字节（本次 4 张均 16667B）。判截图有效性用 `file <png>`（确认 1280×720 PNG），勿比字节数。
7. **🟡 判定标准三件套**：打开成功（exit 0）+ 渲染成功（`document.title` / 关键 DOM 非空）+ 截图成功（`file` 确认有效 PNG），三者齐备才算 PASS。

---

## 6. 相关产物与验证记录

- 实测截图与报告：`~/Downloads/browser-verify/`（`chromium.png` / `firefox.png` / `webkit.png` / `chrome.png` / `report.md`）
- 浏览器内核缓存：`~/Library/Caches/ms-playwright/`
- 工具链安装位置：`~/.local/pw-tools/`
- 另一可用方案 `agent-browser`（vercel-labs，单 Chromium）：本机未安装，需要时 `npm install -g agent-browser && agent-browser install`；与 playwright-cli 二选一即可，勿并行装浏览器（下载互不匹配）。
