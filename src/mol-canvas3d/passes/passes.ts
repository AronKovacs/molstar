/**
 * Copyright (c) 2020 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { DrawPass } from './draw';
import { PickPass } from './pick';
import { MultiSamplePass } from './multi-sample';
import { WebGLContext } from '../../mol-gl/webgl/context';
import { CutawayPass } from './cutaway';

export class Passes {
    readonly cutaway: CutawayPass
    readonly draw: DrawPass
    readonly pick: PickPass
    readonly multiSample: MultiSamplePass

    constructor(private webgl: WebGLContext, attribs: Partial<{ pickScale: number, enableWboit: boolean }> = {}) {
        const { gl } = webgl;
        this.cutaway = new CutawayPass(webgl, gl.drawingBufferWidth, gl.drawingBufferHeight);
        this.draw = new DrawPass(webgl, gl.drawingBufferWidth, gl.drawingBufferHeight, attribs.enableWboit || false, this.cutaway);
        this.pick = new PickPass(webgl, this.draw, attribs.pickScale || 0.25, this.cutaway);
        this.multiSample = new MultiSamplePass(webgl, this.draw, this.cutaway);
    }

    updateSize() {
        const { gl } = this.webgl;
        this.draw.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);
        this.cutaway.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);
        this.pick.syncSize();
        this.multiSample.syncSize();
    }
}