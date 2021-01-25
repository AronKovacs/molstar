/**
 * Copyright (c) 2019-2020 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Áron Samuel Kovács <aron.kovacs@mail.muni.cz>
 */

import { QuadSchema, QuadValues } from '../../mol-gl/compute/util';
import { TextureSpec, UniformSpec, Values } from '../../mol-gl/renderable/schema';
import { ShaderCode } from '../../mol-gl/shader-code';
import { WebGLContext } from '../../mol-gl/webgl/context';
import { createComputeRenderItem } from '../../mol-gl/webgl/render-item';
import { createComputeRenderable, ComputeRenderable } from '../../mol-gl/renderable';
import { Texture } from '../../mol-gl/webgl/texture';
import { Vec2 } from '../../mol-math/linear-algebra';
import { ValueCell } from '../../mol-util';
import quad_vert from '../../mol-gl/shader/quad.vert';
import cutaways_jfa_step_frag from '../../mol-gl/shader/cutaways-jfa-step.frag';
import cutaways_init_frag from '../../mol-gl/shader/cutaways-init.frag';
import { RenderTarget } from '../../mol-gl/webgl/render-target';
import { DrawPass } from './draw';

const CutawaysInitSchema = {
    ...QuadSchema,
    tDepth: TextureSpec('texture', 'rgba', 'ubyte', 'nearest'),
    uTexSize: UniformSpec('v2'),
};
type CutawaysInitRenderable = ComputeRenderable<Values<typeof CutawaysInitSchema>>

function getCutawaysInitRenderable(ctx: WebGLContext, depthTexture: Texture): CutawaysInitRenderable {
    const values: Values<typeof CutawaysInitSchema> = {
        ...QuadValues,
        tDepth: ValueCell.create(depthTexture),
        uTexSize: ValueCell.create(Vec2.create(depthTexture.getWidth(), depthTexture.getHeight())),
    };

    const schema = { ...CutawaysInitSchema };
    const shaderCode = ShaderCode('cutaways-init', quad_vert, cutaways_init_frag);
    const renderItem = createComputeRenderItem(ctx, 'triangles', shaderCode, schema, values);

    return createComputeRenderable(renderItem, values);
}

const CutawaysJfaSchema = {
    ...QuadSchema,
    tCutaways: TextureSpec('texture', 'rgba', 'float', 'nearest'),
    uTexSize: UniformSpec('v2'),
    uStep: UniformSpec('v2'),
};
type CutawaysJfaRenderable = ComputeRenderable<Values<typeof CutawaysJfaSchema>>

function getCutawaysJfaRenderable(ctx: WebGLContext, cutawaysTexture: Texture): CutawaysJfaRenderable {
    const values: Values<typeof CutawaysJfaSchema> = {
        ...QuadValues,
        tCutaways: ValueCell.create(cutawaysTexture),
        uTexSize: ValueCell.create(Vec2.create(cutawaysTexture.getWidth(), cutawaysTexture.getHeight())),
        uStep: ValueCell.create(Vec2.create(0, 0)),
    };

    const schema = { ...CutawaysJfaSchema };
    const shaderCode = ShaderCode('cutaways-jfa', quad_vert, cutaways_jfa_step_frag);
    const renderItem = createComputeRenderItem(ctx, 'triangles', shaderCode, schema, values);

    return createComputeRenderable(renderItem, values);
}

export class CutawaysPass {
    private readonly initRenderable: CutawaysInitRenderable

    private readonly jfaATarget: RenderTarget
    private readonly jfaBTarget: RenderTarget
    private readonly jfaARenderable: CutawaysJfaRenderable
    private readonly jfaBRenderable: CutawaysJfaRenderable

    constructor(private webgl: WebGLContext, depthTexture: Texture) {
        const width = depthTexture.getWidth();
        const height = depthTexture.getHeight();

        this.jfaATarget = webgl.createRenderTarget(width, height, false, 'float32', 'nearest');
        this.jfaBTarget = webgl.createRenderTarget(width, height, false, 'float32', 'nearest');

        this.jfaARenderable = getCutawaysJfaRenderable(webgl, this.jfaATarget.texture);
        this.jfaBRenderable = getCutawaysJfaRenderable(webgl, this.jfaBTarget.texture);
    }

    render(): Texture {
        return this.jfaATarget.texture;
    }

    setSize(width: number, height: number) {
        const [w, h] = this.jfaARenderable.values.uTexSize.ref.value;
        if (width !== w || height !== h) {
            this.jfaATarget.setSize(width, height);
            this.jfaBTarget.setSize(width, height);

            ValueCell.update(this.jfaARenderable.values.uTexSize, Vec2.set(this.jfaARenderable.values.uTexSize.ref.value, width, height));
            ValueCell.update(this.jfaBRenderable.values.uTexSize, Vec2.set(this.jfaBRenderable.values.uTexSize.ref.value, width, height));
        }
    }
}