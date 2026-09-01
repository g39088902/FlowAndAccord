# 浏览器自动化使用指南 (Browser Guide)

> 用于「打开页面 / 渲染校验 / 截图 / 自动化交互」。驱动工具为 playwright-cli，一套命令覆盖多浏览器引擎。
>
> 当前版本：v1.0.1 · 环境：Windows

---

## 1. 可驱动浏览器一览

| 引擎 | 来源 | 说明 |
| :--- | :--- | :--- |
| **Chromium** | playwright 内置内核 | `playwright-cli install-browser` 下载 |
| **Firefox** | playwright 内置内核 | 同上 |
| **WebKit** | playwright 内置内核 | Safari 近似替代引擎 |
| **Chrome** | 系统已装 Chrome | `--browser=chrome` 驱动，无需下载 |

> 无法直接驱动系统 Safari（Windows 无 Safari）；Edge / Brave 装好后可用 `--browser=msedge`。

---

## 2. 安装与环境

### 2.1 安装 playwright-cli

```powershell
npm install -g @playwright/cli
```

安装后二进制位于：

```
C:\Users\<用户名>\AppData\Roaming\npm\playwright-cli.cmd
```

验证：

```powershell
playwright-cli --version   # 应输出 0.1.18
```

### 2.2 下载浏览器内核（首次或重装后）

```powershell
playwright-cli install-browser
```

内核缓存到 `%LOCALAPPDATA%\ms-playwright\`。Chrome 直接驱动系统安装版，不占此缓存。

---

## 3. 标准操作流程

原则：**每个任务用独立命名会话（`-s=<名字>`）**，结束立即 `close`；多 URL 复用同一会话，最后 close 一次。

```powershell
# 1. 打开会话并导航（open 即启动浏览器）
playwright-cli -s=mytask open https://example.com
# 系统 Chrome：playwright-cli -s=mytask open https://example.com --browser=chrome

# 2. 渲染校验
playwright-cli -s=mytask eval "document.title"
playwright-cli -s=mytask eval "document.querySelector('h1').textContent"

# 3. 截图（用绝对路径落盘）
playwright-cli -s=mytask screenshot --filename=C:\Users\<用户名>\Downloads\shot.png

# 4. 收尾（必须！否则留僵尸浏览器进程）
playwright-cli -s=mytask close

# 兜底清理（卡死 / 异常退出后）
playwright-cli kill-all
```

其他能力：`snapshot`（可交互元素引用，输出到 `.playwright-cli\` 目录须 `type` 读取）、`click <ref>`、`fill`、`console`、`network`、`resize 1920 1080`。

---

## 4. 防卡死限时策略

浏览器以独立守护进程运行，可能无响应挂起，任何自动化调用都应限时包裹。

### 4.1 PowerShell 限时包装函数

```powershell
# 用法：Invoke-WithTimeout -Seconds <秒数> -Cmd @("命令", "参数1", "参数2", ...)
# 超时 -> 强制结束进程，返回 124
function Invoke-WithTimeout {
  param([int]$Seconds, [string[]]$Cmd)
  $p = Start-Process -FilePath $Cmd[0] -ArgumentList $Cmd[1..($Cmd.Length - 1)] -NoNewWindow -PassThru
  if (-not $p.WaitForExit($Seconds * 1000)) {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    return 124
  }
  return $p.ExitCode
}

# 示例：限时 40s 打开页面
Invoke-WithTimeout -Seconds 40 -Cmd @("playwright-cli", "-s=mytask", "open", "https://example.com")
```

### 4.2 推荐时限

| 命令 | 时限 |
| :--- | :--- |
| `open`（含浏览器冷启动） | 40s |
| `eval` / `snapshot` | 20s |
| `screenshot` | 25s |
| `close` | 15s |
| **单会话总预算** | **90s** |

超时处置序列：

1. 包装器强制结束进程（退出码 124）
2. `playwright-cli kill-all` 清理会话
3. 必要时结束浏览器进程（慎用，见 §5.2）

超时的目标标记为 `FAIL(超时)` 后立即继续下一个，不阻塞整体流程；严格串行逐个测，避免多浏览器互扰。

---

## 5. 易踩坑清单

1. **🔴 `close` 必须在 finally 语义下执行**：成功、失败、超时路径都要收尾，否则留下守护进程与浏览器进程占内存。
2. **🔴 模糊杀进程会误杀 IDE**：RustRover / VS Code 等基于 JCEF（内嵌 Chromium），`taskkill /F /IM chrome.exe` 会波及 IDE。清理优先用 `playwright-cli kill-all`，杀进程前先在任务管理器核对命令行。
3. **🟠 `snapshot` 输出落盘不落 stdout**：默认写到当前工作目录的 `.playwright-cli\page-*.yml`，须 `type` 读取；该目录可能污染工作区，任务结束应清理，勿提交 git。
4. **🟠 截图字节数相同 ≠ 未更新**：同一极简页面 + 相同视口，多引擎 PNG 可完全同字节。判有效性用分辨率 / 文件格式确认，勿比字节数。
5. **🟡 判定标准三件套**：打开成功（exit 0）+ 渲染成功（`document.title` / 关键 DOM 非空）+ 截图成功（有效 PNG），三者齐备才算 PASS。
6. **🟡 截图路径用绝对路径**：相对路径基于当前工作目录，跨脚本调用时容易找不到文件。
