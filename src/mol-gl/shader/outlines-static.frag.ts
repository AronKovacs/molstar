/**
 * Copyright (c) 2019-2020 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Áron Samuel Kovács <aron.kovacs@mail.muni.cz>
 */

export const outlinesStatic_frag = `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D tOutlines;
uniform sampler2D tDepth;
uniform vec2 uTexSize;

uniform float uNear;
uniform float uFar;
uniform float uMaxPossibleViewZDiff;

#include common

float getViewZ(const in float depth) {
    #if dOrthographic == 1
        return orthographicDepthToViewZ(depth, uNear, uFar);
    #else
        return perspectiveDepthToViewZ(depth, uNear, uFar);
    #endif
}

bool isBackground(const in float depth) {
    return depth > 0.99;
}

void main(void) {
    vec2 coords = gl_FragCoord.xy / uTexSize;

    float backgroundViewZ = uFar + 3.0 * uMaxPossibleViewZDiff;
    vec2 invTexSize = 1.0 / uTexSize;

    float selfDepth = unpackRGBAToDepth(texture2D(tDepth, coords));
    float selfViewZ = isBackground(selfDepth) ? backgroundViewZ : getViewZ(selfDepth);

    float outlineDepth = 1.0;
    for (int y = -dOutlineScale / 2 - 1; y <= dOutlineScale / 2; y++) {
        for (int x = -dOutlineScale / 2 - 1; x <= dOutlineScale / 2; x++) {
            if (x * x + y * y > dOutlineScale * dOutlineScale) {
                continue;
            }

            vec2 sampleCoords = coords + vec2(float(x), float(y)) * invTexSize;

            vec4 sampleOutlineCombined = texture2D(tOutlines, sampleCoords);
            float sampleOutline = sampleOutlineCombined.r;
            float sampleOutlineDepth = unpackRGToUnitInterval(sampleOutlineCombined.gb);

            if (sampleOutline == 0.0 && sampleOutlineDepth < outlineDepth && abs(selfViewZ - sampleOutlineDepth) > uMaxPossibleViewZDiff) {
                outlineDepth = sampleOutlineDepth;
            }
        }
    }

    gl_FragColor = packDepthToRGBA(outlineDepth);
}
`;