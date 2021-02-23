/**
 * Copyright (c) 2019-2020 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Áron Samuel Kovács <aron.kovacs@mail.muni.cz>
 */

export default `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D tDepth;
uniform vec2 uTexSize;

uniform float uIsOrtho;
uniform float uNear;
uniform float uFar;

#include common

bool isBackground(float z) {
    return z >= 0.99;
}

void main(void) {
    vec2 coords = gl_FragCoord.xy / uTexSize;

    float depth = unpackRGBAToDepth(texture(tDepth, coords));
    float viewZ = depthToViewZ(uIsOrtho, depth, uNear, uFar);
    float linearZ = (viewZ - uNear) / (uFar - uNear);

    if (isBackground(depth)) {
        gl_FragColor = vec4(-10000.0, -10000.0, -10000.0, -10000.0);
    } else {
        gl_FragColor = vec4(coords, linearZ, linearZ);
    }
}
`;