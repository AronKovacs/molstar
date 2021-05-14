/**
 * Copyright (c) 2019-2020 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Áron Samuel Kovács <aron.kovacs@mail.muni.cz>
 */

/**
 * Adaptive Cutaways for Comprehensible Rendering of Polygonal Scenes by Michael Burns and Adam Finkelstein
 * https://gfx.cs.princeton.edu/pubs/Burns_2008_ACF/adaptive_cutaways.pdf
 */

import { QuadSchema, QuadValues } from '../../mol-gl/compute/util';
import { TextureSpec, UniformSpec, Values } from '../../mol-gl/renderable/schema';
import { ShaderCode } from '../../mol-gl/shader-code';
import { WebGLContext } from '../../mol-gl/webgl/context';
import { createComputeRenderItem } from '../../mol-gl/webgl/render-item';
import { createComputeRenderable, ComputeRenderable } from '../../mol-gl/renderable';
import { Texture } from '../../mol-gl/webgl/texture';
import { Mat4, Vec2, Vec4 } from '../../mol-math/linear-algebra';
import { ValueCell } from '../../mol-util';
import { quad_vert } from '../../mol-gl/shader/quad.vert';
import { cutawayJfaStep_frag } from '../../mol-gl/shader/cutaway-jfa-step.frag';
import { cutawayInit_frag } from '../../mol-gl/shader/cutaway-init.frag';
import { cutawayCopyToTarget_frag } from '../../mol-gl/shader/cutaway-copy-to-target.frag';
import { RenderTarget } from '../../mol-gl/webgl/render-target';
import { Camera, ICamera } from '../camera';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { Renderer } from '../../mol-gl/renderer';
import { Scene } from '../../mol-gl/scene';
import { StereoCamera } from '../camera/stereo';
import { isDebugMode } from '../../mol-util/debug';

export const CutawayParams = {
    angle: PD.Numeric(45, {min: 0, max: 90, step: 1}),
    borderSize: PD.Numeric(0.05, {min: 0, max: 0.1, step: 0.01}),
    slopeOffset: PD.Numeric(0, {min: 0, max: 1, step: 0.01}),
};
export type CutawayProps = PD.Values<typeof CutawayParams>

const CutawayInitSchema = {
    ...QuadSchema,
    tDepth: TextureSpec('texture', 'rgba', 'ubyte', 'nearest'),
    uTexSize: UniformSpec('v2'),
    uIsOrtho: UniformSpec('f'),
    uNear: UniformSpec('f'),
    uFar: UniformSpec('f'),
};
 type CutawayInitRenderable = ComputeRenderable<Values<typeof CutawayInitSchema>>

function getCutawayInitRenderable(ctx: WebGLContext, depthTexture: Texture): CutawayInitRenderable {
    const values: Values<typeof CutawayInitSchema> = {
        ...QuadValues,
        tDepth: ValueCell.create(depthTexture),
        uTexSize: ValueCell.create(Vec2.create(depthTexture.getWidth(), depthTexture.getHeight())),
        uIsOrtho: ValueCell.create(0.0),
        uNear: ValueCell.create(0.0),
        uFar: ValueCell.create(1.0),
    };

    const schema = { ...CutawayInitSchema };
    const shaderCode = ShaderCode('cutaway-init', quad_vert, cutawayInit_frag);
    const renderItem = createComputeRenderItem(ctx, 'triangles', shaderCode, schema, values);

    return createComputeRenderable(renderItem, values);
}

const CutawayJfaSchema = {
    ...QuadSchema,
    tCutaway: TextureSpec('texture', 'rgba', 'float', 'nearest'),
    uTexSize: UniformSpec('v2'),
    uInvProjection: UniformSpec('m4'),
    uViewport: UniformSpec('v4'),
    uStep: UniformSpec('v2'),
    uPMsz: UniformSpec('f'),
    uAngle: UniformSpec('f'),
    uEdgeRegionSize: UniformSpec('f'),
    uSlopeStartOffset: UniformSpec('f'),
    uAspectRatio: UniformSpec('v2'),
    uIsOrtho: UniformSpec('f'),
    uNear: UniformSpec('f'),
    uFar: UniformSpec('f'),
};
 type CutawayJfaRenderable = ComputeRenderable<Values<typeof CutawayJfaSchema>>

function getCutawayJfaRenderable(ctx: WebGLContext, cutawayTexture: Texture): CutawayJfaRenderable {
    const values: Values<typeof CutawayJfaSchema> = {
        ...QuadValues,
        tCutaway: ValueCell.create(cutawayTexture),
        uTexSize: ValueCell.create(Vec2.create(cutawayTexture.getWidth(), cutawayTexture.getHeight())),
        uInvProjection: ValueCell.create(Mat4.identity()),
        uViewport: ValueCell.create(Vec4.create(0.0, 0.0, 1.0, 1.0)),
        uStep: ValueCell.create(Vec2.create(0, 0)),
        uPMsz: ValueCell.create(1.0),
        uAngle: ValueCell.create(Math.PI / 3.0),
        uEdgeRegionSize: ValueCell.create(0.0),
        uSlopeStartOffset: ValueCell.create(0.0),
        uAspectRatio: ValueCell.create(Vec2.create(1.0, 1.0)),
        uIsOrtho: ValueCell.create(0.0),
        uNear: ValueCell.create(0.0),
        uFar: ValueCell.create(1.0),
    };

    const schema = { ...CutawayJfaSchema };
    const shaderCode = ShaderCode('cutaway-jfa', quad_vert, cutawayJfaStep_frag);
    const renderItem = createComputeRenderItem(ctx, 'triangles', shaderCode, schema, values);

    return createComputeRenderable(renderItem, values);
}

const CutawayCopyToTargetSchema = {
    ...QuadSchema,
    tDepth: TextureSpec('texture', 'rgba', 'float', 'nearest'),
    uTexSize: UniformSpec('v2'),
    uIsOrtho: UniformSpec('f'),
    uNear: UniformSpec('f'),
    uFar: UniformSpec('f'),
};
 type CutawayCopyToTargetRenderable = ComputeRenderable<Values<typeof CutawayCopyToTargetSchema>>

function getCutawayCopyToTargetRenderable(ctx: WebGLContext, depthTexture: Texture): CutawayCopyToTargetRenderable {
    const values: Values<typeof CutawayCopyToTargetSchema> = {
        ...QuadValues,
        tDepth: ValueCell.create(depthTexture),
        uTexSize: ValueCell.create(Vec2.create(depthTexture.getWidth(), depthTexture.getHeight())),
        uIsOrtho: ValueCell.create(0.0),
        uNear: ValueCell.create(0.0),
        uFar: ValueCell.create(1.0),
    };

    const schema = { ...CutawayCopyToTargetSchema };
    const shaderCode = ShaderCode('cutaway-copy-to-target', quad_vert, cutawayCopyToTarget_frag);
    const renderItem = createComputeRenderItem(ctx, 'triangles', shaderCode, schema, values);

    return createComputeRenderable(renderItem, values);
}

export class CutawayPass {
    private readonly initRenderable: CutawayInitRenderable
    private readonly copyToTargetRenderable: CutawayCopyToTargetRenderable

    private readonly jfaATarget: RenderTarget
    private readonly jfaBTarget: RenderTarget
    private readonly jfaARenderable: CutawayJfaRenderable
    private readonly jfaBRenderable: CutawayJfaRenderable

    private static _supported: boolean = false;
    public static get supported() {
        return this._supported;
    }

    private _target: RenderTarget;
    public get target() {
        return CutawayPass.supported ? this._target.texture : null;
    }

    constructor(private webgl: WebGLContext, width: number, height: number) {
        CutawayPass._supported = CutawayPass.isSupported(webgl);

        if (!CutawayPass.supported) {
            return;
        }

        this._target = webgl.createRenderTarget(width, height, true, 'uint8', 'nearest');

        this.jfaATarget = webgl.createRenderTarget(width, height, false, 'float32', 'nearest');
        this.jfaBTarget = webgl.createRenderTarget(width, height, false, 'float32', 'nearest');

        this.jfaARenderable = getCutawayJfaRenderable(webgl, this.jfaATarget.texture);
        this.jfaBRenderable = getCutawayJfaRenderable(webgl, this.jfaBTarget.texture);

        this.initRenderable = getCutawayInitRenderable(webgl, this._target.texture);
        this.copyToTargetRenderable = getCutawayCopyToTargetRenderable(webgl, this.jfaATarget.texture);
    }

    static isSupported(webgl: WebGLContext) {
        const { extensions: { textureFloat, colorBufferFloat } } = webgl;
        if (!textureFloat || !colorBufferFloat) {
            if (isDebugMode) {
                const missing: string[] = [];
                if (!textureFloat) missing.push('textureFloat');
                if (!colorBufferFloat) missing.push('colorBufferFloat');
                console.log(`Missing "${missing.join('", "')}" extensions required for "cutaway"`);
            }
            return false;
        } else {
            return true;
        }
    }

    private setRenderDepthState(renderer: Renderer, camera: ICamera) {
        const { gl, state } = this.webgl;
        const { x, y, width, height } = camera.viewport;

        renderer.setDrawingBufferSize(this._target.getWidth(), this._target.getHeight());
        renderer.setViewport(x, y, width, height);
        renderer.update(camera);

        gl.viewport(x, y, width, height);
        gl.scissor(x, y, width, height);

        state.enable(gl.SCISSOR_TEST);
        state.enable(gl.DEPTH_TEST);
        state.colorMask(true, true, true, true);
        state.clearColor(1, 1, 1, 1);
        state.depthMask(true);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    private setViewport(viewport: Vec4) {
        ValueCell.update(this.jfaARenderable.values.uViewport, Vec4.copy(this.jfaARenderable.values.uViewport.ref.value, viewport));
        ValueCell.update(this.jfaBRenderable.values.uViewport, Vec4.copy(this.jfaBRenderable.values.uViewport.ref.value, viewport));
    }

    private setJfaState(camera: ICamera, scene: Scene, props: CutawayProps) {
        const { gl, state } = this.webgl;
        const orthographic = camera.state.mode === 'orthographic' ? 1 : 0;

        state.enable(gl.SCISSOR_TEST);
        state.disable(gl.BLEND);
        state.disable(gl.DEPTH_TEST);
        state.depthMask(false);

        let PMsz = orthographic ? 0 : (camera.near + camera.far) / (camera.near - camera.far);

        let invProjection = Mat4.identity();
        Mat4.invert(invProjection, camera.projection);

        ValueCell.updateIfChanged(this.jfaARenderable.values.uInvProjection, invProjection);
        ValueCell.updateIfChanged(this.jfaBRenderable.values.uInvProjection, invProjection);

        ValueCell.updateIfChanged(this.jfaARenderable.values.uPMsz, PMsz);
        ValueCell.updateIfChanged(this.jfaBRenderable.values.uPMsz, PMsz);

        ValueCell.updateIfChanged(this.initRenderable.values.uIsOrtho, orthographic);
        ValueCell.updateIfChanged(this.jfaARenderable.values.uIsOrtho, orthographic);
        ValueCell.updateIfChanged(this.jfaBRenderable.values.uIsOrtho, orthographic);
        ValueCell.updateIfChanged(this.copyToTargetRenderable.values.uIsOrtho, orthographic);

        ValueCell.updateIfChanged(this.initRenderable.values.uNear, camera.near);
        ValueCell.updateIfChanged(this.jfaARenderable.values.uNear, camera.near);
        ValueCell.updateIfChanged(this.jfaBRenderable.values.uNear, camera.near);
        ValueCell.updateIfChanged(this.copyToTargetRenderable.values.uNear, camera.near);

        ValueCell.updateIfChanged(this.initRenderable.values.uFar, camera.far);
        ValueCell.updateIfChanged(this.jfaARenderable.values.uFar, camera.far);
        ValueCell.updateIfChanged(this.jfaBRenderable.values.uFar, camera.far);
        ValueCell.updateIfChanged(this.copyToTargetRenderable.values.uFar, camera.far);

        let angle = props.angle * Math.PI / 180.0;
        ValueCell.updateIfChanged(this.jfaARenderable.values.uAngle, angle);
        ValueCell.updateIfChanged(this.jfaBRenderable.values.uAngle, angle);

        ValueCell.updateIfChanged(this.jfaARenderable.values.uEdgeRegionSize, props.borderSize);
        ValueCell.updateIfChanged(this.jfaBRenderable.values.uEdgeRegionSize, props.borderSize);

        let slopeStartOffset = scene.boundingSphereVisible.radius * props.slopeOffset;
        ValueCell.updateIfChanged(this.jfaARenderable.values.uSlopeStartOffset, slopeStartOffset);
        ValueCell.updateIfChanged(this.jfaBRenderable.values.uSlopeStartOffset, slopeStartOffset);

        let aspectRatio = Vec2.create(camera.viewport.width / camera.viewport.height, 1);
        ValueCell.update(this.jfaARenderable.values.uAspectRatio, Vec2.copy(this.jfaARenderable.values.uAspectRatio.ref.value, aspectRatio));
        ValueCell.update(this.jfaBRenderable.values.uAspectRatio, Vec2.copy(this.jfaBRenderable.values.uAspectRatio.ref.value, aspectRatio));
    }

    private renderDepth(renderer: Renderer, camera: ICamera, scene: Scene, props: CutawayProps) {
        this._target.bind();
        this.setRenderDepthState(renderer, camera);

        let primitives = scene.primitives.renderables.concat();
        let ligand = primitives.filter(r => r.values.cutaway.ref.value);
        let groupLigand: Scene.Group = {
            renderables: ligand,
            direction: scene.primitives.direction,
            position: scene.primitives.position,
            up: scene.primitives.up,
            view: scene.primitives.view
        };

        renderer.renderDepth(groupLigand, camera, null, null);
    }

    private renderJfa(camera: ICamera, scene: Scene, props: CutawayProps) {
        this.setJfaState(camera, scene, props);

        // initialize the A JFA buffer
        this.jfaATarget.bind();
        this.initRenderable.render();

        // JFA
        const width = this.jfaATarget.getWidth();
        const height = this.jfaATarget.getHeight();

        let stepNormalized = Vec2();
        let readingA = true;
        let stepPixels = Math.ceil(Math.max(width, height) * 0.5);

        while (true) {
            Vec2.set(stepNormalized, stepPixels / width, stepPixels / height);
            if (readingA) {
                this.jfaBTarget.bind();
                ValueCell.update(this.jfaARenderable.values.uStep, stepNormalized);
                this.jfaARenderable.render();
            } else {
                this.jfaATarget.bind();
                ValueCell.update(this.jfaBRenderable.values.uStep, stepNormalized);
                this.jfaBRenderable.render();
            }
            readingA = !readingA;
            if (stepPixels <= 1) {
                break;
            }
            stepPixels = Math.ceil(stepPixels / 2);
        }

        // copy from the final JFA buffer
        let finalJfaTexture = readingA ? this.jfaATarget.texture : this.jfaBTarget.texture;
        if (this.copyToTargetRenderable.values.tDepth.ref.value !== finalJfaTexture) {
            ValueCell.update(this.copyToTargetRenderable.values.tDepth, finalJfaTexture);
            this.copyToTargetRenderable.update();
        }

        this._target.bind();
        this.copyToTargetRenderable.render();
    }

    static shouldRun(scene: Scene): boolean {
        for (let i = 0; i < scene.primitives.renderables.length; i++) {
            if (scene.primitives.renderables[i].values.cutaway.ref.value) {
                return true;
            }
        }
        return false;
    }

    render(renderer: Renderer, camera: Camera | StereoCamera, scene: Scene, props: CutawayProps) {
        if (!CutawayPass.supported) {
            return;
        }

        if (!CutawayPass.shouldRun(scene)) {
            this._target.bind();
            if (StereoCamera.is(camera)) {
                this.setRenderDepthState(renderer, camera.left);
                this.setRenderDepthState(renderer, camera.right);
            } else {
                this.setRenderDepthState(renderer, camera);
            }
            return;
        }

        if (StereoCamera.is(camera)) {
            this.setViewport(Vec4.create(0, 0, 0.5, 1));
            this.renderDepth(renderer, camera.left, scene, props);
            this.renderJfa(camera.left, scene, props);

            this.setViewport(Vec4.create(0.5, 0, 0.5, 1));
            this.renderDepth(renderer, camera.right, scene, props);
            this.renderJfa(camera.right, scene, props);
        } else {
            this.setViewport(Vec4.create(0, 0, 1, 1));
            this.renderDepth(renderer, camera, scene, props);
            this.renderJfa(camera, scene, props);
        }
    }

    setSize(width: number, height: number) {
        const [w, h] = this.jfaARenderable.values.uTexSize.ref.value;
        if (width !== w || height !== h) {
            this._target.setSize(width, height);
            this.jfaATarget.setSize(width, height);
            this.jfaBTarget.setSize(width, height);

            ValueCell.update(this.initRenderable.values.uTexSize, Vec2.set(this.initRenderable.values.uTexSize.ref.value, width, height));
            ValueCell.update(this.jfaARenderable.values.uTexSize, Vec2.set(this.jfaARenderable.values.uTexSize.ref.value, width, height));
            ValueCell.update(this.jfaBRenderable.values.uTexSize, Vec2.set(this.jfaBRenderable.values.uTexSize.ref.value, width, height));
            ValueCell.update(this.copyToTargetRenderable.values.uTexSize, Vec2.set(this.copyToTargetRenderable.values.uTexSize.ref.value, width, height));
        }
    }
}