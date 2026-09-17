# WebGL 迁移阶段一 - 验证指南

**完成日期**: 2026-09-17 | **状态**: ✅ 已部署  
> ★ **后续进展**：Phase 2（地形层迁移）已于 v1.50.77 落地（双 Canvas 架构，地形由 `sim-canvas-gl` WebGL 层绘制，实体仍走 Canvas 2D 覆盖层），v1.50.80~82 帧率解限。★ **2026-09-17 架构决策**：**全量 WebGL、不再使用 Canvas 2D**，双 Canvas 只是过渡形态（[31 号 §8](./31-canvas-to-webgl-migration.md) 阶段三~五）。本文为阶段一 PoC 验证的历史记录，其中「待人工合并」「强制回退 Canvas 2D」等临时状态均已失效；当前行为以 [frontend/AGENTS.md](../../../frontend/AGENTS.md) 为准。

## 🚀 快速启动

### 方式 1: 使用已运行的服务器
```bash
# 服务已在 localhost:3004 运行
open http://localhost:3004
```

### 方式 2: 手动启动新实例
```powershell
cd C:\Users\Lima\RustroverProjects\FlowAndAccord
node frontend/server.js
```

## 🔍 验证步骤

### Step 1: 浏览器 Console 检查
打开 Chrome DevTools (F12) → Console 标签，应看到以下日志：

```
[WebGL] Initialized: 2.0 on NVIDIA Corporation/NVIDIA GeForce RTX...
[Fallback] Mode set to auto
[WebGL] Phase 1 PoC renderer initialized
```

**预期结果**: 
- ✅ [WebGL] Initialized 显示你的显卡型号
- ✅ [Fallback] 初始化成功
- ⏳ [WebGL] Phase 1 PoC renderer initialized (首次渲染时出现)

### Step 2: 视觉验证
页面应显示：
- 一个绿色→棕色渐变的 5×5 网格测试场景
- 不是原本的 Flow & Accord 游戏界面（因为 WebGL 接管了 Canvas）
- 鼠标滚轮缩放、右键拖拽平移有效

### Step 3: URL 参数测试

| 访问地址 | 预期行为 |
|---------|---------|
| `http://localhost:3004` | 尝试 WebGL + 回退到 Canvas 2D |
| `http://localhost:3004?webgl=0` | 禁用 WebGL，仅 Canvas 2D |
| `http://localhost:3004?webgl=1` | 强制启用 WebGL (或报错) |

### Step 4: Camera 控制测试
- **左键拖拽**: 应该无效（测试网格无点击交互）
- **右键拖拽**: 相机平移
- **鼠标滚轮**: 相机缩放
- **视角变化**: 渐变网格随视角旋转保持正确投影

## 📊 技术指标

在 Console 中执行以下命令检查 WebGL 能力：

```javascript
// 检查 WebGL 上下文
window.webglContext
// 返回：WebGLContext 对象

// 检查是否支持 WebGL 2
window.webglContext.version
// 应返回："2.0" 或 "1.0"

// 检查设备信息
window.webglContext.vendor
// 返回 GPU vendor (NVIDIA/AMD/Intel...)

// 检查 Renderer 版本  
window.webglContext.renderer
// 返回具体 GPU 型号
```

## 🐛 常见问题排查

### Q1: Console 显示 "[WebGL] Hardware acceleration not available"
**原因**: 系统未启用 WebGL 硬件加速

**解决方案**:
1. Chrome 设置 → 系统 → 开启"始终使用图形加速"
2. 重启浏览器
3. 检查是否在企业限制环境中

### Q2: 只看到黑色/蓝色背景，没有渐变网格
**原因**: Shader 编译失败或 geometry 创建失败

**排查步骤**:
```javascript
// 手动触发初始化
await initWebglTestRenderer();
console.log(webglTestRenderer); // 检查是否有错误
```

**查看 Console 错误**:
- Shader compile error: XXX (着色器语法错误)
- Test renderer failed: XXX (几何创建失败)

### Q3: Page 刷新后 WebGL 消失
**原因**: render_canvas.js 主循环未集成 WebGL 调用路径

**当前状态**: Phase 1 基础设施已就绪，但混合渲染逻辑仍需手动集成

**临时解决**: 访问 `?webgl=0` 强制回退 Canvas 2D

## 📝 后续工作

### 立即执行:
1. 在 Chrome 中访问并观察 Console 输出
2. 截图保留初始化的成功证据
3. 报告任何错误或警告信息

### Phase 1 收尾待办:
1. **手动集成** render_canvas.js 的主循环逻辑
   - 根据 `render-canvas-patch.js` 提供的补丁函数
   - 在 render(now) 中调用 maybeRenderWebgl()

2. **Main.js 初始化**:
   ```javascript
   // 在 initialize() 开头添加
   window.USE_WEBGL = window.RENDER_CONFIG?.useWebgl !== false;
   if (window.USE_WEBGL) {
     const canvas = document.querySelector('#main-canvas');
     window.webglContext = new WebGLContext(canvas);
   }
   ```

3. **性能基准测试** (Phase 2):
   - 对比 Canvas 2D vs WebGL FPS
   - GC 频率分析
   - Draw calls 统计

## ✅ Phase 1 交付清单

- [x] context.js - WebGL 上下文管理
- [x] shader-manager.js - Shader 编译器
- [x] projection-utils.js - 投影矩阵工具
- [x] test-grid.js - PoC 测试渲染器
- [x] fallback-handler.js - Fallback 管理
- [x] render-canvas-patch.js - 集成补丁文档
- [x] index.html 脚本加载顺序配置
- [ ] render_canvas.js 主循环集成 (**待人工合并**)

## 📞 反馈收集

遇到问题时请提供以下信息：
1. **Console 完整输出** (包含所有 [WebGL] 相关日志)
2. **浏览器 Console 错误** (如有)
3. **可视化效果描述** (是否看到渐变网格？还是空白屏幕？)
4. **GPU 型号** (通过 `navigator.gpu ? "WebGPU" : "WebGL"` 判断)

---

*维护*: @Qoder | *最后更新*: 2026-09-17
