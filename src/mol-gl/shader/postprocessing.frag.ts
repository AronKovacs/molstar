/**
 * Copyright (c) 2019-2020 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Áron Samuel Kovács <aron.kovacs@mail.muni.cz>
 */

export const postprocessing_frag = `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D tSsaoDepth;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tOutlines;
uniform vec2 uTexSize;

uniform float uNear;
uniform float uFar;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uFogColor;
uniform bool uTransparentBackground;

uniform float uOcclusionBias;
uniform float uOcclusionRadius;

const vec3 occlusionColor = vec3(0.0);

#include common

float getViewZ(const in float depth) {
    #if dOrthographic == 1
        return orthographicDepthToViewZ(depth, uNear, uFar);
    #else
        return perspectiveDepthToViewZ(depth, uNear, uFar);
    #endif
}

float getDepth(const in vec2 coords) {
    return unpackRGBAToDepth(texture2D(tDepth, coords));
}

bool isBackground(const in float depth) {
    return depth > 0.99;
}

float getSsao(vec2 coords) {
    float rawSsao = unpackRGToUnitInterval(texture2D(tSsaoDepth, coords).xy);
    if (rawSsao > 0.999) {
        return 1.0;
    } else if (rawSsao > 0.001) {
        return rawSsao;
    }
    return 0.0;
}

void main(void) {
    vec2 coords = gl_FragCoord.xy / uTexSize;
    vec4 color = texture2D(tColor, coords);

    float viewDist;
    float fogFactor;

    #ifdef dOcclusionEnable
        float depth = getDepth(coords);
        if (!isBackground(depth)) {
            viewDist = abs(getViewZ(depth));
            fogFactor = smoothstep(uFogNear, uFogFar, viewDist);
            float occlusionFactor = getSsao(coords);
            if (!uTransparentBackground) {
                color.rgb = mix(mix(occlusionColor, uFogColor, fogFactor), color.rgb, occlusionFactor);
            } else {
                color.rgb = mix(occlusionColor * (1.0 - fogFactor), color.rgb, occlusionFactor);
            }
        }
    #endif

    // outline needs to be handled after occlusion to keep them clean
    #ifdef dOutlineEnable
        #if dOutlineDynamicWidth == 1
            float closestTexel = texture2D(tOutlines, coords).z;
        #else
            float closestTexel = unpackRGBAToDepth(texture2D(tOutlines, coords));
        #endif

        if (!isBackground(closestTexel)) {
            color.rgb = vec3(0.0);
            viewDist = abs(getViewZ(closestTexel));
            fogFactor = smoothstep(uFogNear, uFogFar, viewDist);
            if (!uTransparentBackground) {
                color.rgb = mix(color.rgb, uFogColor, fogFactor);
            } else {
                color.a = 1.0 - fogFactor;
            }
        }
    #endif

    gl_FragColor = color;
}
`;