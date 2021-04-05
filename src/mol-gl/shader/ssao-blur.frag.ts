/**
 * Copyright (c) 2019-2020 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Áron Samuel Kovács <aron.kovacs@mail.muni.cz>
 */

export default `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D tSsaoDepth;
uniform vec2 uTexSize;

// needed for stereo camera
// x, y, width, height, all <0, 1>
uniform vec4 uViewport;

uniform float uKernel[dOcclusionKernelSize];

uniform float uBlurDirectionX;
uniform float uBlurDirectionY;

uniform float uMaxPossibleViewZDiff;

uniform float uNear;
uniform float uFar;

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

    vec2 packedDepth = texture2D(tSsaoDepth, coords).zw;

    float selfDepth = unpackRGToUnitInterval(packedDepth);
    // if background and if second pass
    if (isBackground(selfDepth) && uBlurDirectionY != 0.0) {
       gl_FragColor = vec4(packUnitIntervalToRG(1.0), packedDepth);
       return;
    }

    float selfViewZ = getViewZ(selfDepth);

    vec2 offset = vec2(uBlurDirectionX, uBlurDirectionY) / uTexSize;

    float sum = 0.0;
    float kernelSum = 0.0;
    // only if kernelSize is odd
    for (int i = -dOcclusionKernelSize / 2; i <= dOcclusionKernelSize / 2; i++) {
        vec2 sampleCoords = coords + float(i) * offset;

        if (sampleCoords.x < uViewport.x ||
            sampleCoords.x > uViewport.x + uViewport.z ||
            sampleCoords.y < uViewport.y ||
            sampleCoords.y > uViewport.y + uViewport.w) {
            continue;
        }

        vec4 sampleSsaoDepth = texture2D(tSsaoDepth, sampleCoords);

        float sampleDepth = unpackRGToUnitInterval(sampleSsaoDepth.zw);
        if (isBackground(sampleDepth)) {
            continue;
        }

        if (abs(float(i)) > 1.0) { // abs is not defined for int in webgl1
            float sampleViewZ = getViewZ(sampleDepth);
            if (abs(selfViewZ - sampleViewZ) > uMaxPossibleViewZDiff) {
                continue;
            }
        }

        float kernel = uKernel[int(abs(float(i)))]; // abs is not defined for int in webgl1
        float sampleValue = unpackRGToUnitInterval(sampleSsaoDepth.xy);

        sum += kernel * sampleValue;
        kernelSum += kernel;
    }

    gl_FragColor = vec4(packUnitIntervalToRG(sum / kernelSum), packedDepth);
}
`;