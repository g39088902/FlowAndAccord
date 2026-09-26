//! 平面均匀桶索引（列式，无 z 分桶）。
//!
//! 水体在本项目里是**贴地薄层**：水平尺度（数十~数百米）远大于水深（1~3m），
//! 因此邻域搜索只在 x/y 平面分桶，同桶内按插入序串成链表。
//!
//! 不变量（违反即出 bug）：
//! - 桶边长恒等于支撑域半径 `h` ⇒ 半径内的邻居必然落在 3×3 邻桶内，
//!   查询固定扫描 9 桶即可，不做距离外扩。
//! - 插入序固定为粒子下标升序 ⇒ 邻域遍历顺序逐位可复现（确定性要求）。
//! - 结构全部构造期预分配，`rebuild` 只写数值字段，稳态零堆分配。

/// 平面桶索引。`nx × ny` 固定覆盖整个世界 AABB。
pub struct ColGrid {
    cell: f32,
    nx: usize,
    ny: usize,
    half: f32,
    head: Vec<i32>,
    next: Vec<i32>,
}

impl ColGrid {
    /// 以世界边长 `world_size`（世界坐标区间 `[-half, half]`）与桶边长 `cell` 建索引。
    pub fn new(world_size: f32, cell: f32, capacity: usize) -> Self {
        let world = world_size.max(1.0);
        let cell = if cell.is_finite() && cell > 0.0 { cell } else { 1.0 };
        let n = ((world / cell).ceil() as usize).max(1) + 1;
        Self {
            cell,
            nx: n,
            ny: n,
            half: world * 0.5,
            head: vec![-1; n * n],
            next: vec![-1; capacity],
        }
    }

    /// 桶边长（= 支撑域半径）。
    #[inline]
    pub fn cell_size(&self) -> f32 {
        self.cell
    }

    #[inline]
    fn bucket_axis(&self, v: f32) -> usize {
        let raw = ((v + self.half) / self.cell) as i32;
        raw.clamp(0, self.nx as i32 - 1) as usize
    }

    /// 按当前位置重建桶链表（粒子下标升序插入）。
    pub fn rebuild(&mut self, xs: &[f32], ys: &[f32], count: usize) {
        debug_assert!(count <= self.next.len());
        self.head.fill(-1);
        for i in 0..count {
            let bx = self.bucket_axis(xs[i]);
            let by = self.bucket_axis(ys[i]);
            let b = by * self.nx + bx;
            self.next[i] = self.head[b];
            self.head[b] = i as i32;
        }
    }

    /// 遍历粒子 `i` 的候选邻居（含自身；3×3 邻桶内全部粒子）。
    #[inline]
    pub fn for_each_candidate<F: FnMut(usize)>(&self, xs: &[f32], ys: &[f32], i: usize, mut f: F) {
        let bx = self.bucket_axis(xs[i]);
        let by = self.bucket_axis(ys[i]);
        let x0 = bx.saturating_sub(1);
        let y0 = by.saturating_sub(1);
        let x1 = (bx + 1).min(self.nx - 1);
        let y1 = (by + 1).min(self.ny - 1);
        for gy in y0..=y1 {
            let row = gy * self.nx;
            for gx in x0..=x1 {
                let mut j = self.head[row + gx];
                while j >= 0 {
                    f(j as usize);
                    j = self.next[j as usize];
                }
            }
        }
    }
}
