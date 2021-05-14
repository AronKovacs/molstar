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
// z: seed z coord, <0, 1>
// w: self z coord, <0, 1>
// if x (or y or z or w) is less than 0 then that pixel is 'empty'
uniform sampler2D tCutaway;
uniform vec2 uTexSize;

uniform mat4 uInvProjection;

// needed for stereo camera
// x, y, width, height, all <0, 1>
uniform vec4 uViewport;

uniform vec2 uStep;

uniform float uPMsz;
uniform float uAngle;
uniform float uEdgeRegionSize;
uniform float uSlopeStartOffset;

uniform vec2 uAspectRatio;

uniform float uIsOrtho;
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

float slopeOffsetEdgeCompression(float slopeOffset, vec2 coords) {
    if (uEdgeRegionSize == 0.0) {
        return slopeOffset;
    }
    vec2 terms = clamp(normalizedDistanceFromEdges(coords) / uEdgeRegionSize, 0.0, 1.0);
    return slopeOffset * terms.x * terms.y;
}

float getPixelViewSize(vec3 coords, vec2 invTexSize) {
    float viewX1 = screenSpaceToWorldSpace(coords - vec3(invTexSize.x * 0.5, 0.0, 0.0), uInvProjection).x;
    float viewX2 = screenSpaceToWorldSpace(coords + vec3(invTexSize.x * 0.5, 0.0, 0.0), uInvProjection).x;
    return abs(viewX2 - viewX1);
}

void main(void) {
    vec2 invTexSize = 1.0 / uTexSize;
    vec2 selfCoords = gl_FragCoord.xy * invTexSize;

    float angle = max(angleEdgeCompression(selfCoords), 0.001);
    float tanAngle = tan(angle);

    vec4 result = texture(tCutaway, selfCoords);
    float resultViewZ = depthToViewZ(uIsOrtho, result.w, uNear, uFar);
    float resultLinearZ = (resultViewZ - uNear) / (uFar - uNear);
    
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

            float seedPixelViewSize = getPixelViewSize(sampleValue.xyz, invTexSize);
            float slopeStartOffset = uSlopeStartOffset / (seedPixelViewSize * uTexSize.x);

            vec2 coordDiff = (selfCoords.xy - sampleValue.xy) * uAspectRatio;
            float dist = max(length(coordDiff) - slopeOffsetEdgeCompression(slopeStartOffset, selfCoords), 0.0);
            
            float seedViewZ = depthToViewZ(uIsOrtho, sampleValue.z, uNear, uFar);
            float seedLinearZ = (seedViewZ - uNear) / (uFar - uNear);
            float cutawayLinearZ = seedLinearZ - dist * slope(tanAngle, seedLinearZ);

            if (result.x < 0.0 || (cutawayLinearZ <= 0.0 && resultLinearZ > cutawayLinearZ)) {
                float cutawayViewZ = uNear + (cutawayLinearZ * (uFar - uNear));
                float cutawayDepth = viewZToDepth(uIsOrtho, cutawayViewZ, uNear, uFar);

                result = vec4(sampleValue.xyz, cutawayDepth);
                resultLinearZ = cutawayLinearZ;
            }
        }
    }

    gl_FragColor = result;
}
`;