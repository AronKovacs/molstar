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
uniform sampler2D tOutlines;
uniform vec2 uTexSize;

uniform vec2 uStep;
uniform float uOutlineViewRadius;

#include common

float atan2(float y, float x) {
    return x == 0.0 ? sign(y) * PI / 2.0 : atan(y, x);
}

void getSamplingDxsDys(float angle, inout vec2 result[3]) {
    angle = (angle / PI) * 180.0 + 180.0;
    if (angle < 22.5 || angle > 337.5) {
        result[0] = vec2(1.0, -1.0);
        result[1] = vec2(1.0, 0.0);
        result[2] = vec2(1.0, 1.0);
    } else if (angle < 67.5) {
        result[0] = vec2(1.0, 0.0);
        result[1] = vec2(1.0, 1.0);
        result[2] = vec2(0.0, 1.0);
    } else if (angle < 112.5) {
        result[0] = vec2(1.0, 1.0);
        result[1] = vec2(0.0, 1.0);
        result[2] = vec2(-1.0, 1.0);
    } else if (angle < 157.5) {
        result[0] = vec2(0.0, 1.0);
        result[1] = vec2(-1.0, 1.0);
        result[2] = vec2(-1.0, 0.0);
    } else if (angle < 202.5) {
        result[0] = vec2(-1.0, 1.0);
        result[1] = vec2(-1.0, 0.0);
        result[2] = vec2(-1.0, -1.0);
    } else if (angle < 247.5) {
        result[0] = vec2(-1.0, 0.0);
        result[1] = vec2(-1.0, -1.0);
        result[2] = vec2(0.0, -1.0);
    } else if (angle < 292.5) {
        result[0] = vec2(-1.0, -1.0);
        result[1] = vec2(0.0, -1.0);
        result[2] = vec2(1.0, -1.0);
    } else /* if (angle < 337.5) */ {
        result[0] = vec2(0.0, -1.0);
        result[1] = vec2(1.0, -1.0);
        result[2] = vec2(1.0, 0.0);
    }
}

bool isInnerOutline(vec2 selfCoords, vec2 sampleCoords) {
    vec2 dir = sampleCoords - selfCoords;
    float angle = atan2(dir.y, dir.x);
    vec2 sampleDxsDys[3];
    getSamplingDxsDys(angle, sampleDxsDys);
    return texture(tOutlines, sampleCoords + sampleDxsDys[0] / uTexSize).w < 0.0 ||
           texture(tOutlines, sampleCoords + sampleDxsDys[1] / uTexSize).w < 0.0 ||
           texture(tOutlines, sampleCoords + sampleDxsDys[2] / uTexSize).w < 0.0;
}

float outlineViewWidth(vec2 coordDiff) {
    coordDiff = normalize(coordDiff);
    float m = max(abs(coordDiff.x), abs(coordDiff.y));
    coordDiff /= m;
    return length(coordDiff) * uOutlineViewRadius;
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
            vec2 sampleValueScreenCoords = sampleValue.xy;
            if (sampleValueScreenCoords.x < 0.0) {
                continue;                
            }

            vec2 coordDiff = (selfCoords.xy - sampleValueScreenCoords) * uTexSize;
            float pixelDist = length(coordDiff);
            if (pixelDist <= 3.6) {
                float innerOutlineCorrection = isInnerOutline(selfCoords, sampleValueScreenCoords) ? 0.5 : 0.0;
                pixelDist += innerOutlineCorrection;
            }

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