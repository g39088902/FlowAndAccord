// 降水粒子 compute 入口（3D 固定网格空间哈希 + 重力下落 + 3D 下坡流动 + 邻域力 + 蒸发）。
//
// 每子步顺序（勿调换）：A spawn → B flowIntegrate → B2 evapGain → C evict → D gridClear →
// E gridCount → F gridScan → G gridScatter。B/B2 使用「上一子步末」构建的网格（稳定位形），
// 单子步位移远小于网格单元，故 3×3×3 邻域仍覆盖全部交互对。

// ── 确定性哈希随机（无状态，取代旧 CPU LCG）──
fn hash_u32(x: u32) -> u32 {
  var h = x;
  h = h ^ (h >> 16u);
  h = h * 0x7feb352du;
  h = h ^ (h >> 15u);
  h = h * 0x846ca68bu;
  h = h ^ (h >> 16u);
  return h;
}

fn rand01(seed: u32) -> f32 {
  return f32(hash_u32(seed)) * (1.0 / 4294967296.0);
}

// ── 地形高程双线性采样（口径与旧内核 rain_ground_height 逐式一致，越界钳到边缘）──
fn groundHeight(wx: f32, wy: f32) -> f32 {
  let gw = params.gridW;
  let gh = params.gridH;
  let world = params.worldSize;
  let half = world * 0.5;
  var gx = ((wx + half) / world) * (gw - 1.0);
  var gy = ((wy + half) / world) * (gh - 1.0);
  gx = clamp(gx, 0.0, gw - 1.0);
  gy = clamp(gy, 0.0, gh - 1.0);
  let ix = floor(gx);
  let iy = floor(gy);
  let jx = min(ix + 1.0, gw - 1.0);
  let jy = min(iy + 1.0, gh - 1.0);
  let tx = gx - ix;
  let ty = gy - iy;
  let gwU = u32(gw);
  let iu = u32(ix);
  let ju = u32(jx);
  let iv = u32(iy);
  let jv = u32(jy);
  let a = mix(terrain[iv * gwU + iu], terrain[iv * gwU + ju], tx);
  let b = mix(terrain[jv * gwU + iu], terrain[jv * gwU + ju], tx);
  return mix(a, b, ty);
}

fn cellPos(p: vec3<f32>) -> vec3<u32> {
  let gx = clamp(i32(floor((p.x - params.minX) / params.cellSizeX)), 0, i32(params.gridX) - 1);
  let gy = clamp(i32(floor((p.y - params.minY) / params.cellSizeY)), 0, i32(params.gridY) - 1);
  let gz = clamp(i32(floor((p.z - params.minZ) / params.cellSizeZ)), 0, i32(params.gridZ) - 1);
  return vec3<u32>(u32(gx), u32(gy), u32(gz));
}

fn cellIndex(c: vec3<u32>) -> u32 {
  return (c.z * params.gridY + c.y) * params.gridX + c.x;
}

// ── 一次性初始化（世界切换 / 重置 / 倒流时调用）──
@compute @workgroup_size(64)
fn initState(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.maxParticles) { return; }
  atomicStore(&freeStack[i], i);
  particles[i].pos = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  particles[i].vel = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  particles[i].prev = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  particles[i].misc = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  particleCell[i] = 0xffffffffu;
  sortedIdx[i] = 0u;
  if (i == 0u) {
    atomicStore(&simState.alive, 0u);
    atomicStore(&simState.freeTop, i32(params.maxParticles));
    simState.drawArgs[0] = 36u;
    simState.drawArgs[1] = 0u;
    simState.drawArgs[2] = 0u;
    simState.drawArgs[3] = 0u;
  }
}

// ── A. 生成 ──
@compute @workgroup_size(64)
fn spawn(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.spawnCount) { return; }
  let old = atomicSub(&simState.freeTop, 1);
  if (old <= 0) {
    atomicAdd(&simState.freeTop, 1);
    return;
  }
  let slot = atomicLoad(&freeStack[u32(old - 1)]);
  if (slot >= params.maxParticles) { return; }
  let base = params.spawnSeed ^ (i * 2654435761u) ^ (params.stepSeq * 40503u);
  let rx = rand01(base + 0x9e3779b9u);
  let ry = rand01(base + 0x85ebca6bu);
  let rh = rand01(base + 0xc2b2ae35u);
  let rvx = rand01(base + 0x27d4eb2fu);
  let rvy = rand01(base + 0x165667b1u);
  let rage = rand01(base + 0xd3a2646cu);
  let half = params.worldSize * 0.5;
  let x = (rx * 2.0 - 1.0) * half;
  let y = (ry * 2.0 - 1.0) * half;
  let g = groundHeight(x, y);
  let z = g + params.spawnHeightBase + rh * params.spawnHeightRand;
  let vx = (rvx - 0.5) * params.spawnSpeed;
  let vy = (rvy - 0.5) * params.spawnSpeed;
  let maxAge = params.maxAgeBase + rage * params.maxAgeRand;
  particles[slot].pos = vec4<f32>(x, y, z, 0.0);
  particles[slot].vel = vec4<f32>(vx, vy, 0.0, maxAge);
  particles[slot].prev = vec4<f32>(x, y, z, 0.0);
  particles[slot].misc = vec4<f32>(1.0, 1.0, 0.0, 0.0);
}

// ── B. 积分（下落 / 落地 / 3D 下坡流动 / 邻域力 / 阻尼）──
@compute @workgroup_size(64)
fn flowIntegrate(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.maxParticles) { return; }
  let p = particles[i];
  if (p.misc.x < 0.5) { return; }

  var px = p.pos.x;
  var py = p.pos.y;
  var pz = p.pos.z;
  var vx = p.vel.x;
  var vy = p.vel.y;
  var vz = p.vel.z;
  let age = p.pos.w;
  let maxAge = p.vel.w;
  var falling = p.misc.y > 0.5;
  let ground = groundHeight(px, py);

  // 运动能量：随年龄归一化线性衰减（生成时 1 → 寿命终点 0）。
  // 驱动下坡加速度与流速上限递减，使老粒子越走越慢、活动性逐渐降低。
  let energy = clamp(1.0 - age / max(maxAge, 1e-3), 0.0, 1.0);

  if (falling) {
    let damp = pow(params.fallDamp, params.dt * 60.0);
    vx = vx * damp;
    vy = vy * damp;
    vz = vz - params.gravity * params.dt;
    px = px + vx * params.dt;
    py = py + vy * params.dt;
    pz = pz + vz * params.dt;
    if (pz <= ground + params.landClearance) {
      pz = ground + params.groundRestLift;
      falling = false;
      vx = vx * 0.35;
      vy = vy * 0.35;
      vz = vz * 0.35;
    }
  } else {
    // 3D 下坡：重力投影到地形切面（n = 地形法线）。
    let gs = max(params.worldSize / max(params.gridW - 1.0, 1.0), params.gradientMinStep);
    let hx = (groundHeight(px + gs, py) - groundHeight(px - gs, py)) / (2.0 * gs);
    let hy = (groundHeight(px, py + gs) - groundHeight(px, py - gs)) / (2.0 * gs);
    let n = normalize(vec3<f32>(-hx, -hy, 1.0));
    let grav = vec3<f32>(0.0, 0.0, -params.gravity);
    let t = grav - dot(grav, n) * n;
    let tl = length(t);
    if (tl > 1e-6) {
      let a = (t / tl) * (params.flowAccel * energy);
      vx = vx + a.x * params.dt;
      vy = vy + a.y * params.dt;
      vz = vz + a.z * params.dt;
    }

    // 邻域力：自身取当前位形，邻居取上一子步的稳定位形（prev），避免同帧读写串扰。
    if (params.forceValid == 1u && params.reachFar > 0.0) {
      let selfPos = vec3<f32>(px, py, pz);
      let origin = cellPos(selfPos);
      let reach2 = params.reachFar * params.reachFar;
      var gathered = 0u;
      for (var dz = -1; dz <= 1; dz = dz + 1) {
        for (var dy = -1; dy <= 1; dy = dy + 1) {
          for (var dx = -1; dx <= 1; dx = dx + 1) {
            let cxi = i32(origin.x) + dx;
            let cyi = i32(origin.y) + dy;
            let czi = i32(origin.z) + dz;
            if (cxi < 0 || cyi < 0 || czi < 0) { continue; }
            if (cxi >= i32(params.gridX) || cyi >= i32(params.gridY) || czi >= i32(params.gridZ)) { continue; }
            let ci = cellIndex(vec3<u32>(u32(cxi), u32(cyi), u32(czi)));
            let start = cellOffsets[ci];
            let end = cellOffsets[ci + 1u];
            for (var k = start; k < end; k = k + 1u) {
              let j = sortedIdx[k];
              if (j == i) { continue; }
              let q = particles[j];
              if (q.misc.x < 0.5) { continue; }
              // ★ 距离口径 = 两粒子**水平**间距（仅 x/y），与 f(d)=A−√d−R/d 的求零点
              //   reach_near/reach_far（rain.rs::rain_force_roots）一致；力也只施加到 vx/vy。
              //   若改用三维距离，地形起伏会把 d 抬高，使同一水平间距落在不同(skip)区间，
              //   令 d₂ 终止界限失真（旧 CPU 实现即水平距离，此处为其逐式复刻）。
              let dx = q.prev.x - selfPos.x;
              let dy = q.prev.y - selfPos.y;
              let d2 = dx * dx + dy * dy;
              if (d2 <= 0.0 || d2 >= reach2) { continue; }
              let dlen = sqrt(d2);
              let f = (params.attractA - sqrt(dlen) - params.repelR / dlen) * params.forceScale;
              let inv = f / dlen;
              vx = vx + dx * inv;
              vy = vy + dy * inv;
              gathered = gathered + 1u;
              if (gathered >= params.neighborCap) { break; }
            }
            if (gathered >= params.neighborCap) { break; }
          }
          if (gathered >= params.neighborCap) { break; }
        }
      }
    }

    // 流速上限随能量衰减：老粒子能维持的动能上限下降，自然减速。
    let spCap = params.flowSpeedMax * energy;
    let sp = sqrt(vx * vx + vy * vy + vz * vz);
    if (sp > spCap) {
      let k = spCap / sp;
      vx = vx * k;
      vy = vy * k;
      vz = vz * k;
    }
    let fdamp = pow(params.flowDamp, params.dt);
    vx = vx * fdamp;
    vy = vy * fdamp;
    vz = vz * fdamp;
    px = px + vx * params.dt;
    py = py + vy * params.dt;
    pz = groundHeight(px, py) + params.flowRestLift;
  }

  particles[i].pos = vec4<f32>(px, py, pz, age);
  particles[i].vel = vec4<f32>(vx, vy, vz, maxAge);
  particles[i].prev = vec4<f32>(px, py, pz, 0.0);
  particles[i].misc = vec4<f32>(1.0, select(0.0, 1.0, falling), 0.0, 0.0);
}

// ── B2. 蒸发邻域统计 ──
// 统计每个存活粒子「三维直线距离 evapRadius 内」的其它存活粒子数（上限 evapGainCap），
// 写入 misc.z 供 evict 缩放蒸发速度（★ v1.64.4 规则：每多 1 个邻居，蒸发速度降低
// evapSlowPerNeighbor /s，增益最多算 evapGainCap 个）。独立于邻域力（力只在落地态施加），
// 故下落中的粒子同样计入。复用上一子步末构建的 3D 网格（口径同 flowIntegrate），
// 集齐上限即提前退出，密集水体不会退化成全量扫描。
@compute @workgroup_size(64)
fn evapGain(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.maxParticles) { return; }
  let p = particles[i];
  if (p.misc.x < 0.5) { return; }

  let cap = u32(params.evapGainCap);
  let r2 = params.evapRadius * params.evapRadius;
  var near = 0u;
  if (r2 > 0.0 && cap > 0u) {
    let selfPos = p.pos.xyz;
    let origin = cellPos(selfPos);
    for (var dz = -1; dz <= 1; dz = dz + 1) {
      for (var dy = -1; dy <= 1; dy = dy + 1) {
        for (var dx = -1; dx <= 1; dx = dx + 1) {
          let cxi = i32(origin.x) + dx;
          let cyi = i32(origin.y) + dy;
          let czi = i32(origin.z) + dz;
          if (cxi < 0 || cyi < 0 || czi < 0) { continue; }
          if (cxi >= i32(params.gridX) || cyi >= i32(params.gridY) || czi >= i32(params.gridZ)) { continue; }
          let ci = cellIndex(vec3<u32>(u32(cxi), u32(cyi), u32(czi)));
          let start = cellOffsets[ci];
          let end = cellOffsets[ci + 1u];
          for (var k = start; k < end; k = k + 1u) {
            let j = sortedIdx[k];
            if (j == i) { continue; }
            let q = particles[j];
            if (q.misc.x < 0.5) { continue; }
            let d3 = q.pos.xyz - selfPos;
            if (dot(d3, d3) <= r2) {
              near = near + 1u;
              if (near >= cap) { break; }
            }
          }
          if (near >= cap) { break; }
        }
        if (near >= cap) { break; }
      }
    }
  }
  // 蒸发速度（1/s）：无邻居 1.0（每秒推进 1 秒年龄）→ 每多 1 个邻居降 evapSlowPerNeighbor，
  // 邻居数封顶 evapGainCap（等价于速率下限 evapMinFactor）。同伴越多越耐蒸发。
  // 速率唯一计算点是 B2 evapGain（写入 misc.w），此处只消费；misc.z 保留未封顶的邻域粒数。
  let gain = min(f32(near), params.evapGainCap);
  let rate = max(params.evapMinFactor, 1.0 - params.evapSlowPerNeighbor * gain);
  particles[i].misc.z = f32(near);
  particles[i].misc.w = rate;
}

// ── C. 蒸发 / 出界销毁（并按邻域增益推进 age）──
@compute @workgroup_size(64)
fn evict(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.maxParticles) { return; }
  let p = particles[i];
  if (p.misc.x < 0.5) { return; }
  // 蒸发速度（1/s）由 B2 evapGain 写入 misc.w（已含邻居增益与封顶），此处只消费；
  // 下限钳制兼作 B2 缺席时的兜底（避免速率为 0 导致粒子永不消散）。
  let rate = max(p.misc.w, params.evapMinFactor);
  let age = p.pos.w + params.dt * rate;
  let half = params.worldSize * 0.5;
  let alive = age <= p.vel.w && abs(p.pos.x) <= half && abs(p.pos.y) <= half;
  if (alive) {
    particles[i].pos = vec4<f32>(p.pos.xyz, age);
    return;
  }
  particles[i].misc = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  let k = atomicAdd(&simState.freeTop, 1);
  if (k >= 0 && k < i32(params.maxParticles)) {
    atomicStore(&freeStack[u32(k)], i);
  }
}

// ── D. 清空单元计数（游标由 F 步重建，无需清理）──
@compute @workgroup_size(256)
fn gridClear(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.numCells) { return; }
  atomicStore(&cellCounterBuf[i], 0u);
  cellOffsets[i] = 0u;
}

// ── E. 统计每单元存活粒子数 ──
@compute @workgroup_size(64)
fn gridCount(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.maxParticles) { return; }
  let p = particles[i];
  if (p.misc.x < 0.5) {
    particleCell[i] = 0xffffffffu;
    return;
  }
  let ci = cellIndex(cellPos(p.pos.xyz));
  particleCell[i] = ci;
  atomicAdd(&cellCounterBuf[ci], 1u);
}

// ── F. 前缀和（单线程串行扫描；numCells ≤ 1024，成本可忽略）──
// 输出：cellOffsets（exclusive，长度 numCells+1）、cellCounterBuf 后半段（= 各段散布起点）、
//       simState.alive 与 simState.drawArgs[1]（存活数 → 间接绘制的实例数）。
@compute @workgroup_size(1)
fn gridScan() {
  var acc: u32 = 0u;
  let n = params.numCells;
  for (var i = 0u; i < n; i = i + 1u) {
    let c = atomicLoad(&cellCounterBuf[i]);
    cellOffsets[i] = acc;
    atomicStore(&cellCounterBuf[n + i], acc);
    acc = acc + c;
  }
  cellOffsets[n] = acc;
  atomicStore(&simState.alive, acc);
  simState.drawArgs[0] = 36u;
  simState.drawArgs[1] = acc;
  simState.drawArgs[2] = 0u;
  simState.drawArgs[3] = 0u;
}

// ── G. 散布：按单元把存活粒子索引写进 sortedIdx（稠密，供渲染与邻域查找）──
@compute @workgroup_size(64)
fn gridScatter(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.maxParticles) { return; }
  if (particles[i].misc.x < 0.5) { return; }
  let ci = particleCell[i];
  let p = atomicAdd(&cellCounterBuf[params.numCells + ci], 1u);
  sortedIdx[p] = i;
}