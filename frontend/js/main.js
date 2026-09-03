// === 全局初始化、相机控制与 UI 事件绑定 ===
    const canvas = document.getElementById('sim-canvas');
    const ctx = canvas.getContext('2d');
    const sim = new RustWorld();
    window.rustWorldSim = sim; // 供 decision-viz.js 热注入决策顺序配置（共用同一引擎实例）

    let camera = {
      rotX: 1.05,
      rotZ: 0.60,
      zoom: 1.15,
      panX: 0,
      panY: 30
    };

    function resizeCanvas() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    let isDragging = false, lastMouse = { x: 0, y: 0 }, isRightBtn = false;
    let isCameraFollow = false;
    let totalDragDist = 0;
    let mousePos = { x: -1000, y: -1000 };
    let hoveredLane = null;

    canvas.addEventListener('mousedown', e => {
      isDragging = true;
      isRightBtn = e.button === 2;
      lastMouse = { x: e.clientX, y: e.clientY };
      totalDragDist = 0;
    });
    window.addEventListener('mouseup', () => isDragging = false);
    window.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('mousemove', e => {
      mousePos.x = e.clientX;
      mousePos.y = e.clientY;
      if (!isDragging) return;
      const dx = e.clientX - lastMouse.x;
      const dy = e.clientY - lastMouse.y;
      totalDragDist += Math.hypot(dx, dy);

      if (isRightBtn || e.shiftKey) {
        // 右键拖拽 / Shift+拖拽: 旋转 3D 视角
        camera.rotZ += dx * 0.006;
        camera.rotX = Math.max(0.15, Math.min(1.45, camera.rotX + dy * 0.006));
      } else {
        // 左键拖拽: 平移地图视角
        camera.panX += dx;
        camera.panY += dy;
        if (Math.hypot(dx, dy) > 2) {
          isCameraFollow = false;
          if (typeof updateFollowBtnState === 'function') updateFollowBtnState();
        }
      }
      lastMouse = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('mouseleave', () => {
      mousePos.x = -1000;
      mousePos.y = -1000;
      hoveredLane = null;
      const tooltip = document.getElementById('road-hover-tooltip');
      if (tooltip) tooltip.style.display = 'none';
    });
    canvas.addEventListener('wheel', e => {
      camera.zoom = Math.max(0.35, Math.min(4.5, camera.zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
    });

    function distToSegment(px, py, x1, y1, x2, y2) {
      const dx = x2 - x1, dy = y2 - y1;
      const l2 = dx * dx + dy * dy;
      if (l2 === 0) return Math.hypot(px - x1, py - y1);
      let t = ((px - x1) * dx + (py - y1) * dy) / l2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    }

    function project3D(v3) {
      const cx = window.innerWidth / 2 + camera.panX;
      const cy = window.innerHeight / 2 + camera.panY;

      const cosZ = Math.cos(camera.rotZ), sinZ = Math.sin(camera.rotZ);
      const rx = v3.x * cosZ - v3.y * sinZ;
      const ry = v3.x * sinZ + v3.y * cosZ;

      const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);
      const y2 = ry * cosX - v3.z * sinX;
      const z2 = ry * sinX + v3.z * cosX;

      const scale = camera.zoom;
      return { x: cx + rx * scale, y: cy + y2 * scale, depth: z2 };
    }

    function getElevationColor(cell, minZ, maxZ) {
      const { elev, dzdx, dzdy } = cell;
      const range = Math.max(1, maxZ - minZ);
      const normZ = Math.max(0, Math.min(1, (elev - minZ) / range));
      const lightFactor = Math.max(0.70, Math.min(1.30, 1.0 + (-dzdx * 0.35 - dzdy * 0.35)));

      let r, g, b;
      if (normZ < 0.45) {
        const t = normZ / 0.45;
        r = Math.floor(16 + t * (40 - 16));
        g = Math.floor(150 + t * (180 - 150));
        b = Math.floor(100 + t * (70 - 100));
      } else if (normZ < 0.75) {
        const t = (normZ - 0.45) / 0.30;
        r = Math.floor(40 + t * (190 - 40));
        g = Math.floor(180 + t * (160 - 180));
        b = Math.floor(70 + t * (40 - 70));
      } else {
        const t = (normZ - 0.75) / 0.25;
        r = Math.floor(190 + t * (160 - 190));
        g = Math.floor(160 + t * (165 - 160));
        b = Math.floor(40 + t * (170 - 40));
      }

      return `rgba(${Math.floor(r * lightFactor)}, ${Math.floor(g * lightFactor)}, ${Math.floor(b * lightFactor)}, 0.55)`;
    }


    // ==========================================
    // Inspector 监控面板点击穿梭与族谱跳转事件委托
    // ==========================================
    const inspectorCard = document.getElementById('inspector-card');
    if (inspectorCard) {
      inspectorCard.addEventListener('click', e => {
        // ★ v1.9.0 Task8: agent 卡片点击房屋引用 → 跳转房屋卡片
        const houseChip = e.target.closest('[data-house-id]');
        if (houseChip) {
          e.stopPropagation();
          const hid = parseInt(houseChip.getAttribute('data-house-id'), 10);
          const targetHouse = sim.houses.find(h => h.id === hid);
          if (targetHouse) {
            sim.selectionType = 'house';
            sim.selectedHouseId = targetHouse.id;
            isCameraFollow = false;
            const cosZ = Math.cos(camera.rotZ), sinZ = Math.sin(camera.rotZ);
            const rx = targetHouse.pos.x * cosZ - targetHouse.pos.y * sinZ;
            const ry = targetHouse.pos.x * sinZ + targetHouse.pos.y * cosZ;
            const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);
            const y2 = ry * cosX - (targetHouse.pos.z || 0) * sinX;
            camera.panX = -rx * camera.zoom;
            camera.panY = -y2 * camera.zoom;
            if (typeof updateFollowBtnState === 'function') updateFollowBtnState();
          }
          return;
        }
        const chip = e.target.closest('[data-agent-id]');
        if (chip) {
          e.stopPropagation();
          const targetId = parseInt(chip.getAttribute('data-agent-id'), 10);
          if (!isNaN(targetId)) {
            sim.selectionType = 'agent';
            sim.selectedAgentId = targetId;
            const targetAgent = (typeof sim.getAgent === 'function') ? sim.getAgent(targetId) : sim.agents.find(a => a.id === targetId);
            if (targetAgent) {
              const cosZ = Math.cos(camera.rotZ), sinZ = Math.sin(camera.rotZ);
              const rx = targetAgent.pos.x * cosZ - targetAgent.pos.y * sinZ;
              const ry = targetAgent.pos.x * sinZ + targetAgent.pos.y * cosZ;
              const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);
              const y2 = ry * cosX - (targetAgent.pos.z || 0) * sinX;

              camera.panX = -rx * camera.zoom;
              camera.panY = -y2 * camera.zoom;
              // ★ M1.7 胎儿无地图实体：定位一次但不跟随
              isCameraFollow = !!targetAgent.isAlive && !targetAgent.isFetus;
              if (typeof updateFollowBtnState === 'function') updateFollowBtnState();
            }
          }
        }
      });
    }

    // ==========================================
    // 家族世系族谱模态弹窗打开/关闭与穿梭跳转
    // ==========================================
    const lineageModal = document.getElementById('lineage-modal');
    const openLineageBtn = document.getElementById('btn-open-lineage-modal');
    const closeLineageBtn = document.getElementById('btn-close-lineage-modal');

    function openLineageModal() {
      if (lineageModal) lineageModal.style.display = 'flex';
    }
    function closeLineageModal() {
      if (lineageModal) lineageModal.style.display = 'none';
    }

    if (openLineageBtn) {
      openLineageBtn.addEventListener('click', e => {
        e.stopPropagation();
        openLineageModal();
      });
    }
    if (closeLineageBtn) {
      closeLineageBtn.addEventListener('click', e => {
        e.stopPropagation();
        closeLineageModal();
      });
    }
    if (lineageModal) {
      lineageModal.addEventListener('click', e => {
        if (e.target === lineageModal) {
          closeLineageModal();
          return;
        }
        // ★ v1.9.0 Task8: 族谱弹窗中点击房屋引用 → 跳转房屋卡片
        const houseChip = e.target.closest('[data-house-id]');
        if (houseChip) {
          e.stopPropagation();
          closeLineageModal();
          const hid = parseInt(houseChip.getAttribute('data-house-id'), 10);
          const targetHouse = sim.houses.find(h => h.id === hid);
          if (targetHouse) {
            sim.selectionType = 'house';
            sim.selectedHouseId = targetHouse.id;
            isCameraFollow = false;
            const cosZ = Math.cos(camera.rotZ), sinZ = Math.sin(camera.rotZ);
            const rx = targetHouse.pos.x * cosZ - targetHouse.pos.y * sinZ;
            const ry = targetHouse.pos.x * sinZ + targetHouse.pos.y * cosZ;
            const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);
            const y2 = ry * cosX - (targetHouse.pos.z || 0) * sinX;
            camera.panX = -rx * camera.zoom;
            camera.panY = -y2 * camera.zoom;
            if (typeof updateFollowBtnState === 'function') updateFollowBtnState();
          }
          return;
        }
        const chip = e.target.closest('[data-agent-id]');
        if (chip) {
          e.stopPropagation();
          const targetId = parseInt(chip.getAttribute('data-agent-id'), 10);
          if (!isNaN(targetId)) {
            sim.selectionType = 'agent';
            sim.selectedAgentId = targetId;
            const targetAgent = (typeof sim.getAgent === 'function') ? sim.getAgent(targetId) : sim.agents.find(a => a.id === targetId);
            if (targetAgent) {
              const cosZ = Math.cos(camera.rotZ), sinZ = Math.sin(camera.rotZ);
              const rx = targetAgent.pos.x * cosZ - targetAgent.pos.y * sinZ;
              const ry = targetAgent.pos.x * sinZ + targetAgent.pos.y * cosZ;
              const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);
              const y2 = ry * cosX - (targetAgent.pos.z || 0) * sinX;

              camera.panX = -rx * camera.zoom;
              camera.panY = -y2 * camera.zoom;
              // ★ M1.7 胎儿无地图实体：定位一次但不跟随
              isCameraFollow = !!targetAgent.isAlive && !targetAgent.isFetus;
              if (typeof updateFollowBtnState === 'function') updateFollowBtnState();
            }
          }
        }
      });
    }

    const openFullDagBtn = document.getElementById('btn-open-full-dag');
    if (openFullDagBtn) {
      openFullDagBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (window.FlowDag) {
          window.FlowDag.openInNewTab(sim.selectedAgentId, sim);
        }
      });
    }

    // ==========================================
    // Inspector 关闭按钮 (✕) 与 Esc 快捷键 (关闭 agent/poi/house 选中窗口)
    // ==========================================
    function closeInspector() {
      sim.deselect();
      isCameraFollow = false;
      closeLineageModal();
      // 走 FlowDag.closeModal() 以正确销毁视口虚拟化视图 (DOM 回收 + 事件解绑)
      if (window.FlowDag && typeof window.FlowDag.closeModal === 'function') {
        window.FlowDag.closeModal();
      } else {
        const fullDagModal = document.getElementById('full-dag-modal');
        if (fullDagModal) fullDagModal.style.display = 'none';
      }
      if (typeof updateFollowBtnState === 'function') updateFollowBtnState();
      const card = document.getElementById('inspector-card');
      if (card) card.style.display = 'none';
    }
    const closeInspBtn = document.getElementById('insp-close-btn');
    if (closeInspBtn) {
      closeInspBtn.addEventListener('click', e => {
        e.stopPropagation();
        closeInspector();
      });
    }
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        const fullDagModal = document.getElementById('full-dag-modal');
        if (fullDagModal && fullDagModal.style.display === 'flex') {
          if (window.FlowDag && typeof window.FlowDag.closeModal === 'function') window.FlowDag.closeModal();
          else fullDagModal.style.display = 'none';
          return;
        }
        if (lineageModal && lineageModal.style.display === 'flex') {
          closeLineageModal();
          return;
        }
        closeInspector();
      }
    });

    // ==========================================
    // 玩家手动资源生成速率滑块绑定 (水/果/木/石/金)
    // ★ v1.22.6 基准产速统一读 SIM_CONFIG（禁止写死字面量），倍率以内核为唯一真相源
    // ==========================================
    const ECO_SLIDERS = [
      { key: 'water', sliderId: 'slider-water-rate',  lblId: 'lbl-water-rate',  baseKey: 'regenBaseWater', setter: 'setWaterRegenMultiplier' },
      { key: 'berry', sliderId: 'slider-berry-rate',  lblId: 'lbl-berry-rate',  baseKey: 'regenBaseBerry', setter: 'setBerryRegenMultiplier' },
      { key: 'wood',  sliderId: 'slider-wood-rate',   lblId: 'lbl-wood-rate',   baseKey: 'regenBaseWood',  setter: 'setWoodRegenMultiplier' },
      { key: 'stone', sliderId: 'slider-stone-rate',  lblId: 'lbl-stone-rate',  baseKey: 'regenBaseStone', setter: 'setStoneRegenMultiplier' },
      { key: 'gold',  sliderId: 'slider-gold-rate',   lblId: 'lbl-gold-rate',   baseKey: 'regenBaseGold',  setter: 'setGoldRegenMultiplier' },
    ];
    // 每类资源的基础产速（取自前端配置镜像 SIM_CONFIG，与 Rust config.rs 保持同步）
    const ecoBaseRate = def => {
      const cfg = window.SIM_CONFIG || {};
      return typeof cfg[def.baseKey] === 'number' ? cfg[def.baseKey] : 0.0;
    };
    // 滑块标签文案：生效产速 = 基准 × 倍率（与 POI 卡片「产出速率」同一算法）
    const ecoSliderLabel = (def, mult) => {
      const actualRate = ecoBaseRate(def) * (isFinite(mult) ? mult : 1.0);
      return `${(isFinite(mult) ? mult : 1.0).toFixed(1)}x (${actualRate.toFixed(2)}/s)`;
    };
    // 用户拖拽期间禁止内核回写滑块，否则会与拖动打架
    let ecoSliderDragging = false;

    for (const def of ECO_SLIDERS) {
      def.sliderEl = document.getElementById(def.sliderId);
      def.lblEl = document.getElementById(def.lblId);
      if (!def.sliderEl || !def.lblEl) continue;
      def.sliderEl.addEventListener('input', e => {
        const mult = parseFloat(e.target.value);
        if (typeof sim[def.setter] === 'function') sim[def.setter](mult);
        def.lblEl.textContent = ecoSliderLabel(def, mult);
      });
      def.sliderEl.addEventListener('pointerdown', () => { ecoSliderDragging = true; });
      def.sliderEl.addEventListener('pointerup', () => { ecoSliderDragging = false; });
      def.sliderEl.addEventListener('pointercancel', () => { ecoSliderDragging = false; });
      def.sliderEl.addEventListener('blur', () => { ecoSliderDragging = false; });
    }

    // ★ 内核倍率 → 滑块回写：读档/重置/重开后滑块自动回到世界真实倍率。
    // 仅在数值真的变化时写 DOM，避免每帧 5 次无谓写入。
    window.syncEcoRegenSliders = function () {
      if (ecoSliderDragging || !sim || !sim.regenMultipliers) return;
      for (const def of ECO_SLIDERS) {
        if (!def.sliderEl || !def.lblEl) continue;
        const mult = sim.regenMultipliers[def.key];
        if (typeof mult !== 'number' || !isFinite(mult)) continue;
        if (Math.abs(parseFloat(def.sliderEl.value) - mult) > 1e-4) def.sliderEl.value = String(mult);
        const txt = ecoSliderLabel(def, mult);
        if (def.lblEl.textContent !== txt) def.lblEl.textContent = txt;
      }
    };

    document.getElementById('btn-reset-rate').addEventListener('click', () => {
      for (const def of ECO_SLIDERS) {
        if (!def.sliderEl || !def.lblEl) continue;
        def.sliderEl.value = '1.0';
        if (typeof sim[def.setter] === 'function') sim[def.setter](1.0);
        def.lblEl.textContent = ecoSliderLabel(def, 1.0);
      }
      sim.logEvent(`🔄 产速重置: 全局资源已恢复默认基准产率！`, 'water');
    });

    // ==========================================
    // 镜头跟随小人与传送至私宅功能绑定
    // ==========================================
    const btnFollow = document.getElementById('btn-toggle-follow');
    const btnTeleportHouse = document.getElementById('btn-teleport-house');

    function updateFollowBtnState() {
      if (!btnFollow) return;
      if (isCameraFollow) {
        btnFollow.textContent = '🎥 跟随中';
        btnFollow.classList.add('following');
      } else {
        btnFollow.textContent = '🎥 跟随';
        btnFollow.classList.remove('following');
      }
    }
    if (btnFollow) {
      btnFollow.addEventListener('click', () => {
        isCameraFollow = !isCameraFollow;
        updateFollowBtnState();
      });
    }

    if (btnTeleportHouse) {
      btnTeleportHouse.addEventListener('click', e => {
        e.stopPropagation();
        if (sim.selectionType === 'agent' && sim.selectedAgentId !== null) {
          const selAgent = (typeof sim.getAgent === 'function') ? sim.getAgent(sim.selectedAgentId) : sim.agents.find(a => a.id === sim.selectedAgentId);
          if (selAgent && selAgent.homeHouseId) {
            const targetHouse = sim.houses.find(h => h.id === selAgent.homeHouseId);
            if (targetHouse) {
              sim.selectionType = 'house';
              sim.selectedHouseId = targetHouse.id;
              isCameraFollow = false;

              // 相机平移聚焦到私宅坐标
              const cosZ = Math.cos(camera.rotZ), sinZ = Math.sin(camera.rotZ);
              const rx = targetHouse.pos.x * cosZ - targetHouse.pos.y * sinZ;
              const ry = targetHouse.pos.x * sinZ + targetHouse.pos.y * cosZ;
              const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);
              const y2 = ry * cosX - (targetHouse.pos.z || 0) * sinX;

              camera.panX = -rx * camera.zoom;
              camera.panY = -y2 * camera.zoom;
              updateFollowBtnState();
            }
          }
        }
      });
    }

    // ==========================================
    // 全局活人属性均值卡片折叠 / 展开交互 (默认折叠)
    // ==========================================
    const avgCardEl = document.getElementById('global-averages-card');
    const avgCardHeader = document.getElementById('avg-card-header');
    const avgToggleIcon = document.getElementById('avg-toggle-icon');
    let isAvgCardMinimized = true;

    function toggleAvgCardMinimize() {
      isAvgCardMinimized = !isAvgCardMinimized;
      if (isAvgCardMinimized) {
        avgCardEl.classList.add('minimized');
        avgToggleIcon.textContent = '+';
        avgCardHeader.title = '点击展开全局活人属性均值';
      } else {
        avgCardEl.classList.remove('minimized');
        avgToggleIcon.textContent = '−';
        avgCardHeader.title = '点击折叠全局活人属性均值';
      }
    }

    if (avgCardHeader) {
      avgCardHeader.addEventListener('click', () => {
        toggleAvgCardMinimize();
      });
    }

    // ==========================================
    // 图例折叠 / 展开交互 (默认折叠)
    // ==========================================
    const legendEl = document.getElementById('ecology-legend');
    const legendHeader = document.getElementById('legend-header');
    const legendToggleIcon = document.getElementById('legend-toggle-icon');
    let isLegendMinimized = true;

    function toggleLegendMinimize() {
      isLegendMinimized = !isLegendMinimized;
      if (isLegendMinimized) {
        legendEl.classList.add('minimized');
        legendToggleIcon.textContent = '+';
        legendHeader.title = '点击展开图例';
      } else {
        legendEl.classList.remove('minimized');
        legendToggleIcon.textContent = '−';
        legendHeader.title = '点击最小化图例';
      }
    }

    legendHeader.addEventListener('click', () => {
      toggleLegendMinimize();
    });

    // ★ 家户与账本大盘折叠/展开 (与图例/均值大盘一致：CSS 控制 body 显隐)
    const _ledgerPanel = document.getElementById('ledger-panel');
    const _ledgerToggleIcon = document.getElementById('ledger-toggle-icon');
    const _ledgerPanelHeader = document.getElementById('ledger-panel-header');
    if (_ledgerPanelHeader) {
      _ledgerPanelHeader.addEventListener('click', () => {
        const isMin = _ledgerPanel.classList.toggle('minimized');
        if (_ledgerToggleIcon) _ledgerToggleIcon.textContent = isMin ? '+' : '−';
      });
    }


    // ==========================================
    // UI 控制绑定与倍速本地记忆 (空格键暂停/继续)
    // ==========================================
    const btnPause = document.getElementById('btn-pause');
    function togglePause() {
      sim.isPaused = !sim.isPaused;
      btnPause.textContent = sim.isPaused ? '▶️ 继续模拟 (空格)' : '⏸️ 暂停模拟 (空格)';
    }
    btnPause.addEventListener('click', togglePause);

    // ==========================================
    // 🧠 无头模式: 只推进模拟、跳过画布渲染 (长程快速演化)
    // ==========================================
    const btnHeadless = document.getElementById('btn-headless');
    function updateHeadlessBtnState() {
      if (sim.headless) {
        btnHeadless.textContent = '🧠 无头模式 (运行中)';
        btnHeadless.style.borderColor = '#a78bfa';
        btnHeadless.style.color = '#a78bfa';
        btnHeadless.style.background = 'rgba(167, 139, 250, 0.15)';
      } else {
        btnHeadless.textContent = '🧠 无头模式';
        btnHeadless.style.borderColor = '#f59e0b';
        btnHeadless.style.color = '#f59e0b';
        btnHeadless.style.background = 'rgba(245, 158, 11, 0.12)';
      }
    }
    btnHeadless.addEventListener('click', () => {
      sim.headless = !sim.headless;
      updateHeadlessBtnState();
      sim.logEvent(sim.headless
        ? '🧠 已进入无头模式: 只推进模拟，暂停画布渲染 (可配合32x倍速长程演化)！'
        : '🎨 已退出无头模式: 恢复画布渲染！', 'camp');
    });

    // ==========================================
    // 🐞 调试模式: Tick / CPU 耗时 / 内存占用监视器
    // ==========================================
    const chkDebugMode = document.getElementById('chk-debug-mode');
    const debugHudEl = document.getElementById('debug-hud');
    if (chkDebugMode) {
      chkDebugMode.addEventListener('change', e => {
        sim.debugMode = e.target.checked;
        if (debugHudEl) debugHudEl.style.display = sim.debugMode ? 'flex' : 'none';
      });
    }

    window.addEventListener('keydown', e => {
      if (e.code === 'Space' || e.key === ' ') {
        const t = e.target;
        const tag = t.tagName;
        // 仅在真正的文本输入场景保留空格键原始输入；
        // 其余控件（按钮/滑块/下拉菜单/勾选框等）操作结束后按空格统一表示「暂停/继续」，
        // 避免焦点残留在 web 控件上导致空格键被控件消费掉。
        const isTextEntry = (tag === 'TEXTAREA')
          || (tag === 'INPUT' && /^(text|search|password|email|number|tel|url)$/i.test(t.type || ''))
          || (t.isContentEditable === true);
        if (isTextEntry) return;
        e.preventDefault();
        togglePause();
      }
    });

    document.getElementById('btn-reroll-eco').addEventListener('click', () => {
      sim.initEcology(20);
      isCameraFollow = false;
      updateFollowBtnState();
    });

    // ==========================================
    // 视图显隐开关: 隐藏部落民 / 隐藏路网
    // ==========================================
    const chkHideAgents = document.getElementById('chk-hide-agents');
    if (chkHideAgents) {
      chkHideAgents.addEventListener('change', e => {
        sim.showAgents = !e.target.checked;
      });
    }
    const chkHideLanes = document.getElementById('chk-hide-lanes');
    if (chkHideLanes) {
      chkHideLanes.addEventListener('change', e => {
        sim.showLanes = !e.target.checked;
      });
    }

    const selSpeed = document.getElementById('sel-speed');
    const savedSpeed = localStorage.getItem('flow_sim_speed');
    if (savedSpeed) {
      selSpeed.value = savedSpeed;
      sim.speedMult = parseInt(savedSpeed, 10) || 2;
    } else {
      sim.speedMult = parseInt(selSpeed.value, 10) || 2;
    }
    selSpeed.addEventListener('change', e => {
      const val = parseInt(e.target.value, 10);
      sim.speedMult = val;
      try {
        localStorage.setItem('flow_sim_speed', val.toString());
      } catch (_) {}
    });

    // ==========================================
    // ★ 统一 Agent 聚焦跳转：平移相机至该族人并立即打开右侧 Inspector 角色卡片
    //   (v1.21.1 修复 centerOnAgent 不存在导致的点击无反应)
    // ==========================================
    window.focusOnAgent = function focusOnAgent(agentId) {
      if (agentId == null) return;
      const targetId = parseInt(agentId, 10);
      if (isNaN(targetId)) return;
      const targetAgent = (typeof sim.getAgent === 'function') ? sim.getAgent(targetId) : sim.agents.find(a => a.id === targetId);
      if (!targetAgent) return;
      sim.selectionType = 'agent';
      sim.selectedAgentId = targetId;
      // 相机平移对齐至族人坐标
      const cosZ = Math.cos(camera.rotZ), sinZ = Math.sin(camera.rotZ);
      const rx = targetAgent.pos.x * cosZ - targetAgent.pos.y * sinZ;
      const ry = targetAgent.pos.x * sinZ + targetAgent.pos.y * cosZ;
      const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);
      const y2 = ry * cosX - (targetAgent.pos.z || 0) * sinX;
      camera.panX = -rx * camera.zoom;
      camera.panY = -y2 * camera.zoom;
      // ★ M1.7 胎儿无地图实体：定位一次但不跟随
      isCameraFollow = !!targetAgent.isAlive && !targetAgent.isFetus;
      if (typeof updateFollowBtnState === 'function') updateFollowBtnState();
      // 立即打开/刷新右侧 Inspector 角色卡片
      if (typeof updateInspector === 'function') updateInspector();
    };

    // ==========================================
    // ★ 全局点击委托：点击户主/族长/国王等 .lineage-chip[data-agent-id] → 聚焦角色卡片
    //   (家户/婚姻/宗族/王国卡片均含该 class，v1.21.1 统一入口)
    // ==========================================
    document.addEventListener('click', function(e) {
      const chip = e.target.closest('.lineage-chip[data-agent-id]');
      if (!chip) return;
      const agentId = chip.getAttribute('data-agent-id');
      if (agentId == null) return;
      e.stopPropagation();
      window.focusOnAgent(agentId);
    });