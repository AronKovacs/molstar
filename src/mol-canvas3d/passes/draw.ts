/**
 * Copyright (c) 2019-2021 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Áron Samuel Kovács <aron.kovacs@mail.muni.cz>
 */

import { WebGLContext } from '../../mol-gl/webgl/context';
import { createNullRenderTarget, RenderTarget } from '../../mol-gl/webgl/render-target';
import { Renderer } from '../../mol-gl/renderer';
import { Scene } from '../../mol-gl/scene';
import { Texture } from '../../mol-gl/webgl/texture';
import { Camera, ICamera } from '../camera';
import { QuadSchema, QuadValues } from '../../mol-gl/compute/util';
import { DefineSpec, TextureSpec, UniformSpec, Values } from '../../mol-gl/renderable/schema';
import { ComputeRenderable, createComputeRenderable } from '../../mol-gl/renderable';
import { ShaderCode } from '../../mol-gl/shader-code';
import { createComputeRenderItem } from '../../mol-gl/webgl/render-item';
import { ValueCell } from '../../mol-util';
import { Vec2 } from '../../mol-math/linear-algebra';
import { Helper } from '../helper/helper';

import { quad_vert } from '../../mol-gl/shader/quad.vert';
import { hiZ_frag } from '../../mol-gl/shader/hi-z.frag';
import { hiZCopy_frag } from '../../mol-gl/shader/hi-z-copy.frag';
import { depthMerge_frag } from '../../mol-gl/shader/depth-merge.frag';
import { copy_frag } from '../../mol-gl/shader/copy.frag';
import { StereoCamera } from '../camera/stereo';
import { WboitPass } from './wboit';
import { AntialiasingPass, PostprocessingPass, PostprocessingProps } from './postprocessing';
import { CutawayPass } from './cutaway';
import { Framebuffer } from '../../mol-gl/webgl/framebuffer';

const HiZSchema = {
    ...QuadSchema,
    tDepth: TextureSpec('texture', 'rgba', 'float', 'nearest'),
    uLevel: UniformSpec('i'),
};
type HiZRenderable = ComputeRenderable<Values<typeof HiZSchema>>

function getHiZRenderable(ctx: WebGLContext, depthTexture: Texture): HiZRenderable {
    const values: Values<typeof HiZSchema> = {
        ...QuadValues,
        tDepth: ValueCell.create(depthTexture),
        uLevel: ValueCell.create(0),
    };

    const schema = { ...HiZSchema };
    const shaderCode = ShaderCode('hi-z', quad_vert, hiZ_frag, { shaderTextureLod: 'required' });
    const renderItem = createComputeRenderItem(ctx, 'triangles', shaderCode, schema, values);

    return createComputeRenderable(renderItem, values);
}

const DepthMergeSchema = {
    ...QuadSchema,
    tDepthPrimitives: TextureSpec('texture', 'depth', 'ushort', 'nearest'),
    tDepthVolumes: TextureSpec('texture', 'depth', 'ushort', 'nearest'),
    uTexSize: UniformSpec('v2'),
    dPackedDepth: DefineSpec('boolean'),
};
const DepthMergeShaderCode = ShaderCode('depth-merge', quad_vert, depthMerge_frag);
type DepthMergeRenderable = ComputeRenderable<Values<typeof DepthMergeSchema>>

function getDepthMergeRenderable(ctx: WebGLContext, depthTexturePrimitives: Texture, depthTextureVolumes: Texture, packedDepth: boolean): DepthMergeRenderable {
    const values: Values<typeof DepthMergeSchema> = {
        ...QuadValues,
        tDepthPrimitives: ValueCell.create(depthTexturePrimitives),
        tDepthVolumes: ValueCell.create(depthTextureVolumes),
        uTexSize: ValueCell.create(Vec2.create(depthTexturePrimitives.getWidth(), depthTexturePrimitives.getHeight())),
        dPackedDepth: ValueCell.create(packedDepth),
    };

    const schema = { ...DepthMergeSchema };
    const renderItem = createComputeRenderItem(ctx, 'triangles', DepthMergeShaderCode, schema, values);

    return createComputeRenderable(renderItem, values);
}

const CopySchema = {
    ...QuadSchema,
    tColor: TextureSpec('texture', 'rgba', 'ubyte', 'nearest'),
    uTexSize: UniformSpec('v2'),
};
const  CopyShaderCode = ShaderCode('copy', quad_vert, copy_frag);
type CopyRenderable = ComputeRenderable<Values<typeof CopySchema>>

function getCopyRenderable(ctx: WebGLContext, texture: Texture): CopyRenderable {
    const values: Values<typeof CopySchema> = {
        ...QuadValues,
        tColor: ValueCell.create(texture),
        uTexSize: ValueCell.create(Vec2.create(texture.getWidth(), texture.getHeight())),
    };

    const schema = { ...CopySchema };
    const renderItem = createComputeRenderItem(ctx, 'triangles', CopyShaderCode, schema, values);

    return createComputeRenderable(renderItem, values);
}

const HiZCopySchema = {
    ...QuadSchema,
    tColor: TextureSpec('texture', 'rgba', 'ubyte', 'nearest'),
};
const  HiZCopyShaderCode = ShaderCode('hi-z-copy', quad_vert, hiZCopy_frag);
type  HiZCopyRenderable = ComputeRenderable<Values<typeof HiZCopySchema>>

function getHiZCopyRenderable(ctx: WebGLContext, texture: Texture): HiZCopyRenderable {
    const values: Values<typeof HiZCopySchema> = {
        ...QuadValues,
        tColor: ValueCell.create(texture),
    };

    const schema = { ...HiZCopySchema };
    const renderItem = createComputeRenderItem(ctx, 'triangles', HiZCopyShaderCode, schema, values);

    return createComputeRenderable(renderItem, values);
}

export class DrawPass {
    private readonly drawTarget: RenderTarget

    readonly colorTarget: RenderTarget
    readonly depthTexture: Texture
    readonly depthTexturePrimitives: Texture

    readonly packedDepth: boolean

    private depthTarget: RenderTarget
    private depthTargetPrimitives: RenderTarget | null
    private depthTargetVolumes: RenderTarget | null
    private depthTextureVolumes: Texture
    private depthMerge: DepthMergeRenderable

    private hiZProxyTarget: RenderTarget
    private hiZRenderable: HiZRenderable
    private hiZFramebuffers: Framebuffer[]
    private hiZCopyMipLevel: HiZCopyRenderable

    private readonly depthPreCutawayTarget: RenderTarget

    private copyFboTarget: CopyRenderable
    private copyFboPostprocessing: CopyRenderable

    private wboit: WboitPass | undefined
    readonly postprocessing: PostprocessingPass
    private readonly antialiasing: AntialiasingPass

    get wboitEnabled() {
        return !!this.wboit?.supported;
    }

    constructor(private webgl: WebGLContext, width: number, height: number, enableWboit: boolean, private readonly cutaway: CutawayPass) {
        const { extensions, resources, isWebGL2 } = webgl;

        this.drawTarget = createNullRenderTarget(webgl.gl);

        this.colorTarget = webgl.createRenderTarget(width, height, true, 'uint8', 'linear');
        this.packedDepth = !extensions.depthTexture;

        this.depthTarget = webgl.createRenderTarget(width, height);
        this.depthTexture = this.depthTarget.texture;

        this.depthTexture.bind(0);
        this.webgl.gl.generateMipmap(this.webgl.gl.TEXTURE_2D);
        this.webgl.gl.texParameteri(this.webgl.gl.TEXTURE_2D, this.webgl.gl.TEXTURE_MIN_FILTER, this.webgl.gl.NEAREST_MIPMAP_NEAREST);
        this.depthTexture.unbind(0);

        this.depthTargetPrimitives = this.packedDepth ? webgl.createRenderTarget(width, height) : null;
        this.depthTargetVolumes = this.packedDepth ? webgl.createRenderTarget(width, height) : null;

        this.depthTexturePrimitives = this.depthTargetPrimitives ? this.depthTargetPrimitives.texture : resources.texture('image-depth', 'depth', isWebGL2 ? 'float' : 'ushort', 'nearest');
        this.depthTextureVolumes = this.depthTargetVolumes ? this.depthTargetVolumes.texture : resources.texture('image-depth', 'depth', isWebGL2 ? 'float' : 'ushort', 'nearest');
        if (!this.packedDepth) {
            this.depthTexturePrimitives.define(width, height);
            this.depthTextureVolumes.define(width, height);
        }
        this.depthMerge = getDepthMergeRenderable(webgl, this.depthTexturePrimitives, this.depthTextureVolumes, this.packedDepth);

        this.hiZProxyTarget = webgl.createRenderTarget(Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2)));
        this.hiZRenderable = getHiZRenderable(webgl, this.depthTexture);
        this.hiZCopyMipLevel = getHiZCopyRenderable(webgl, this.hiZProxyTarget.texture);
        this.hiZFramebuffers = [];
        this._createHiZFramebuffers();

        this.depthPreCutawayTarget = webgl.createRenderTarget(width, height, true);

        this.wboit = enableWboit ? new WboitPass(webgl, width, height) : undefined;
        this.postprocessing = new PostprocessingPass(webgl, this);
        this.antialiasing = new AntialiasingPass(webgl, this);

        this.copyFboTarget = getCopyRenderable(webgl, this.colorTarget.texture);
        this.copyFboPostprocessing = getCopyRenderable(webgl, this.postprocessing.target.texture);
    }

    reset() {
        this.wboit?.reset();
    }

    setSize(width: number, height: number) {
        const w = this.colorTarget.getWidth();
        const h = this.colorTarget.getHeight();

        if (width !== w || height !== h) {
            this.colorTarget.setSize(width, height);

            this.depthTarget.setSize(width, height);

            this.depthTexture.bind(0);
            this.webgl.gl.generateMipmap(this.webgl.gl.TEXTURE_2D);
            this.depthTexture.unbind(0);

            this._createHiZFramebuffers();

            this.hiZProxyTarget.setSize(Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2)));

            this.depthPreCutawayTarget.setSize(width, height);

            if (this.depthTargetPrimitives) {
                this.depthTargetPrimitives.setSize(width, height);
            } else {
                this.depthTexturePrimitives.define(width, height);
            }

            if (this.depthTargetVolumes) {
                this.depthTargetVolumes.setSize(width, height);
            } else {
                this.depthTextureVolumes.define(width, height);
            }

            ValueCell.update(this.depthMerge.values.uTexSize, Vec2.set(this.depthMerge.values.uTexSize.ref.value, width, height));

            ValueCell.update(this.copyFboTarget.values.uTexSize, Vec2.set(this.copyFboTarget.values.uTexSize.ref.value, width, height));
            ValueCell.update(this.copyFboPostprocessing.values.uTexSize, Vec2.set(this.copyFboPostprocessing.values.uTexSize.ref.value, width, height));

            if (this.wboit?.supported) {
                this.wboit.setSize(width, height);
            }

            this.cutaway.setSize(width, height);
            this.postprocessing.setSize(width, height);
            this.antialiasing.setSize(width, height);
        }
    }

    private _createHiZFramebuffers() {
        for (let i = 0; i < this.hiZFramebuffers.length; i++) {
            this.hiZFramebuffers[i].destroy();
        }
        this.hiZFramebuffers = [];

        let maxDimension = Math.max(this.depthTexture.getWidth(), this.depthTexture.getHeight());
        let level = 1;
        while (maxDimension > 0) {
            let framebuffer = this.webgl.resources.framebuffer();
            this.depthTexture.attachFramebuffer(framebuffer, 'color0', undefined, level);
            this.hiZFramebuffers.push(framebuffer);
            maxDimension = Math.floor(maxDimension / 2);
            level += 1;
        }
    }

    private _depthMerge() {
        const { state, gl } = this.webgl;

        this.depthMerge.update();
        this.depthTarget.bind();
        state.disable(gl.BLEND);
        state.disable(gl.DEPTH_TEST);
        state.disable(gl.CULL_FACE);
        state.depthMask(false);
        state.clearColor(1, 1, 1, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        this.depthMerge.render();
    }

    // assumes that memory for mips is already allocated
    private _hierarchicalZ(camera: ICamera): boolean {
        if (!this.webgl.isWebGL2) {
            return false;
        }
        let { x, y, width, height } = camera.viewport;

        let numLevels = 1 + Math.floor(Math.log2(Math.max(width, height)));
        for (let level = 1; level < numLevels; level++) {
            ValueCell.update(this.hiZRenderable.values.uLevel, level - 1);

            x = Math.max(camera.viewport.x > 0 ? 1 : 0, Math.floor(x / 2));
            y = Math.max(camera.viewport.y > 0 ? 1 : 0, Math.floor(y / 2));
            width = Math.max(1, Math.floor(width / 2));
            height = Math.max(1, Math.floor(height / 2));
            this.webgl.gl.viewport(x, y, width, height);
            this.webgl.gl.scissor(x, y, width, height);

            // create the next mip level and write it to the proxy texture
            this.hiZProxyTarget.bind();
            this.hiZRenderable.render();

            // copy from the proxy texture to the current mip level
            this.hiZFramebuffers[level - 1].bind();
            this.hiZCopyMipLevel.render();

        }
        return true;
    }

    private _renderWboit(renderer: Renderer, camera: ICamera, scene: Scene, transparentBackground: boolean, postprocessingProps: PostprocessingProps) {
        if (!this.wboit?.supported) throw new Error('expected wboit to be supported');

        this.colorTarget.bind();
        renderer.clear(true);

        // render pre-cutaway depths
        let cutawayData;
        if (CutawayPass.supported && CutawayPass.shouldRun(scene)) {
            this.depthPreCutawayTarget.bind();
            this.webgl.state.enable(this.webgl.gl.SCISSOR_TEST);
            this.webgl.state.enable(this.webgl.gl.DEPTH_TEST);
            this.webgl.state.colorMask(true, true, true, true);
            this.webgl.state.depthMask(true);
            this.webgl.state.clearColor(1, 1, 1, 1);
            this.webgl.gl.clear(this.webgl.gl.COLOR_BUFFER_BIT | this.webgl.gl.DEPTH_BUFFER_BIT);
            renderer.renderDepth(scene.primitives, camera, null, null);

            cutawayData = { depthPreCutawayTexture: this.depthPreCutawayTarget.texture, depthCutawayTexture: this.cutaway.target };
        } else {
            cutawayData = null;
        }

        let primitivesCutawaySeed: Scene.Group | null = null;
        if (cutawayData !== null) {
            let primitives = scene.primitives.renderables.concat();
            let renderables = primitives.filter(r => r.values.cutaway.ref.value);
            primitivesCutawaySeed = {
                renderables: renderables,
                direction: scene.primitives.direction,
                position: scene.primitives.position,
                up: scene.primitives.up,
                view: scene.primitives.view
            };
        }

        let primitivesAffectedByCutaway: Scene.Group | null = null;
        if (cutawayData !== null) {
            let primitives = scene.primitives.renderables.concat();
            let renderables = primitives.filter(r => !r.values.cutaway.ref.value);
            primitivesAffectedByCutaway = {
                renderables: renderables,
                direction: scene.primitives.direction,
                position: scene.primitives.position,
                up: scene.primitives.up,
                view: scene.primitives.view
            };
        }

        // render opaque primitives
        this.depthTexturePrimitives.attachFramebuffer(this.colorTarget.framebuffer, 'depth');
        this.colorTarget.bind();
        renderer.clearDepth();
        if (cutawayData != null) {
            renderer.renderWboitOpaque(primitivesCutawaySeed!, camera, null, null);
            renderer.renderWboitOpaque(primitivesAffectedByCutaway!, camera, null, cutawayData);
        } else {
            renderer.renderWboitOpaque(scene.primitives, camera, null, null);
        }

        // render opaque volumes
        this.depthTextureVolumes.attachFramebuffer(this.colorTarget.framebuffer, 'depth');
        this.colorTarget.bind();
        renderer.clearDepth();
        renderer.renderWboitOpaque(scene.volumes, camera, this.depthTexturePrimitives, null);

        // merge depth of opaque primitives and volumes
        this._depthMerge();

        let depthTexture = this.depthTexture;
        if (PostprocessingPass.isEnabled(postprocessingProps)) {
            if (postprocessingProps.occlusion.name === 'on') {
                this._hierarchicalZ(camera);
            }
            this.postprocessing.render(camera, scene, false, transparentBackground, renderer.props.backgroundColor, postprocessingProps);
            depthTexture = this.postprocessing.getDepthTarget(postprocessingProps);
        }

        // render transparent primitives and volumes
        this.wboit.bind();
        if (cutawayData !== null) {
            renderer.renderWboitTransparent(primitivesCutawaySeed!, camera, depthTexture, null);
            renderer.renderWboitTransparent(primitivesAffectedByCutaway!, camera, depthTexture, cutawayData);
        } else {
            renderer.renderWboitTransparent(scene.primitives, camera, depthTexture, cutawayData);
        }
        renderer.renderWboitTransparent(scene.volumes, camera, depthTexture, null);

        // evaluate wboit
        if (PostprocessingPass.isEnabled(postprocessingProps)) {
            this.depthTexturePrimitives.attachFramebuffer(this.postprocessing.target.framebuffer, 'depth');
            this.postprocessing.target.bind();
        } else {
            this.depthTexturePrimitives.attachFramebuffer(this.colorTarget.framebuffer, 'depth');
            this.colorTarget.bind();
        }
        this.wboit.render();
    }

    private _renderBlended(renderer: Renderer, camera: ICamera, scene: Scene, toDrawingBuffer: boolean, transparentBackground: boolean, postprocessingProps: PostprocessingProps) {
        if (toDrawingBuffer) {
            this.drawTarget.bind();
        } else {
            this.colorTarget.bind();
            if (!this.packedDepth) {
                this.depthTexturePrimitives.attachFramebuffer(this.colorTarget.framebuffer, 'depth');
            }
        }

        renderer.clear(true);
        renderer.renderBlendedOpaque(scene.primitives, camera, null, null);

        if (!toDrawingBuffer) {
            // do a depth pass if not rendering to drawing buffer and
            // extensions.depthTexture is unsupported (i.e. depthTarget is set)
            if (this.depthTargetPrimitives) {
                this.depthTargetPrimitives.bind();
                renderer.clear(false);
                // TODO: this should only render opaque
                renderer.renderDepth(scene.primitives, camera, null, null);
                this.colorTarget.bind();
            }

            // do direct-volume rendering
            if (!this.packedDepth) {
                this.depthTextureVolumes.attachFramebuffer(this.colorTarget.framebuffer, 'depth');
                renderer.clearDepth(); // from previous frame
            }
            renderer.renderBlendedVolumeOpaque(scene.volumes, camera, this.depthTexturePrimitives, null);

            // do volume depth pass if extensions.depthTexture is unsupported (i.e. depthTarget is set)
            if (this.depthTargetVolumes) {
                this.depthTargetVolumes.bind();
                renderer.clear(false);
                renderer.renderDepth(scene.volumes, camera, this.depthTexturePrimitives, null);
                this.colorTarget.bind();
            }

            // merge depths from primitive and volume rendering
            this._depthMerge();
            this.colorTarget.bind();

            if (PostprocessingPass.isEnabled(postprocessingProps)) {
                if (postprocessingProps.occlusion.name === 'on') {
                    this._hierarchicalZ(camera);
                }
                this.postprocessing.render(camera, scene, false, transparentBackground, renderer.props.backgroundColor, postprocessingProps);
            }
            renderer.renderBlendedVolumeTransparent(scene.volumes, camera, this.depthTexturePrimitives, null);

            const target = PostprocessingPass.isEnabled(postprocessingProps)
                ? this.postprocessing.target : this.colorTarget;
            if (!this.packedDepth) {
                this.depthTexturePrimitives.attachFramebuffer(target.framebuffer, 'depth');
            }
            target.bind();
        }

        renderer.renderBlendedTransparent(scene.primitives, camera, null, null);
    }

    private _render(renderer: Renderer, camera: ICamera, scene: Scene, helper: Helper, toDrawingBuffer: boolean, transparentBackground: boolean, postprocessingProps: PostprocessingProps) {
        const volumeRendering = scene.volumes.renderables.length > 0;
        const postprocessingEnabled = PostprocessingPass.isEnabled(postprocessingProps);
        const antialiasingEnabled = AntialiasingPass.isEnabled(postprocessingProps);

        const { x, y, width, height } = camera.viewport;
        renderer.setViewport(x, y, width, height);
        renderer.update(camera);

        if (this.wboitEnabled) {
            this._renderWboit(renderer, camera, scene, transparentBackground, postprocessingProps);
        } else {
            this._renderBlended(renderer, camera, scene, !volumeRendering && !postprocessingEnabled && !antialiasingEnabled && toDrawingBuffer, transparentBackground, postprocessingProps);
        }

        if (PostprocessingPass.isEnabled(postprocessingProps)) {
            this.postprocessing.target.bind();
        } else if (!toDrawingBuffer || volumeRendering || this.wboitEnabled) {
            this.colorTarget.bind();
        } else {
            this.drawTarget.bind();
        }

        if (helper.debug.isEnabled) {
            helper.debug.syncVisibility();
            renderer.renderBlended(helper.debug.scene, camera, null, null);
        }
        if (helper.handle.isEnabled) {
            renderer.renderBlended(helper.handle.scene, camera, null, null);
        }
        if (helper.camera.isEnabled) {
            helper.camera.update(camera);
            renderer.update(helper.camera.camera);
            renderer.renderBlended(helper.camera.scene, helper.camera.camera, null, null);
        }

        if (antialiasingEnabled) {
            this.antialiasing.render(camera, toDrawingBuffer, postprocessingProps);
        } else if (toDrawingBuffer) {
            this.drawTarget.bind();

            this.webgl.state.disable(this.webgl.gl.DEPTH_TEST);
            if (PostprocessingPass.isEnabled(postprocessingProps)) {
                this.copyFboPostprocessing.render();
            } else if (volumeRendering || this.wboitEnabled) {
                this.copyFboTarget.render();
            }
        }

        this.webgl.gl.flush();
    }

    render(renderer: Renderer, camera: Camera | StereoCamera, scene: Scene, helper: Helper, toDrawingBuffer: boolean, transparentBackground: boolean, postprocessingProps: PostprocessingProps) {
        renderer.setTransparentBackground(transparentBackground);
        renderer.setDrawingBufferSize(this.colorTarget.getWidth(), this.colorTarget.getHeight());

        if (StereoCamera.is(camera)) {
            this._render(renderer, camera.left, scene, helper, toDrawingBuffer, transparentBackground, postprocessingProps);
            this._render(renderer, camera.right, scene, helper, toDrawingBuffer, transparentBackground, postprocessingProps);
        } else {
            this._render(renderer, camera, scene, helper, toDrawingBuffer, transparentBackground, postprocessingProps);
        }
    }

    getColorTarget(postprocessingProps: PostprocessingProps): RenderTarget {
        if (AntialiasingPass.isEnabled(postprocessingProps)) {
            return this.antialiasing.target;
        } else if (PostprocessingPass.isEnabled(postprocessingProps)) {
            return this.postprocessing.target;
        }
        return this.colorTarget;
    }
}