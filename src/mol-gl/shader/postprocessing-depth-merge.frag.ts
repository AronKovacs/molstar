/**
 * Copyright (c) 2019-2020 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Áron Samuel Kovács <aron.kovacs@mail.muni.cz>
 */

export const postprocessingDepthMerge_frag = `
precision highp float;
precision highp sampler2D;

uniform sampler2D tDepth;
uniform sampler2D tOutlines;
uniform vec2 uTexSize;

#include common

void main() {
    vec2 coords = gl_FragCoord.xy / uTexSize;
    
    float depth = unpackRGBAToDepth(texture2D(tDepth, coords));
    
    #if dOutlineDynamicWidth == 1
        float depthOutlines = texture2D(tOutlines, coords).z;
    #else
        float depthOutlines = unpackRGBAToDepth(texture2D(tOutlines, coords));
    #endif

    gl_FragColor = packDepthToRGBA(min(depth, depthOutlines));
}
`;