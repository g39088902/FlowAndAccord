// === 地形网格测试渲染器 (Phase 1 PoC) ===
// 用于验证 WebGL pipeline 的基本功能

class TestGridRenderer {
  constructor(webglCtx, manager) {
    this.gl = webglCtx.GL;
    this.manager = manager || new ShaderManager(this.gl);
    this.vao = null;
    this.vbo = null;
    this.program = null;
  }
  
  async init() {
    // 简单的测试 shader
    const vsSource = `#version 300 es
      in vec2 a_position;
      in float a_elev;
      uniform mat4 u_model;
      uniform mat4 u_projection;
      out vec3 v_color;
      
      void main() {
        vec4 pos = u_projection * u_model * vec4(a_position.x, a_elev, a_position.y, 1.0);
        gl_Position = pos;
        
        // 根据高程渐变色
        float elevationRatio = a_elev / 20.0;
        v_color = mix(vec3(0.3, 0.6, 0.3), vec3(0.5, 0.4, 0.2), elevationRatio);
      }
    `;
    
    const fsSource = `#version 300 es
      precision mediump float;
      in vec3 v_color;
      out vec4 outColor;
      
      void main() {
        outColor = vec4(v_color, 1.0);
      }
    `;
    
    this.program = await this.manager.loadProgram(vsSource, fsSource);
    this.gl.useProgram(this.program);
    
    // 创建简单网格 geometry (5×5 格子)
    this.createGridGeometry();
  }
  
  createGridGeometry() {
    // 每个 quad 6 顶点 (2 triangles)
    const size = 60;
    const count = 25; // 5×5 grid
    
    const vertices = [];
    for (let i = 0; i < count; i++) {
      const x = (i % 5) * size - size;
      const z = Math.floor(i / 5) * size - size;
      const elev = Math.sin(x * 0.02) * Math.cos(z * 0.02) * 3;
      
      // Quad vertices (2 triangles = 6 vertices, order: x, z, elev)
      const dx = size / 2;
      vertices.push(
        x - dx, z - dx, elev,
        x + dx, z - dx, elev,
        x - dx, z + dx, elev,

        x - dx, z + dx, elev,
        x + dx, z - dx, elev,
        x + dx, z + dx, elev
      );
    }
    
    // VBO
    this.vbo = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vbo);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(vertices), this.gl.STATIC_DRAW);
    
    // Attribute layout: 3 floats per vertex (x, elev, z)
    const stride = 3 * 4;
    
    const positionXLoc = this.gl.getAttribLocation(this.program, 'a_position');
    this.gl.enableVertexAttribArray(positionXLoc);
    this.gl.vertexAttribPointer(positionXLoc, 2, this.gl.FLOAT, false, stride, 0);
    
    const elevLoc = this.gl.getAttribLocation(this.program, 'a_elev');
    this.gl.enableVertexAttribArray(elevLoc);
    this.gl.vertexAttribPointer(elevLoc, 1, this.gl.FLOAT, false, stride, 2 * 4);
  }
  
  render(projectionMatrix, viewMatrix) {
    if (!this.program) return;
    
    this.gl.useProgram(this.program);
    
    // Uniforms
    const projLoc = this.manager.getUniformLocation(this.program, 'u_projection');
    const modelLoc = this.manager.getUniformLocation(this.program, 'u_model');
    
    this.gl.uniformMatrix4fv(projLoc, false, projectionMatrix);
    this.gl.uniformMatrix4fv(modelLoc, false, viewMatrix);
    
    // Draw
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 25 * 6); // 25 quads × 6 verts
  }
}
