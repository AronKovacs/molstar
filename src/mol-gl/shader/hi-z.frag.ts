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
uniform int uLevel;

void main(void) {
    ivec2 coords = ivec2(gl_FragCoord.xy);

    // Rotated Grid Subsample
    int x = 2 * coords.x + ((coords.y & 1) ^ 1);
    int y = 2 * coords.y + ((coords.x & 1) ^ 1);
    // this shader is supposed to run only on webgl2 compatible devices, so textureSize is available
    ivec2 sampleCoords = clamp(ivec2(x, y), ivec2(0), textureSize(tDepth, uLevel) - 1);

    gl_FragColor = texelFetch(tDepth, sampleCoords, int(uLevel));
}
`;