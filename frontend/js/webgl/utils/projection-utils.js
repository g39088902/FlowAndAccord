// === 投影矩阵工具函数 ===
// 补充 math.js 中的投影逻辑，生成 WebGL 友好的矩阵

class ProjectionUtils {
  /**
   * 生成精确匹配 Flow & Accord Canvas 2D project3D 视角的斜二测投影矩阵
   * 世界坐标 (x, y, elev) 映射到 WebGL NDC [-1, 1] 空间，像素级对齐
   */
  static getAxonometricMatrix(camera, w, h) {
    const cosZ = Math.cos(camera.rotZ), sinZ = Math.sin(camera.rotZ);
    const cosX = Math.cos(camera.rotX), sinX = Math.sin(camera.rotX);
    const zoom = camera.zoom;
    const sx = (2 * zoom) / Math.max(1, w);
    const sy = (-2 * zoom) / Math.max(1, h);
    const sz = -0.0005; // 负系数：深度越大（越靠近相机）在 NDC 中 z 越小，符合 WebGL LEQUAL 深度测试

    return new Float32Array([
      // Column 0: x 的贡献
      sx * cosZ,
      sy * sinZ * cosX,
      sz * sinZ * sinX,
      0,

      // Column 1: y 的贡献
      -sx * sinZ,
      sy * cosZ * cosX,
      sz * cosZ * sinX,
      0,

      // Column 2: z (elev) 的贡献
      0,
      -sy * sinX,
      sz * cosX,
      0,

      // Column 3: 平移偏移 (panX, panY)
      (2 * camera.panX) / Math.max(1, w),
      (-2 * camera.panY) / Math.max(1, h),
      0,
      1
    ]);
  }

  /**
   * 生成透视投影矩阵 (WebGL 列主序：z∈[-1,1])
   */
  static perspective(fov, aspect, near, far) {
    const f = 1.0 / Math.tan(fov / 2);
    const nf = 1 / (near - far);
    
    return new Float32Array([
      f / aspect,  0, 0, 0,
      0,           f, 0, 0,
      0,           0, (far + near) * nf, -1,
      0,           0, (2 * far * near) * nf, 0
    ]);
  }
  
  /**
   * 生成视图矩阵 (简化版：仅旋转和平移)
   */
  static lookAt(cam, target = {x: 0, y: 0, z: 0}) {
    const fwd = {
      x: cam.x - target.x,
      y: cam.y - target.y,
      z: cam.z - target.z
    };
    const fwdLen = Math.hypot(fwd.x, fwd.y, fwd.z);
    fwd.x /= fwdLen; fwd.y /= fwdLen; fwd.z /= fwdLen;
    
    const right = {
      y: fwd.z,
      x: fwd.y,
      z: -fwd.x
    };
    const rightLen = Math.hypot(right.x, right.y, right.z);
    right.x /= rightLen; right.y /= rightLen; right.z /= rightLen;
    
    const up = {
      x: right.y * fwd.z - right.z * fwd.y,
      y: right.z * fwd.x - right.x * fwd.z,
      z: right.x * fwd.y - right.y * fwd.x
    };
    
    return new Float32Array([
      right.x,  up.x,  -fwd.x,  0,
      right.y,  up.y,  -fwd.y,  0,
      right.z,  up.z,  -fwd.z,  0,
      -(right.x * cam.x + right.y * cam.y + right.z * cam.z),
      -(up.x * cam.x + up.y * cam.y + up.z * cam.y),
      -(-fwd.x * cam.x - fwd.y * cam.y - fwd.z * cam.z),
      0, 0, 0, 1
    ]);
  }
  
  /**
   * 生成仿射矩阵 (平移/缩放)
   */
  static translate(x, y, z) {
    return new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      x, y, z, 1
    ]);
  }
  
  static scale(s) {
    return new Float32Array([
      s, 0, 0, 0,
      0, s, 0, 0,
      0, 0, s, 0,
      0, 0, 0, 1
    ]);
  }
}
