/**
 * Copyright (c) 2019-2020 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Áron Samuel Kovács <aron.kovacs@mail.muni.cz>
 */

export const hiZCopy_frag = `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D tColor;

void main() {
    ivec2 coords = ivec2(gl_FragCoord.xy);
    gl_FragColor = texelFetch(tColor, coords, 0);
}
`;