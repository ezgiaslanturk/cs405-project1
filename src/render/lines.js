/**
 * LineBatch — draws a list of 3D points as 'line-list' or 'line-strip' with
 * one flat colour (shaders/curve.wgsl). Used for the curves, the de Casteljau
 * construction, control-point crosses and the camera frustum.
 *
 * Each batch owns its vertex buffer and its uniform buffer, so several
 * batches can be drawn in the same frame without overwriting each other
 * (queue.writeBuffer() runs before the frame's commands). Use one batch per
 * thing you draw.
 */
import curveWGSL from './shaders/curve.wgsl?raw';
import { createShader, fragmentConstants } from './shader.js';
import { DEPTH_FORMAT } from './renderer.js';

const pipelineCache = new Map(); // `${topology}|${depthCompare}` → pipeline

function getPipeline(gpu, topology, depthCompare) {
  const key = `${topology}|${depthCompare}`;
  if (pipelineCache.has(key)) return pipelineCache.get(key);
  const { device } = gpu;
  const module = createShader(device, curveWGSL, 'lines');
  const pipeline = device.createRenderPipeline({
    label: `lines-${key}`,
    layout: 'auto',
    vertex: {
      module, entryPoint: 'vs',
      buffers: [{ arrayStride: 3 * 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }],
    },
    fragment: { module, entryPoint: 'fs', targets: [{ format: gpu.viewFormat }], constants: fragmentConstants(gpu) },
    primitive: { topology },
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare },
  });
  pipelineCache.set(key, pipeline);
  return pipeline;
}

export class LineBatch {
  /**
   * @param gpu       from initWebGPU()
   * @param topology  'line-list' (pairs of points) or 'line-strip'
   * @param depthCompare 'less' = hidden by objects in front; 'always' = always on top
   */
  constructor(gpu, topology = 'line-list', depthCompare = 'less') {
    this.gpu = gpu;
    this.pipeline = getPipeline(gpu, topology, depthCompare);
    this.capacity = 0;
    this.vertices = null;
    this.uniforms = gpu.device.createBuffer({
      label: 'line uniforms', size: 64 + 16, // mat4 (mvp) + vec4 (colour)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.bindGroup = gpu.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniforms } }],
    });
  }

  /** points: array of [x, y, z] in world space; mvp: P·V (the points are already in world space). */
  draw(pass, renderer, mvp, points, color) {
    const n = points.length;
    if (n < 2) return;
    const { device } = this.gpu;
    if (n > this.capacity) {
      this.vertices?.destroy();
      this.capacity = Math.max(64, 2 ** Math.ceil(Math.log2(n)));
      this.vertices = device.createBuffer({
        label: 'line vertices', size: this.capacity * 12,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
    const data = new Float32Array(n * 3);
    points.forEach((p, i) => { data[i * 3] = p[0]; data[i * 3 + 1] = p[1]; data[i * 3 + 2] = p[2] ?? 0; });
    device.queue.writeBuffer(this.vertices, 0, data);

    const u = new Float32Array(20);
    u.set(mvp, 0);
    u.set(color, 16);
    device.queue.writeBuffer(this.uniforms, 0, u);

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.vertices);
    pass.draw(n);
    renderer.countDraw(n);
  }
}

/** Small "X" at each point, in the plane z = const (for control points). Returns a line-list. */
export function crosses(points, size = 0.025) {
  const out = [];
  for (const [x, y, z] of points) {
    out.push([x - size, y - size, z], [x + size, y + size, z]);
    out.push([x - size, y + size, z], [x + size, y - size, z]);
  }
  return out;
}
