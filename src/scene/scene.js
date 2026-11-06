/**
 * YOUR SCENE — Parts A, B and D live here (and in files you add next to it).
 *
 * main.js calls, every frame:
 *     scene.update(dt, time)          dt and time in seconds
 *     scene.draw(pass, viewProj)      inside the frame's render pass
 * and scene.reset() from the panel's "reset" button.
 *
 * Suggested steps
 *   Part A  Write a small mesh pipeline (copy the structure of
 *           render/painting.js: vertex buffer → uniform buffer → bind group
 *           → pipeline → draw). Use geometry.js for cube data. Place at least
 *           three objects in front of the painting (z > 0) with YOUR mat4.
 *   Part B  Build a SceneNode tree (scene/node.js), call root.updateWorld()
 *           in update(), and draw every node with  viewProj · node.world.
 *   Part D  Draw control points and the curve over the painting
 *           (topology 'line-strip' or 'point-list' works for a start).
 *
 * WebGPU gotcha: queue.writeBuffer() calls all run BEFORE the frame's
 * commands execute. If several objects share ONE uniform buffer, they all
 * see the last value written. Give each object its own uniform buffer (or
 * its own slice of a big one, with a dynamic offset).
 *
 * Call renderer.countDraw(vertexCount) after each draw so the vertex
 * counter in the panel is correct (Part E).
 */
import meshWGSL from '../render/shaders/mesh.wgsl?raw';
import { DEPTH_FORMAT } from '../render/renderer.js';
import * as geometry from './geometry.js';
import * as mat4 from '../math/mat4.js';
import { createShader, fragmentConstants } from '../render/shader.js';
import axesWGSL from '../render/shaders/axes.wgsl?raw';
import { SceneNode } from './node.js';
import { createCurveEditor } from './curveEditor.js';

// one cube's worth of vertex data, shared by every object (we only change the uniforms)
const CUBE_VERTICES = geometry.cube();
const CUBE_VERTEX_COUNT = 36;

export function createScene({ gpu, renderer, painting, panel, paintingId = () => 'unknown' }) {
  const { device } = gpu;
  const state = {
    debugAxes: false,
    // the one object controlled from the UI
    tx: 0.6, ty: 0, tz: 0.6,
    angle: 0.4,
    scaleAmt: 0.4,
    order: 'TRS', // or 'SRT'
  };

  /* ---- pipeline shared by every cube (Part A) ---- */
  const module = createShader(device, meshWGSL, 'mesh');
  const pipeline = device.createRenderPipeline({
    label: 'mesh',
    layout: 'auto',
    vertex: {
      module, entryPoint: 'vs',
      buffers: [{
        arrayStride: 6 * 4, // position (3) + normal (3)
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' },
        ],
      }],
    },
    fragment: {
      module, entryPoint: 'fs',
      targets: [{ format: gpu.viewFormat }],
      constants: fragmentConstants(gpu),
    },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
  });

  const vertexBuffer = device.createBuffer({
    label: 'cube vertices',
    size: CUBE_VERTICES.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, CUBE_VERTICES);

  // one object = its own uniform buffer + bind group + a colour + a base transform
  function makeObject(color) {
    const uniforms = device.createBuffer({
      label: 'object uniforms',
      size: 64 + 16, // mat4 (mvp) + vec4 (colour)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniforms } }],
    });
    return { uniforms, bindGroup, color };
  }

  // three objects in front of the painting (z > 0)
  const objA = makeObject([0.80, 0.30, 0.25, 1]); // controlled by the UI
  const objB = makeObject([0.25, 0.55, 0.85, 1]);
  const objC = makeObject([0.35, 0.70, 0.35, 1]);

  /* ---- UI ---- */
  const f = panel.folder('Scene');
  const uiA = [
    f.toggle('debug axes', state, 'debugAxes'),
    f.slider('object A · x', state, 'tx', -1.5, 1.5, 0.01),
    f.slider('object A · y', state, 'ty', -1.5, 1.5, 0.01),
    f.slider('object A · z', state, 'tz', 0.1, 2, 0.01),
    f.slider('object A · angle', state, 'angle', -Math.PI, Math.PI, 0.01),
    f.slider('object A · scale', state, 'scaleAmt', 0.1, 1, 0.01),
  ];
  const uiOrder = f.select('object A · order', ['TRS', 'SRT'], state.order, (v) => (state.order = v));
  const matReadout = f.text('');

  /* ---- fixed placement for the other two objects ---- */
  const modelB = mat4.multiply(mat4.translate(-0.9, 0, 0.9), mat4.scale(0.3, 0.3, 0.3));
  const modelC = mat4.multiply(mat4.translate(0, 0.8, 0.5), mat4.scale(0.25, 0.25, 0.25));
  // a small axes-drawing pipeline, shared by every node in debug mode
const axesModule = createShader(device, axesWGSL, 'axes');
const axesPipeline = device.createRenderPipeline({
  label: 'axes',
  layout: 'auto',
  vertex: {
    module: axesModule, entryPoint: 'vs',
    buffers: [{
      arrayStride: 6 * 4, // position (3) + colour (3)
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' },
      ],
    }],
  },
  fragment: {
    module: axesModule, entryPoint: 'fs',
    targets: [{ format: gpu.viewFormat }],
    constants: fragmentConstants(gpu),
  },
  primitive: { topology: 'line-list' },
  depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'always' },
});
const AXES_VERTICES = geometry.axes(0.6);
const axesBuffer = device.createBuffer({
  label: 'axes vertices',
  size: AXES_VERTICES.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(axesBuffer, 0, AXES_VERTICES);
/* ---- Part D: editable curves over the painting (scene/curveEditor.js) ---- */
const curve = createCurveEditor({ gpu, renderer, painting, panel, paintingId });
const curveObject = makeObject([0.95, 0.95, 0.95, 1]); // the object animated along the curve
// each node that should draw a cube gets its own uniform buffer, stored in node.data
function attachMesh(node, color) {
  const obj = makeObject(color);
  node.data.mesh = obj;
  node.data.axes = makeAxesUniform();
  return node;
}
function makeAxesUniform() {
  const uniforms = device.createBuffer({
    label: 'axes uniforms',
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bindGroup = device.createBindGroup({
    layout: axesPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniforms } }],
  });
  return { uniforms, bindGroup };
}

// tree:  root → pedestal → arm → ornament
//        root → satellite → moon
// node.local holds only the joint frame (T·R) and is part of the chain;
// node.data.shape (size of the cube) is applied on the RIGHT when drawing and is
// not inherited — otherwise the pedestal's flat scale would squash the arm and
// the ornament (Lab 3, "joint frame in the chain, shape outside it").
const root = new SceneNode('root');
const pedestal = attachMesh(new SceneNode('pedestal', mat4.translate(-0.3, -0.6, 1.1)), [0.55, 0.45, 0.35, 1]);
pedestal.data.shape = mat4.scale(0.4, 0.15, 0.4);
const arm = attachMesh(new SceneNode('arm', mat4.translate(0, 0.1, 0)), [0.70, 0.60, 0.20, 1]); // animated
arm.data.shape = mat4.multiply(mat4.translate(0.25, 0, 0), mat4.scale(0.5, 0.05, 0.05)); // a bar from the pivot along +x
const ornament = attachMesh(new SceneNode('ornament', mat4.translate(0.5, 0.08, 0)), [0.85, 0.20, 0.55, 1]); // at the end of the bar
ornament.data.shape = mat4.scale(0.12, 0.12, 0.12);
const satellite = attachMesh(new SceneNode('satellite', mat4.translate(0.9, -0.4, 1.0)), [0.30, 0.30, 0.30, 1]);
satellite.data.shape = mat4.scale(0.2, 0.2, 0.2);
const moon = attachMesh(new SceneNode('moon', mat4.scale(0.15, 0.15, 0.15))); // animated too (scale only on this leaf)

root.addChild(pedestal).addChild(arm).addChild(ornament); // pedestal → arm → ornament (3 levels under root)
root.addChild(satellite).addChild(moon);

moon.data.mesh.color = [0.75, 0.75, 0.80, 1];
root.data.axes = makeAxesUniform();
  return {
    state,

    update(dt, time) {
      // object A's model matrix follows whichever composition order is selected,
      // so the UI can show the difference between T·R·S and S·R·T live
      const T = mat4.translate(state.tx, state.ty, state.tz);
      const R = mat4.rotateY(state.angle);
      const S = mat4.scale(state.scaleAmt, state.scaleAmt, state.scaleAmt);
      state.modelA = state.order === 'TRS'
        ? mat4.multiply(mat4.multiply(T, R), S)
        : mat4.multiply(mat4.multiply(S, R), T);
      // Part A: show BOTH orders numerically; the active one drives object A
      const mTRS = mat4.multiply(mat4.multiply(T, R), S);
      const mSRT = mat4.multiply(mat4.multiply(S, R), T);
      matReadout.set(
        `M = T·R·S${state.order === 'TRS' ? '   ◀ active' : ''}\n${mat4.format(mTRS)}\n\n` +
        `M = S·R·T${state.order === 'SRT' ? '   ◀ active' : ''}\n${mat4.format(mSRT)}`);
      // Part B: animate the arm (rotates in place) and the moon (orbits the satellite)
      arm.local = mat4.multiply(mat4.translate(0, 0.1, 0), mat4.rotateY(time * 0.8));
      moon.local = mat4.multiply(mat4.rotateY(time * 1.5), mat4.multiply(mat4.translate(0.5, 0, 0), mat4.scale(0.15, 0.15, 0.15)));
      root.updateWorld();
      curve.update(dt);
    },

    /** @param {GPURenderPassEncoder} pass  @param {Float32Array} viewProj  P · V */
    draw(pass, viewProj) {
      pass.setPipeline(pipeline);
      pass.setVertexBuffer(0, vertexBuffer);

      const drawObject = (obj, model) => {
        const mvp = mat4.multiply(viewProj, model);
        const data = new Float32Array(20); // 16 (mat4) + 4 (colour)
        data.set(mvp, 0);
        data.set(obj.color, 16);
        device.queue.writeBuffer(obj.uniforms, 0, data);
        pass.setBindGroup(0, obj.bindGroup);
        pass.draw(CUBE_VERTEX_COUNT);
        renderer.countDraw(CUBE_VERTEX_COUNT);
      };

      drawObject(objA, state.modelA ?? mat4.identity());
      drawObject(objB, modelB);
      drawObject(objC, modelC);
      // Part B: draw every node in the tree that carries a mesh
      root.traverse((node) => {
        if (node.data.mesh) drawObject(node.data.mesh, node.data.shape ? mat4.multiply(node.world, node.data.shape) : node.world);
      });
      // Part D: the object animated along the curve, oriented by its tangent
      drawObject(curveObject, curve.objectModel);

      // Part B debug mode: each node's local axes at its world position
      if (state.debugAxes) {
        pass.setPipeline(axesPipeline);
        pass.setVertexBuffer(0, axesBuffer);
        root.traverse((node) => {
          if (!node.data.axes) return;
          const mvp = mat4.multiply(viewProj, node.world);
          device.queue.writeBuffer(node.data.axes.uniforms, 0, mvp);
          pass.setBindGroup(0, node.data.axes.bindGroup);
          pass.draw(6);
          renderer.countDraw(6);
        });
      }
      // Part D: curves, control points and the de Casteljau construction over the painting
      curve.draw(pass, viewProj);
    },

    reset() {
      state.tx = 0.6; state.ty = 0; state.tz = 0.6;
      state.angle = 0.4; state.scaleAmt = 0.4; state.order = 'TRS';
      uiA.forEach((c) => c.update());
      uiOrder.set(state.order);
      curve.reset();
    },

    /** The curve editor, for mouse picking in main.js. */
    curve,
  };
}