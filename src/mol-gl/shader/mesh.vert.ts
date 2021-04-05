/**
 * Copyright (c) 2018-2020 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

export default `
precision highp float;
precision highp int;

#include common
#include read_from_texture
#include common_vert_params
#include color_vert_params
#include common_clip

#ifdef dGeoTexture
    uniform vec2 uGeoTexDim;
    uniform sampler2D tPositionGroup;
#else
    attribute vec3 aPosition;
#endif
attribute mat4 aTransform;
attribute float aInstance;
attribute float aGroup;

#ifdef dGeoTexture
    uniform sampler2D tNormal;
#else
    attribute vec3 aNormal;
#endif
varying vec3 vNormal;

uniform float uHullExpansionSize;

void main(){
    #include assign_group
    #include assign_color_varying
    #include assign_marker_varying
    #include assign_clipping_varying
    #include clip_instance

    #ifdef dGeoTexture
        vec3 normal = readFromTexture(tNormal, aGroup, uGeoTexDim).xyz;
    #else
        vec3 normal = aNormal;
    #endif

    // assign_position - begin
    mat4 model = uModel * aTransform;
    mat4 modelView = uView * model;
    #ifdef dGeoTexture
        vec3 position = readFromTexture(tPositionGroup, aGroup, uGeoTexDim).xyz;
    #else
        vec3 position = aPosition;
    #endif
    vec4 position4 = vec4(position + normal * uHullExpansionSize, 1.0);
    vModelPosition = (model * position4).xyz; // for clipping in frag shader
    vec4 mvPosition = modelView * position4;
    vViewPosition = mvPosition.xyz;
    gl_Position = uProjection * mvPosition;
    // assign_position - end

    mat3 normalMatrix = transpose3(inverse3(mat3(modelView)));
    vec3 transformedNormal = normalize(normalMatrix * normalize(normal));
    #if defined(dFlipSided) && !defined(dDoubleSided) // TODO checking dDoubleSided should not be required, ASR
        transformedNormal = -transformedNormal;
    #endif
    vNormal = transformedNormal;
}
`;