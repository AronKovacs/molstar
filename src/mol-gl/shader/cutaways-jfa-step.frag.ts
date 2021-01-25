/**
 * Copyright (c) 2019-2020 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Áron Samuel Kovács <aron.kovacs@mail.muni.cz>
 */

export default `
precision highp float;
precision highp int;
precision highp sampler2D;

// x: seed x coord
// y: seed y coord
// z: seed z coord
// w: seed outline radius
uniform sampler2D tCutaways;
uniform vec2 uTexSize;

uniform vec2 uStep;

#include common

float atan2(float y, float x) {
    return x == 0.0 ? sign(y) * PI / 2.0 : atan(y, x);
}

void main(void) {
    vec2 selfCoords = gl_FragCoord.xy / uTexSize;
    vec4 result = texture(tOutlines, selfCoords);
    float innerOutline = sign(result.w);

    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            if (dx == 0 && dy == 0) {
                continue;
            }

            vec2 sampleCoords = selfCoords + vec2(float(dx), float(dy)) * uStep;
            if (sampleCoords.x < 0.0 || sampleCoords.x > 1.0 || sampleCoords.y < 0.0 || sampleCoords.y > 1.0) {
                continue;
            }

            vec4 sampleValue = texture2D(tOutlines, sampleCoords);
            if (sampleValue.x < 0.0) {
                continue;                
            }

            float innerOutlineCorrection = isInnerOutline(selfCoords, sampleValue.xy) ? 0.5 : 0.0;

            vec2 coordDiff = (selfCoords.xy - sampleValue.xy) * uTexSize;
            float pixelDist = length(coordDiff) + innerOutlineCorrection;
            if (sampleValue.z < result.z && pixelDist * abs(sampleValue.w) <= uOutlineViewRadius) {
                result = sampleValue;
            }
        }
    }

    if (sign(result.w) != innerOutline) {
        result.w *= -1.0;
    }
    gl_FragColor = result;
}
`;