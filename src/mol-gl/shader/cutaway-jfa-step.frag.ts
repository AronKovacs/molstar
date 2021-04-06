/**
 * Copyright (c) 2019-2020 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Áron Samuel Kovács <aron.kovacs@mail.muni.cz>
 */

export const cutawayJfaStep_frag = `
precision highp float;
precision highp int;
precision highp sampler2D;

// x: seed x coord, <0, 1>
// y: seed y coord, <0, 1>
// z: seed linear z coord, <0, 1>
// w: self linear z coord, <0, 1>
// if x (or y or z or w) is less than 0 then that pixel is 'empty'
uniform sampler2D tCutaway;
uniform vec2 uTexSize;

// needed for stereo camera
// x, y, width, height, all <0, 1>
uniform vec4 uViewport;

uniform vec2 uStep;

uniform float uPMsz;
uniform float uAngle;
uniform float uEdgeRegionSize;

uniform vec2 uAspectRatio;

uniform float uNear;
uniform float uFar;

#include common

float slope(float tanAngle, float linearZ) {
    return (uPMsz + linearZ) / tanAngle;
}

vec2 normalizedDistanceFromEdges(vec2 coords) {
    return min(coords - uViewport.xy, uViewport.xy + uViewport.zw - coords) / uViewport.zw;
}

float angleEdgeCompression(vec2 coords) {
    if (uEdgeRegionSize == 0.0) {
        return uAngle;
    }
    vec2 terms = clamp(normalizedDistanceFromEdges(coords) / uEdgeRegionSize, 0.0, 1.0);
    return uAngle * terms.x * terms.y;
}

void main(void) {
    vec2 selfCoords = gl_FragCoord.xy / uTexSize;

    float angle = angleEdgeCompression(selfCoords);
    float tanAngle = tan(angle);

    vec4 result = texture(tCutaway, selfCoords);
    
    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            if (dx == 0 && dy == 0) {
                continue;
            }

            vec2 sampleCoords = selfCoords + vec2(float(dx), float(dy)) * uStep;
            if (sampleCoords.x < uViewport.x ||
                sampleCoords.x > uViewport.x + uViewport.z ||
                sampleCoords.y < uViewport.y ||
                sampleCoords.y > uViewport.y + uViewport.w) {
                continue;
            }

            vec4 sampleValue = texture2D(tCutaway, sampleCoords);
            if (sampleValue.x < 0.0) {
                continue;                
            }

            vec2 coordDiff = (selfCoords.xy - sampleValue.xy) * uAspectRatio;
            float dist = length(coordDiff);
            
            float cutawayLinearZ = sampleValue.z - dist * slope(tanAngle, sampleValue.z);

            if (result.x < 0.0 || result.w > cutawayLinearZ) {
                result = vec4(sampleValue.xyz, cutawayLinearZ);
            }
        }
    }

    gl_FragColor = result;
}
`;