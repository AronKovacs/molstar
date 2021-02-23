/**
 * Copyright (c) 2019-2020 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Áron Samuel Kovács <aron.kovacs@mail.muni.cz>
 */

import { QuadSchema, QuadValues } from '../../mol-gl/compute/util';
import { TextureSpec, Values, UniformSpec, DefineSpec } from '../../mol-gl/renderable/schema';
import { ShaderCode } from '../../mol-gl/shader-code';
import { WebGLContext } from '../../mol-gl/webgl/context';
import { Texture } from '../../mol-gl/webgl/texture';
import { ValueCell } from '../../mol-util';
import { createComputeRenderItem } from '../../mol-gl/webgl/render-item';
import { createComputeRenderable, ComputeRenderable } from '../../mol-gl/renderable';
import { Mat4, Vec2, Vec3, Vec4 } from '../../mol-math/linear-algebra';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { RenderTarget } from '../../mol-gl/webgl/render-target';
import { DrawPass } from './draw';
import { ICamera } from '../../mol-canvas3d/camera';
import quad_vert from '../../mol-gl/shader/quad.vert';
import outlines_frag from '../../mol-gl/shader/outlines.frag';
import outlines_static_frag from  '../../mol-gl/shader/outlines-static.frag';
import outlines_jfa_step_frag from '../../mol-gl/shader/outlines-jfa-step.frag';
import ssao_frag from '../../mol-gl/shader/ssao.frag';
import ssao_blur_frag from '../../mol-gl/shader/ssao-blur.frag';
import postprocessing_depth_merge_frag from '../../mol-gl/shader/postprocessing-depth-merge.frag';
import postprocessing_frag from '../../mol-gl/shader/postprocessing.frag';
import { Framebuffer } from '../../mol-gl/webgl/framebuffer';
import { Color } from '../../mol-util/color';
import { FxaaParams, FxaaPass } from './fxaa';
import { SmaaParams, SmaaPass } from './smaa';
import Scene from '../../mol-gl/scene';
import { isDebugMode } from '../../mol-util/debug';

const OutlinesSchema = {
    ...QuadSchema,
    tDepth: TextureSpec('texture', 'rgba', 'ubyte', 'nearest'),
    uTexSize: UniformSpec('v2'),

    dOrthographic: DefineSpec('number'),
    uNear: UniformSpec('f'),
    uFar: UniformSpec('f'),

    dOutlineDynamicWidth: DefineSpec('number'),
    uInvProjection: UniformSpec('m4'),

    uMaxPossibleViewZDiff: UniformSpec('f'),
};
type OutlinesRenderable = ComputeRenderable<Values<typeof OutlinesSchema>>

function getOutlinesRenderable(ctx: WebGLContext, depthTexture: Texture): OutlinesRenderable {
    const values: Values<typeof OutlinesSchema> = {
        ...QuadValues,
        tDepth: ValueCell.create(depthTexture),
        uTexSize: ValueCell.create(Vec2.create(depthTexture.getWidth(), depthTexture.getHeight())),

        dOrthographic: ValueCell.create(0),
        uNear: ValueCell.create(1),
        uFar: ValueCell.create(10000),

        dOutlineDynamicWidth: ValueCell.create(5),
        uInvProjection: ValueCell.create(Mat4.identity()),

        uMaxPossibleViewZDiff: ValueCell.create(0.5),
    };

    const schema = { ...OutlinesSchema };
    const shaderCode = ShaderCode('outlines', quad_vert, outlines_frag);
    const renderItem = createComputeRenderItem(ctx, 'triangles', shaderCode, schema, values);

    return createComputeRenderable(renderItem, values);
}

const OutlinesStaticSchema = {
    ...QuadSchema,
    tOutlines: TextureSpec('texture', 'rgba', 'ubyte', 'nearest'),
    tDepth: TextureSpec('texture', 'rgba', 'ubyte', 'nearest'),
    uTexSize: UniformSpec('v2'),

    dOrthographic: DefineSpec('number'),
    uNear: UniformSpec('f'),
    uFar: UniformSpec('f'),

    dOutlineScale: DefineSpec('number'),
    uMaxPossibleViewZDiff: UniformSpec('f'),
};
type OutlinesStaticRenderable = ComputeRenderable<Values<typeof OutlinesStaticSchema>>

function getOutlinesStaticRenderable(ctx: WebGLContext, outlinesTexture: Texture, depthTexture: Texture): OutlinesStaticRenderable {
    const values: Values<typeof OutlinesStaticSchema> = {
        ...QuadValues,
        tOutlines: ValueCell.create(outlinesTexture),
        tDepth: ValueCell.create(depthTexture),
        uTexSize: ValueCell.create(Vec2.create(depthTexture.getWidth(), depthTexture.getHeight())),

        dOrthographic: ValueCell.create(0),
        uNear: ValueCell.create(1),
        uFar: ValueCell.create(10000),

        dOutlineScale: ValueCell.create(1),
        uMaxPossibleViewZDiff: ValueCell.create(0.5),
    };

    const schema = { ...OutlinesStaticSchema };
    const shaderCode = ShaderCode('outlines-static', quad_vert, outlines_static_frag);
    const renderItem = createComputeRenderItem(ctx, 'triangles', shaderCode, schema, values);

    return createComputeRenderable(renderItem, values);
}

const OutlinesJfaSchema = {
    ...QuadSchema,
    tOutlines: TextureSpec('texture', 'rgba', 'float', 'nearest'),
    uTexSize: UniformSpec('v2'),
    uStep: UniformSpec('v2'),
    uOutlineViewRadius: UniformSpec('f'),
};
type OutlinesJfaRenderable = ComputeRenderable<Values<typeof OutlinesJfaSchema>>

function getOutlinesJfaRenderable(ctx: WebGLContext, outlineTexture: Texture): OutlinesJfaRenderable {
    const values: Values<typeof OutlinesJfaSchema> = {
        ...QuadValues,
        tOutlines: ValueCell.create(outlineTexture),
        uTexSize: ValueCell.create(Vec2.create(outlineTexture.getWidth(), outlineTexture.getHeight())),
        uStep: ValueCell.create(Vec2.create(0, 0)),
        uOutlineViewRadius: ValueCell.create(0.0001),
    };

    const schema = { ...OutlinesJfaSchema };
    const shaderCode = ShaderCode('outlines-jfa', quad_vert, outlines_jfa_step_frag);
    const renderItem = createComputeRenderItem(ctx, 'triangles', shaderCode, schema, values);

    return createComputeRenderable(renderItem, values);
}

const SsaoSchema = {
    ...QuadSchema,
    tDepth: TextureSpec('texture', 'rgba', 'ubyte', 'nearest'),

    uSamples: UniformSpec('v3[]'),
    dNSamples: DefineSpec('number'),

    uProjection: UniformSpec('m4'),
    uInvProjection: UniformSpec('m4'),

    uTexSize: UniformSpec('v2'),

    uRadius: UniformSpec('f'),
    uBias: UniformSpec('f'),
};

type SsaoRenderable = ComputeRenderable<Values<typeof SsaoSchema>>

function getSsaoRenderable(ctx: WebGLContext, depthTexture: Texture): SsaoRenderable {
    const values: Values<typeof SsaoSchema> = {
        ...QuadValues,
        tDepth: ValueCell.create(depthTexture),

        uSamples: ValueCell.create([0.0, 0.0, 1.0]),
        dNSamples: ValueCell.create(1),

        uProjection: ValueCell.create(Mat4.identity()),
        uInvProjection: ValueCell.create(Mat4.identity()),

        uTexSize: ValueCell.create(Vec2.create(ctx.gl.drawingBufferWidth, ctx.gl.drawingBufferHeight)),

        uRadius: ValueCell.create(8.0),
        uBias: ValueCell.create(0.025),
    };

    const schema = { ...SsaoSchema };
    const shaderCode = ShaderCode('ssao', quad_vert, ssao_frag);
    const renderItem = createComputeRenderItem(ctx, 'triangles', shaderCode, schema, values);

    return createComputeRenderable(renderItem, values);
}

const SsaoBlurSchema = {
    ...QuadSchema,
    tSsaoDepth: TextureSpec('texture', 'rgba', 'ubyte', 'nearest'),
    uTexSize: UniformSpec('v2'),

    uKernel: UniformSpec('f[]'),
    dOcclusionKernelSize: DefineSpec('number'),

    uBlurDirectionX: UniformSpec('f'),
    uBlurDirectionY: UniformSpec('f'),

    uMaxPossibleViewZDiff: UniformSpec('f'),

    uNear: UniformSpec('f'),
    uFar: UniformSpec('f'),
    dOrthographic: DefineSpec('number'),
};

type SsaoBlurRenderable = ComputeRenderable<Values<typeof SsaoBlurSchema>>

function getSsaoBlurRenderable(ctx: WebGLContext, ssaoDepthTexture: Texture, direction: 'horizontal' | 'vertical'): SsaoBlurRenderable {
    const values: Values<typeof SsaoBlurSchema> = {
        ...QuadValues,
        tSsaoDepth: ValueCell.create(ssaoDepthTexture),
        uTexSize: ValueCell.create(Vec2.create(ssaoDepthTexture.getWidth(), ssaoDepthTexture.getHeight())),

        uKernel: ValueCell.create([0.0]),
        dOcclusionKernelSize: ValueCell.create(1),

        uBlurDirectionX: ValueCell.create(direction === 'horizontal' ? 1 : 0),
        uBlurDirectionY: ValueCell.create(direction === 'vertical' ? 1 : 0),

        uMaxPossibleViewZDiff: ValueCell.create(0.5),

        uNear: ValueCell.create(0.0),
        uFar: ValueCell.create(10000.0),
        dOrthographic: ValueCell.create(0),
    };

    const schema = { ...SsaoBlurSchema };
    const shaderCode = ShaderCode('ssao_blur', quad_vert, ssao_blur_frag);
    const renderItem = createComputeRenderItem(ctx, 'triangles', shaderCode, schema, values);

    return createComputeRenderable(renderItem, values);
}

function getBlurKernel(kernelSize: number): number[] {
    let sigma = kernelSize / 3.0;
    let halfKernelSize = Math.floor((kernelSize + 1) / 2);

    let kernel = [];
    for (let x = 0; x < halfKernelSize; x++) {
        kernel.push((1.0 / ((Math.sqrt(2 * Math.PI)) * sigma)) * Math.exp(-x * x / (2 * sigma * sigma)));
    }

    return kernel;
}

function getSamples(vectorSamples: Vec3[], nSamples: number): number[] {
    let samples = [];
    for (let i = 0; i < nSamples; i++) {
        let scale = (i * i + 2.0 * i + 1) / (nSamples * nSamples);
        scale = 0.1 + scale * (1.0 - 0.1);

        samples.push(vectorSamples[i][0] * scale);
        samples.push(vectorSamples[i][1] * scale);
        samples.push(vectorSamples[i][2] * scale);
    }

    return samples;
}

const PostprocessingDepthMergeSchema = {
    ...QuadSchema,
    tDepth: TextureSpec('texture', 'rgba', 'ubyte', 'nearest'),
    tOutlines: TextureSpec('texture', 'rgba', 'ubyte', 'nearest'),
    uTexSize: UniformSpec('v2'),
    dOutlineDynamicWidth: DefineSpec('number'),
};
type PostprocessingDepthMergeRenderable = ComputeRenderable<Values<typeof PostprocessingDepthMergeSchema>>

function getPostprocessingDepthMergeRenderable(ctx: WebGLContext, depthTexture: Texture, outlinesTexture: Texture): PostprocessingDepthMergeRenderable {
    const values: Values<typeof PostprocessingDepthMergeSchema> = {
        ...QuadValues,
        tDepth: ValueCell.create(depthTexture),
        tOutlines: ValueCell.create(outlinesTexture),
        uTexSize: ValueCell.create(Vec2.create(depthTexture.getWidth(), depthTexture.getHeight())),
        dOutlineDynamicWidth: ValueCell.create(0),
    };

    const schema = { ...PostprocessingDepthMergeSchema };
    const shaderCode = ShaderCode('postprocessing-depth-merge', quad_vert, postprocessing_depth_merge_frag);
    const renderItem = createComputeRenderItem(ctx, 'triangles', shaderCode, schema, values);

    return createComputeRenderable(renderItem, values);
}

const PostprocessingSchema = {
    ...QuadSchema,
    tSsaoDepth: TextureSpec('texture', 'rgba', 'ubyte', 'nearest'),
    tColor: TextureSpec('texture', 'rgba', 'ubyte', 'nearest'),
    tDepth: TextureSpec('texture', 'rgba', 'ubyte', 'nearest'),
    tOutlines: TextureSpec('texture', 'rgba', 'ubyte', 'nearest'),
    uTexSize: UniformSpec('v2'),

    dOrthographic: DefineSpec('number'),
    uNear: UniformSpec('f'),
    uFar: UniformSpec('f'),
    uFogNear: UniformSpec('f'),
    uFogFar: UniformSpec('f'),
    uFogColor: UniformSpec('v3'),
    uTransparentBackground: UniformSpec('b'),

    dOcclusionEnable: DefineSpec('boolean'),

    dOutlineEnable: DefineSpec('boolean'),
    dOutlineDynamicWidth: DefineSpec('number'),
};
type PostprocessingRenderable = ComputeRenderable<Values<typeof PostprocessingSchema>>

function getPostprocessingRenderable(ctx: WebGLContext, colorTexture: Texture, depthTexture: Texture, outlinesTexture: Texture, ssaoDepthTexture: Texture): PostprocessingRenderable {
    const values: Values<typeof PostprocessingSchema> = {
        ...QuadValues,
        tSsaoDepth: ValueCell.create(ssaoDepthTexture),
        tColor: ValueCell.create(colorTexture),
        tDepth: ValueCell.create(depthTexture),
        tOutlines: ValueCell.create(outlinesTexture),
        uTexSize: ValueCell.create(Vec2.create(colorTexture.getWidth(), colorTexture.getHeight())),

        dOrthographic: ValueCell.create(0),
        uNear: ValueCell.create(1),
        uFar: ValueCell.create(10000),
        uFogNear: ValueCell.create(10000),
        uFogFar: ValueCell.create(10000),
        uFogColor: ValueCell.create(Vec3.create(1, 1, 1)),
        uTransparentBackground: ValueCell.create(false),

        dOcclusionEnable: ValueCell.create(false),

        dOutlineEnable: ValueCell.create(false),
        dOutlineDynamicWidth: ValueCell.create(1),
    };

    const schema = { ...PostprocessingSchema };
    const shaderCode = ShaderCode('postprocessing', quad_vert, postprocessing_frag);
    const renderItem = createComputeRenderItem(ctx, 'triangles', shaderCode, schema, values);

    return createComputeRenderable(renderItem, values);
}

export const PostprocessingParams = {
    occlusion: PD.MappedStatic('on', {
        on: PD.Group({
            samples: PD.Numeric(64, {min: 1, max: 256, step: 1}),
            radius: PD.Numeric(5, { min: 0, max: 10, step: 0.1 }, { description: 'Final radius is 2^x.' }),
            bias: PD.Numeric(0.8, { min: 0, max: 3, step: 0.1 }),
            blurKernelSize: PD.Numeric(25, { min: 1, max: 25, step: 2 }),
        }),
        off: PD.Group({})
    }, { cycle: true, description: 'Darken occluded crevices with the ambient occlusion effect' }),
    outline: PD.MappedStatic('off', {
        staticWidth: PD.Group({
            width: PD.Numeric(1, { min: 1, max: 5, step: 1 }, { description: 'Width in pixels.' }),
            threshold: PD.Numeric(0.33, { min: 0.01, max: 1, step: 0.01 }),
        }),
        dynamicWidth: PD.Group({
            width: PD.Numeric(0.005, { min: 0.001, max: 0.05, step: 0.001 }),
            threshold: PD.Numeric(0.33, { min: 0.01, max: 1, step: 0.01 }),
        }),
        off: PD.Group({})
    }, { description: 'Draw outline around 3D objects' }),
    antialiasing: PD.MappedStatic('smaa', {
        fxaa: PD.Group(FxaaParams),
        smaa: PD.Group(SmaaParams),
        off: PD.Group({})
    }, { options: [['fxaa', 'FXAA'], ['smaa', 'SMAA'], ['off', 'Off']], description: 'Smooth pixel edges' }),
};
export type PostprocessingProps = PD.Values<typeof PostprocessingParams>

export class PostprocessingPass {
    static isEnabled(props: PostprocessingProps) {
        return props.occlusion.name === 'on' || props.outline.name !== 'off';
    }

    readonly target: RenderTarget

    private readonly drawPassDepthTexture: Texture

    private readonly outlinesTarget: RenderTarget
    private readonly outlinesRenderable: OutlinesRenderable

    private readonly outlinesStaticTarget: RenderTarget
    private readonly outlinesStaticRenderable: OutlinesStaticRenderable

    private readonly outlinesJfaATarget: RenderTarget
    private readonly outlinesJfaBTarget: RenderTarget
    private readonly outlinesJfaARenderable: OutlinesJfaRenderable
    private readonly outlinesJfaBRenderable: OutlinesJfaRenderable

    private readonly randomHemisphereVector: Vec3[]
    private readonly ssaoFramebuffer: Framebuffer
    private readonly ssaoBlurFirstPassFramebuffer: Framebuffer
    private readonly ssaoBlurSecondPassFramebuffer: Framebuffer

    private readonly ssaoDepthTexture: Texture
    private readonly ssaoDepthBlurProxyTexture: Texture

    private readonly depthTarget: RenderTarget
    private readonly depthMergeRenderable: PostprocessingDepthMergeRenderable

    private readonly ssaoRenderable: SsaoRenderable
    private readonly ssaoBlurFirstPassRenderable: SsaoBlurRenderable
    private readonly ssaoBlurSecondPassRenderable: SsaoBlurRenderable

    private nSamples: number
    private blurKernelSize: number

    private maxPixelViewRadius: number

    private readonly renderable: PostprocessingRenderable

    private readonly _dynamicOutlinesSupported: boolean
    public get dynamicOutlinesSupported() {
        return this._dynamicOutlinesSupported;
    }

    static areDynamicOutlinesSupported(webgl: WebGLContext) {
        const { extensions: { textureFloat, colorBufferFloat } } = webgl;
        if (!textureFloat || !colorBufferFloat) {
            if (isDebugMode) {
                const missing: string[] = [];
                if (!textureFloat) missing.push('textureFloat');
                if (!colorBufferFloat) missing.push('colorBufferFloat');
                console.log(`Missing "${missing.join('", "')}" extensions required for "dynamic outlines"`);
            }
            return false;
        } else {
            return true;
        }
    }

    constructor(private webgl: WebGLContext, drawPass: DrawPass) {
        const { colorTarget, depthTexture } = drawPass;
        const width = colorTarget.getWidth();
        const height = colorTarget.getHeight();

        this._dynamicOutlinesSupported = PostprocessingPass.areDynamicOutlinesSupported(webgl);

        this.drawPassDepthTexture = depthTexture;

        this.nSamples = 1;
        this.blurKernelSize = 1;
        this.maxPixelViewRadius = 1;

        this.target = webgl.createRenderTarget(width, height, false, 'uint8', 'linear');

        this.outlinesTarget = webgl.createRenderTarget(width, height, false);
        this.outlinesRenderable = getOutlinesRenderable(webgl, this.drawPassDepthTexture);

        this.outlinesStaticTarget = webgl.createRenderTarget(width, height, false, 'uint8', 'nearest');
        this.outlinesStaticRenderable = getOutlinesStaticRenderable(webgl, this.outlinesTarget.texture, this.drawPassDepthTexture);

        this.outlinesJfaATarget = webgl.createRenderTarget(width, height, false, 'float32', 'nearest');
        this.outlinesJfaBTarget = webgl.createRenderTarget(width, height, false, 'float32', 'nearest');
        this.outlinesJfaARenderable = getOutlinesJfaRenderable(webgl, this.outlinesJfaATarget.texture);
        this.outlinesJfaBRenderable = getOutlinesJfaRenderable(webgl, this.outlinesJfaBTarget.texture);

        this.randomHemisphereVector = [];
        for (let i = 0; i < 256; i++) {
            let v = Vec3();
            v[0] = Math.random() * 2.0 - 1.0;
            v[1] = Math.random() * 2.0 - 1.0;
            v[2] = Math.random();
            Vec3.normalize(v, v);
            Vec3.scale(v, v, Math.random());
            this.randomHemisphereVector.push(v);
        }
        this.ssaoFramebuffer = webgl.resources.framebuffer();
        this.ssaoBlurFirstPassFramebuffer = webgl.resources.framebuffer();
        this.ssaoBlurSecondPassFramebuffer = webgl.resources.framebuffer();

        this.ssaoDepthTexture = webgl.resources.texture('image-uint8', 'rgba', 'ubyte', 'nearest');
        this.ssaoDepthTexture.define(width, height);
        this.ssaoDepthTexture.attachFramebuffer(this.ssaoFramebuffer, 'color0');

        this.ssaoDepthBlurProxyTexture = webgl.resources.texture('image-uint8', 'rgba', 'ubyte', 'nearest');
        this.ssaoDepthBlurProxyTexture.define(width, height);
        this.ssaoDepthBlurProxyTexture.attachFramebuffer(this.ssaoBlurFirstPassFramebuffer, 'color0');

        this.ssaoDepthTexture.attachFramebuffer(this.ssaoBlurSecondPassFramebuffer, 'color0');

        this.depthTarget = webgl.createRenderTarget(width, height, false, 'uint8', 'nearest');
        this.depthMergeRenderable = getPostprocessingDepthMergeRenderable(webgl, this.drawPassDepthTexture, this.outlinesStaticTarget.texture);

        this.ssaoRenderable = getSsaoRenderable(webgl, this.drawPassDepthTexture);
        this.ssaoBlurFirstPassRenderable = getSsaoBlurRenderable(webgl, this.ssaoDepthTexture, 'horizontal');
        this.ssaoBlurSecondPassRenderable = getSsaoBlurRenderable(webgl, this.ssaoDepthBlurProxyTexture, 'vertical');
        this.renderable = getPostprocessingRenderable(webgl, colorTarget.texture,  this.drawPassDepthTexture, this.outlinesTarget.texture, this.ssaoDepthTexture);
    }

    setSize(width: number, height: number) {
        const [w, h] = this.renderable.values.uTexSize.ref.value;
        if (width !== w || height !== h) {
            this.target.setSize(width, height);
            this.depthTarget.setSize(width, height);
            this.outlinesTarget.setSize(width, height);
            this.outlinesStaticTarget.setSize(width, height);
            this.outlinesJfaATarget.setSize(width, height);
            this.outlinesJfaBTarget.setSize(width, height);
            this.ssaoDepthTexture.define(width, height);
            this.ssaoDepthBlurProxyTexture.define(width, height);

            ValueCell.update(this.renderable.values.uTexSize, Vec2.set(this.renderable.values.uTexSize.ref.value, width, height));
            ValueCell.update(this.depthMergeRenderable.values.uTexSize, Vec2.set(this.depthMergeRenderable.values.uTexSize.ref.value, width, height));
            ValueCell.update(this.outlinesRenderable.values.uTexSize, Vec2.set(this.outlinesRenderable.values.uTexSize.ref.value, width, height));
            ValueCell.update(this.outlinesStaticRenderable.values.uTexSize, Vec2.set(this.outlinesStaticRenderable.values.uTexSize.ref.value, width, height));
            ValueCell.update(this.outlinesJfaARenderable.values.uTexSize, Vec2.set(this.outlinesJfaARenderable.values.uTexSize.ref.value, width, height));
            ValueCell.update(this.outlinesJfaBRenderable.values.uTexSize, Vec2.set(this.outlinesJfaBRenderable.values.uTexSize.ref.value, width, height));
            ValueCell.update(this.ssaoRenderable.values.uTexSize, Vec2.set(this.ssaoRenderable.values.uTexSize.ref.value, width, height));
            ValueCell.update(this.ssaoBlurFirstPassRenderable.values.uTexSize, Vec2.set(this.ssaoRenderable.values.uTexSize.ref.value, width, height));
            ValueCell.update(this.ssaoBlurSecondPassRenderable.values.uTexSize, Vec2.set(this.ssaoRenderable.values.uTexSize.ref.value, width, height));
        }
    }

    private updateState(camera: ICamera, scene: Scene, transparentBackground: boolean, backgroundColor: Color, props: PostprocessingProps) {
        const { x, y, width, height } = camera.viewport;

        const orthographic = camera.state.mode === 'orthographic' ? 1 : 0;
        const outlinesEnabled = props.outline.name !== 'off';
        const outlinesDynamicWidth = props.outline.name === 'dynamicWidth' ? 1 : 0;
        const occlusionEnabled = props.occlusion.name === 'on';

        let needsUpdateMain = false;
        let needsUpdateOutlines = false;
        let needsUpdateOutlinesStatic = false;
        let needsUpdateSsao = false;
        let needsUpdateSsaoBlur = false;

        let invProjection = Mat4.identity();
        Mat4.invert(invProjection, camera.projection);

        let coord0 = Vec4.create(-1, -1 + 1 / height, -1, 1.0);
        let coord1 = Vec4.create(-1 + 2 / width, -1 + 1 / height, -1, 1.0);
        Vec4.transformMat4(coord0, coord0, invProjection);
        Vec4.transformMat4(coord1, coord1, invProjection);
        this.maxPixelViewRadius = Math.abs((coord0[0] / coord0[3]) - (coord1[0] / coord1[3]));

        if (props.occlusion.name === 'on') {
            ValueCell.updateIfChanged(this.ssaoRenderable.values.uProjection, camera.projection);
            ValueCell.updateIfChanged(this.ssaoRenderable.values.uInvProjection, invProjection);

            ValueCell.updateIfChanged(this.ssaoBlurFirstPassRenderable.values.uNear, camera.near);
            ValueCell.updateIfChanged(this.ssaoBlurSecondPassRenderable.values.uNear, camera.near);

            ValueCell.updateIfChanged(this.ssaoBlurFirstPassRenderable.values.uFar, camera.far);
            ValueCell.updateIfChanged(this.ssaoBlurSecondPassRenderable.values.uFar, camera.far);

            let maxPossibleViewZDiff = props.occlusion.params.radius / 16;
            ValueCell.updateIfChanged(this.ssaoBlurFirstPassRenderable.values.uMaxPossibleViewZDiff, maxPossibleViewZDiff);
            ValueCell.updateIfChanged(this.ssaoBlurSecondPassRenderable.values.uMaxPossibleViewZDiff, maxPossibleViewZDiff);

            if (this.ssaoBlurFirstPassRenderable.values.dOrthographic.ref.value !== orthographic) { needsUpdateSsaoBlur = true; }
            ValueCell.updateIfChanged(this.ssaoBlurFirstPassRenderable.values.dOrthographic, orthographic);
            ValueCell.updateIfChanged(this.ssaoBlurSecondPassRenderable.values.dOrthographic, orthographic);

            if (this.nSamples !== props.occlusion.params.samples) {
                needsUpdateSsao = true;

                this.nSamples = props.occlusion.params.samples;
                ValueCell.updateIfChanged(this.ssaoRenderable.values.uSamples, getSamples(this.randomHemisphereVector, this.nSamples));
                ValueCell.updateIfChanged(this.ssaoRenderable.values.dNSamples, this.nSamples);
            }
            ValueCell.updateIfChanged(this.ssaoRenderable.values.uRadius, Math.pow(2, props.occlusion.params.radius));
            ValueCell.updateIfChanged(this.ssaoRenderable.values.uBias, props.occlusion.params.bias);

            if (this.blurKernelSize !== props.occlusion.params.blurKernelSize) {
                needsUpdateSsaoBlur = true;

                this.blurKernelSize = props.occlusion.params.blurKernelSize;
                let kernel = getBlurKernel(this.blurKernelSize);

                ValueCell.updateIfChanged(this.ssaoBlurFirstPassRenderable.values.uKernel, kernel);
                ValueCell.updateIfChanged(this.ssaoBlurSecondPassRenderable.values.uKernel, kernel);
                ValueCell.updateIfChanged(this.ssaoBlurFirstPassRenderable.values.dOcclusionKernelSize, this.blurKernelSize);
                ValueCell.updateIfChanged(this.ssaoBlurSecondPassRenderable.values.dOcclusionKernelSize, this.blurKernelSize);
            }

        }

        if (props.outline.name !== 'off') {
            const factor = Math.pow(1000, props.outline.params.threshold) / 1000;
            const maxPossibleViewZDiff = factor * (camera.far - camera.near);

            // outlines gen
            ValueCell.updateIfChanged(this.outlinesRenderable.values.uNear, camera.near);
            ValueCell.updateIfChanged(this.outlinesRenderable.values.uFar, camera.far);
            ValueCell.updateIfChanged(this.outlinesRenderable.values.uMaxPossibleViewZDiff, maxPossibleViewZDiff);
            ValueCell.updateIfChanged(this.outlinesRenderable.values.uInvProjection, invProjection);
            if (this.outlinesRenderable.values.dOrthographic.ref.value !== orthographic) { needsUpdateOutlines = true; }
            ValueCell.updateIfChanged(this.outlinesRenderable.values.dOrthographic, orthographic);
            if (this.outlinesRenderable.values.dOutlineDynamicWidth.ref.value !== outlinesDynamicWidth) { needsUpdateOutlines = true; }
            ValueCell.updateIfChanged(this.outlinesRenderable.values.dOutlineDynamicWidth, outlinesDynamicWidth);

            if (outlinesDynamicWidth) {
                let outlineViewWidth = props.outline.params.width * scene.boundingSphereVisible.radius;

                ValueCell.updateIfChanged(this.outlinesJfaARenderable.values.uOutlineViewRadius, outlineViewWidth);
                ValueCell.updateIfChanged(this.outlinesJfaBRenderable.values.uOutlineViewRadius, outlineViewWidth);
            } else {
                let outlinePixelWidth = Math.ceil(this.webgl.pixelRatio * (props.outline.params.width - 1));

                if (this.outlinesStaticRenderable.values.dOrthographic.ref.value !== orthographic) { needsUpdateOutlinesStatic = true; }
                ValueCell.updateIfChanged(this.outlinesStaticRenderable.values.dOrthographic, orthographic);
                ValueCell.updateIfChanged(this.outlinesStaticRenderable.values.uNear, camera.near);
                ValueCell.updateIfChanged(this.outlinesStaticRenderable.values.uFar, camera.far);
                if (this.outlinesStaticRenderable.values.dOutlineScale.ref.value !== outlinePixelWidth) { needsUpdateOutlinesStatic = true; }
                ValueCell.updateIfChanged(this.outlinesStaticRenderable.values.dOutlineScale, outlinePixelWidth);
                ValueCell.updateIfChanged(this.outlinesStaticRenderable.values.uMaxPossibleViewZDiff, maxPossibleViewZDiff);
            }

            // postprocessing renderable
            if (this.renderable.values.dOutlineDynamicWidth.ref.value !== outlinesDynamicWidth) { needsUpdateMain = true; }
            ValueCell.updateIfChanged(this.renderable.values.dOutlineDynamicWidth, outlinesDynamicWidth);
        }

        ValueCell.updateIfChanged(this.renderable.values.uFar, camera.far);
        ValueCell.updateIfChanged(this.renderable.values.uNear, camera.near);
        ValueCell.updateIfChanged(this.renderable.values.uFogFar, camera.fogFar);
        ValueCell.updateIfChanged(this.renderable.values.uFogNear, camera.fogNear);
        ValueCell.update(this.renderable.values.uFogColor, Color.toVec3Normalized(this.renderable.values.uFogColor.ref.value, backgroundColor));
        ValueCell.updateIfChanged(this.renderable.values.uTransparentBackground, transparentBackground);
        if (this.renderable.values.dOrthographic.ref.value !== orthographic) { needsUpdateMain = true; }
        ValueCell.updateIfChanged(this.renderable.values.dOrthographic, orthographic);
        if (this.renderable.values.dOutlineEnable.ref.value !== outlinesEnabled) { needsUpdateMain = true; }
        ValueCell.updateIfChanged(this.renderable.values.dOutlineEnable, outlinesEnabled);
        if (this.renderable.values.dOcclusionEnable.ref.value !== occlusionEnabled) { needsUpdateMain = true; }
        ValueCell.updateIfChanged(this.renderable.values.dOcclusionEnable, occlusionEnabled);

        if (needsUpdateOutlines) {
            this.outlinesRenderable.update();
        }

        if (needsUpdateOutlinesStatic) {
            this.outlinesStaticRenderable.update();
        }

        if (needsUpdateSsao) {
            this.ssaoRenderable.update();
        }

        if (needsUpdateSsaoBlur) {
            this.ssaoBlurFirstPassRenderable.update();
            this.ssaoBlurSecondPassRenderable.update();
        }

        if (needsUpdateMain) {
            this.renderable.update();
        }

        const { gl, state } = this.webgl;

        state.enable(gl.SCISSOR_TEST);
        state.disable(gl.BLEND);
        state.disable(gl.DEPTH_TEST);
        state.depthMask(false);

        gl.viewport(x, y, width, height);
        gl.scissor(x, y, width, height);
    }

    private dynamicWidthOutlines(): Texture {
        const width = this.outlinesJfaATarget.getWidth();
        const height = this.outlinesJfaATarget.getHeight();

        // create outlines
        this.outlinesJfaATarget.bind();
        this.outlinesRenderable.render();

        // jfa
        let stepNormalized = Vec2();
        let readingA = true;

        for (let i = 0; i < 1; i++) {
            Vec2.set(stepNormalized, 1 / width, 1 / height);
            if (readingA) {
                this.outlinesJfaBTarget.bind();
                ValueCell.update(this.outlinesJfaARenderable.values.uStep, stepNormalized);
                this.outlinesJfaARenderable.render();
            } else {
                this.outlinesJfaATarget.bind();
                ValueCell.update(this.outlinesJfaBRenderable.values.uStep, stepNormalized);
                this.outlinesJfaBRenderable.render();
            }
            readingA = !readingA;
        }

        let stepPixels = Math.ceil(this.outlinesJfaARenderable.values.uOutlineViewRadius.ref.value / this.maxPixelViewRadius) + 1;
        while (true) {
            Vec2.set(stepNormalized, stepPixels / width, stepPixels / height);
            if (readingA) {
                this.outlinesJfaBTarget.bind();
                ValueCell.update(this.outlinesJfaARenderable.values.uStep, stepNormalized);
                this.outlinesJfaARenderable.render();
            } else {
                this.outlinesJfaATarget.bind();
                ValueCell.update(this.outlinesJfaBRenderable.values.uStep, stepNormalized);
                this.outlinesJfaBRenderable.render();
            }
            readingA = !readingA;
            if (stepPixels <= 1) {
                break;
            }
            stepPixels = Math.ceil(stepPixels / 2);
        }

        for (let i = 0; i < 1; i++) {
            Vec2.set(stepNormalized, 1 / width, 1 / height);
            if (readingA) {
                this.outlinesJfaBTarget.bind();
                ValueCell.update(this.outlinesJfaARenderable.values.uStep, stepNormalized);
                this.outlinesJfaARenderable.render();
            } else {
                this.outlinesJfaATarget.bind();
                ValueCell.update(this.outlinesJfaBRenderable.values.uStep, stepNormalized);
                this.outlinesJfaBRenderable.render();
            }
            readingA = !readingA;
        }

        return readingA ? this.outlinesJfaATarget.texture : this.outlinesJfaBTarget.texture;
    }

    render(camera: ICamera, scene: Scene, toDrawingBuffer: boolean, transparentBackground: boolean, backgroundColor: Color, props: PostprocessingProps) {
        this.updateState(camera, scene, transparentBackground, backgroundColor, props);

        if (props.outline.name === 'staticWidth') {
            this.outlinesTarget.bind();
            this.outlinesRenderable.render();

            this.outlinesStaticTarget.bind();
            this.outlinesStaticRenderable.render();

            if (this.renderable.values.tOutlines.ref.value !== this.outlinesStaticTarget.texture) {
                ValueCell.update(this.renderable.values.tOutlines, this.outlinesStaticTarget.texture);
                this.renderable.update();
            }

            if (this.depthMergeRenderable.values.tOutlines.ref.value !== this.outlinesStaticTarget.texture || this.depthMergeRenderable.values.dOutlineDynamicWidth.ref.value !== 0) {
                ValueCell.updateIfChanged(this.depthMergeRenderable.values.tOutlines, this.outlinesStaticTarget.texture);
                ValueCell.updateIfChanged(this.depthMergeRenderable.values.dOutlineDynamicWidth, 0);
                this.depthMergeRenderable.update();
            }
        } else if (props.outline.name === 'dynamicWidth') {
            let outlines = this.dynamicWidthOutlines();

            if (this.renderable.values.tOutlines.ref.value !== outlines) {
                ValueCell.update(this.renderable.values.tOutlines, outlines);
                this.renderable.update();
            }

            if (this.depthMergeRenderable.values.tOutlines.ref.value !== outlines || this.depthMergeRenderable.values.dOutlineDynamicWidth.ref.value !== 1) {
                ValueCell.updateIfChanged(this.depthMergeRenderable.values.tOutlines, outlines);
                ValueCell.updateIfChanged(this.depthMergeRenderable.values.dOutlineDynamicWidth, 1);
                this.depthMergeRenderable.update();
            }
        }

        if (props.outline.name !== 'off') {
            this.depthTarget.bind();
            this.depthMergeRenderable.render();
        }

        if (props.occlusion.name === 'on') {
            this.ssaoFramebuffer.bind();
            this.ssaoRenderable.render();

            this.ssaoBlurFirstPassFramebuffer.bind();
            this.ssaoBlurFirstPassRenderable.render();

            this.ssaoBlurSecondPassFramebuffer.bind();
            this.ssaoBlurSecondPassRenderable.render();
        }

        if (toDrawingBuffer) {
            this.webgl.unbindFramebuffer();
        } else {
            this.target.bind();
        }

        const { gl, state } = this.webgl;
        state.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        this.renderable.render();
    }

    getDepthTarget(props: PostprocessingProps): Texture {
        return props.outline.name === 'off' ? this.drawPassDepthTexture : this.depthTarget.texture;
    }
}

export class AntialiasingPass {
    static isEnabled(props: PostprocessingProps) {
        return props.antialiasing.name !== 'off';
    }

    readonly target: RenderTarget
    private readonly fxaa: FxaaPass
    private readonly smaa: SmaaPass

    constructor(webgl: WebGLContext, private drawPass: DrawPass) {
        const { colorTarget } = drawPass;
        const width = colorTarget.getWidth();
        const height = colorTarget.getHeight();

        this.target = webgl.createRenderTarget(width, height, false);
        this.fxaa = new FxaaPass(webgl, this.target.texture);
        this.smaa = new SmaaPass(webgl, this.target.texture);
    }

    setSize(width: number, height: number) {
        const w = this.target.texture.getWidth();
        const h = this.target.texture.getHeight();

        if (width !== w || height !== h) {
            this.target.setSize(width, height);
            this.fxaa.setSize(width, height);
            if (this.smaa.supported) this.smaa.setSize(width, height);
        }
    }

    private _renderFxaa(camera: ICamera, toDrawingBuffer: boolean, props: PostprocessingProps) {
        if (props.antialiasing.name !== 'fxaa') return;

        const input = PostprocessingPass.isEnabled(props)
            ? this.drawPass.postprocessing.target.texture
            : this.drawPass.colorTarget.texture;
        this.fxaa.update(input, props.antialiasing.params);
        this.fxaa.render(camera.viewport, toDrawingBuffer ? undefined : this.target);
    }

    private _renderSmaa(camera: ICamera, toDrawingBuffer: boolean, props: PostprocessingProps) {
        if (props.antialiasing.name !== 'smaa') return;

        const input = PostprocessingPass.isEnabled(props)
            ? this.drawPass.postprocessing.target.texture
            : this.drawPass.colorTarget.texture;
        this.smaa.update(input, props.antialiasing.params);
        this.smaa.render(camera.viewport, toDrawingBuffer ? undefined : this.target);
    }

    render(camera: ICamera, toDrawingBuffer: boolean, props: PostprocessingProps) {
        if (props.antialiasing.name === 'off') return;

        if (props.antialiasing.name === 'fxaa') {
            this._renderFxaa(camera, toDrawingBuffer, props);
        } else if (props.antialiasing.name === 'smaa') {
            if (!this.smaa.supported) {
                throw new Error('SMAA not supported, missing "HTMLImageElement"');
            }
            this._renderSmaa(camera, toDrawingBuffer, props);
        }
    }
}

