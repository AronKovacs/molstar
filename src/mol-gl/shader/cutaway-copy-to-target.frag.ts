/**
 * Copyright (c) 2019-2020 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Áron Samuel Kovács <aron.kovacs@mail.muni.cz>
 */

export const cutawayCopyToTarget_frag = `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D tDepth;
uniform vec2 uTexSize;

uniform float uIsOrtho;
uniform float uNear;
uniform float uFar;

#include common

void main(void) {
    vec2 coords = gl_FragCoord.xy / uTexSize;

    vec4 jfaValue = texture(tDepth, coords);

    vec4 result;

    if (jfaValue.x < 0.0) {
        result = packDepthToRGBA(1.0);
    } else {
        float viewZ = uNear + (jfaValue.w * (uFar - uNear));
        float depth = viewZToDepth(uIsOrtho, viewZ, uNear, uFar);
        result = packDepthToRGBA(clamp(depth, 0.0, 1.0));
    }

    gl_FragColor = result;
}
`;