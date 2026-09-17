// === Shader 编译器与管理器 ===
// 职责：编译 GLSL → 链接程序、uniform 位置缓存

class ShaderManager {
  constructor(gl) {
    this.gl = gl;
    this.programs = new Map();
    this.uniformCache = new Map();
  }
  
  async compileShader(type, source) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const info = this.gl.getShaderInfoLog(shader);
      this.gl.deleteShader(shader);
      throw new Error(`Shader compile error:\n${info}`);
    }
    
    return shader;
  }
  
  async loadProgram(vertexSrc, fragmentSrc) {
    const key = `vert:${vertexSrc.length}-frag:${fragmentSrc.length}`;
    
    if (this.programs.has(key)) {
      return this.programs.get(key);
    }
    
    const vs = await this.compileShader(this.gl.VERTEX_SHADER, vertexSrc);
    const fs = await this.compileShader(this.gl.FRAGMENT_SHADER, fragmentSrc);
    
    const program = this.gl.createProgram();
    this.gl.attachShader(program, vs);
    this.gl.attachShader(program, fs);
    this.gl.linkProgram(program);
    
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      const info = this.gl.getProgramInfoLog(program);
      this.gl.deleteProgram(program);
      throw new Error(`Program link error:\n${info}`);
    }
    
    // 缓存 uniform 位置
    this.cacheUniforms(program);
    
    this.programs.set(key, program);
    return program;
  }
  
  cacheUniforms(program) {
    const count = this.gl.getProgramParameter(program, this.gl.ACTIVE_UNIFORMS);
    const locations = {};
    
    for (let i = 0; i < count; i++) {
      const uniform = this.gl.getActiveUniform(program, i);
      const name = uniform.name.split('.')[0]; // Handle arrays
      locations[name] = this.gl.getUniformLocation(program, uniform.name);
    }
    
    this.uniformCache.set(program, locations);
  }
  
  getUniformLocation(program, name) {
    const cache = this.uniformCache.get(program);
    return cache ? cache[name] : null;
  }
}
