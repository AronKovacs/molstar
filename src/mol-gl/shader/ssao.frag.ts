/**
 * Copyright (c) 2019-2020 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Áron Samuel Kovács <aron.kovacs@mail.muni.cz>
 */

// Modified Scalable Ambient Obscurance based on the reference implementation by Morgan McGuire and Michael Mara, NVIDIA Research
// Original authors and license:

/**
 \file SAO_AO.pix
 \author Morgan McGuire and Michael Mara, NVIDIA Research

 Reference implementation of the Scalable Ambient Obscurance (SAO) screen-space ambient obscurance algorithm.

 The optimized algorithmic structure of SAO was published in McGuire, Mara, and Luebke, Scalable Ambient Obscurance,
 <i>HPG</i> 2012, and was developed at NVIDIA with support from Louis Bavoil.

 The mathematical ideas of AlchemyAO were first described in McGuire, Osman, Bukowski, and Hennessy, The
 Alchemy Screen-Space Ambient Obscurance Algorithm, <i>HPG</i> 2011 and were developed at
 Vicarious Visions.

 DX11 HLSL port by Leonardo Zide of Treyarch

 <hr>

  Open Source under the "BSD" license: http://www.opensource.org/licenses/bsd-license.php

  Copyright (c) 2011-2012, NVIDIA
  All rights reserved.

  Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

  Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
  Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

*/

// ROTATIONS array taken from the Godot engine
// License:
/**
	Copyright (c) 2007-2021 Juan Linietsky, Ariel Manzur.
	Copyright (c) 2014-2021 Godot Engine contributors (cf. AUTHORS.md).

	Permission is hereby granted, free of charge, to any person obtaining a copy
	of this software and associated documentation files (the "Software"), to deal
	in the Software without restriction, including without limitation the rights
	to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
	copies of the Software, and to permit persons to whom the Software is
	furnished to do so, subject to the following conditions:

	The above copyright notice and this permission notice shall be included in all
	copies or substantial portions of the Software.

	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
	IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
	FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
	AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
	LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
	OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
	SOFTWARE.
*/

export const ssao_frag = `
precision highp float;
precision highp int;
precision highp sampler2D;

#include common

uniform sampler2D tDepth;

uniform mat4 uInvProjection;

// needed for stereo camera
// x, y, width, height, all <0, 1>
uniform vec4 uViewport;

uniform vec2 uTexSize;
uniform bool uIsOrtho;

uniform float uRadius;
uniform float uIntensity;
uniform float uProjectionScale;
uniform float uBias;

bool isBackground(const in float depth) {
    return depth > 0.99;
}

float getDepth(const in vec2 coords) {
    return unpackRGBAToDepth(texture2D(tDepth, coords));
}

vec3 normalFromDepth(const in float depth, const in float depth1, const in float depth2, vec2 offset1, vec2 offset2) {
    vec3 p1 = vec3(offset1, depth1 - depth);
    vec3 p2 = vec3(offset2, depth2 - depth);

    vec3 normal = cross(p1, p2);
    normal.z = -normal.z;

    return normalize(normal);
}

// If using depth mip levels, the log of the maximum pixel offset before we need to switch to a lower
// miplevel to maintain reasonable spatial locality in the cache
// If this number is too small (< 3), too many taps will land in the same pixel, and we'll get bad variance that manifests as flashing.
// If it is too high (> 5), we'll get bad performance because we're not using the MIP levels effectively
#define LOG_MAX_OFFSET (3)

// This is the number of turns around the circle that the spiral pattern makes.  This should be prime to prevent
// taps from lining up.
// This array limits the number of samples, currently length(ROTATIONS) == 98, which means that this must hold: dNSamples <= 98.
const int ROTATIONS[] = int[](
		1, 1, 2, 3, 2, 5, 2, 3, 2,
		3, 3, 5, 5, 3, 4, 7, 5, 5, 7,
		9, 8, 5, 5, 7, 7, 7, 8, 5, 8,
		11, 12, 7, 10, 13, 8, 11, 8, 7, 14,
		11, 11, 13, 12, 13, 19, 17, 13, 11, 18,
		19, 11, 11, 14, 17, 21, 15, 16, 17, 18,
		13, 17, 11, 17, 19, 18, 25, 18, 19, 19,
		29, 21, 19, 27, 31, 29, 21, 18, 17, 29,
		31, 31, 23, 18, 25, 26, 25, 23, 19, 34,
		19, 27, 21, 25, 39, 29, 17, 21, 27);

const int NUM_SPIRAL_TURNS = ROTATIONS[dNSamples - 1];

/** Returns a unit vector and a screen-space radius for the tap on a unit disk (the caller should scale by the actual disk radius) */
vec2 tapLocation(int sampleNumber, float spinAngle, out float screenRadius) {
	// Radius relative to screenRadius
	float alpha = (float(sampleNumber) + 0.5) * (1.0 / float(dNSamples));
	float angle = alpha * (float(NUM_SPIRAL_TURNS) * TWO_PI) + spinAngle;

	screenRadius = alpha;
	return vec2(cos(angle), sin(angle));
}

/** Read the camera-space position of the point at screen-space pixel ssP + unitOffset * ssR.  Assumes length(unitOffset) == 1 */
vec4 getOffsetPosition(vec2 screenPos, float screenRadius) {
	#if defined(enabledShaderTextureLod)
		// Derivation:
		//  mipLevel = floor(log(screenRadius / MAX_OFFSET));
		int mipLevel = clamp(int(floor(log2(screenRadius))) - LOG_MAX_OFFSET, 0, dMaxMipLevel);
		float depth = unpackRGBAToDepth(texture2DLodEXT(tDepth, screenPos, float(mipLevel)));
	#else
		float depth = unpackRGBAToDepth(texture2D(tDepth, screenPos));
	#endif
	
	return vec4(screenSpaceToWorldSpace(vec3(screenPos, depth), uInvProjection), depth);
}

/** Compute the occlusion due to sample with index \a i about the pixel at \a ssC that corresponds
	to camera-space point \a C with unit normal \a n_C, using maximum screen-space sampling radius \a ssDiskRadius
*/
float sampleAO(in vec2 invTexSize, in ivec2 selfScreenPos, in vec3 selfViewPos, in vec3 selfViewNormal, in float screenDiskRadius, in float viewRadius, in int tapIndex, in float randomPatternRotationAngle) {
	// Offset on the unit disk, spun for this pixel
	float screenRadius;
	vec2 unitOffset = tapLocation(tapIndex, randomPatternRotationAngle, screenRadius);
	screenRadius *= screenDiskRadius;

	vec2 sampleScreenPos = invTexSize * vec2(ivec2(screenRadius * unitOffset) + selfScreenPos);

	if (sampleScreenPos.x < uViewport.x ||
		sampleScreenPos.x > uViewport.x + uViewport.z ||
		sampleScreenPos.y < uViewport.y ||
		sampleScreenPos.y > uViewport.y + uViewport.w) {
		return 0.0;
	}

	// The occluding point in camera space
	vec4 sampleViewPosDepth = getOffsetPosition(sampleScreenPos, screenRadius);
	if (isBackground(sampleViewPosDepth.w)) {
		return 0.0;
	}
	vec3 sampleViewPos = sampleViewPosDepth.xyz;

	vec3 v = sampleViewPos - selfViewPos;

	float vv = dot(v, v);
	float vn = dot(v, selfViewNormal);

	const float epsilon = 0.01;
	float viewRadius2 = viewRadius * viewRadius;
	
	float invViewRadius2 = 1.0 / viewRadius2;
	return 4.0 * max(1.0 - vv * invViewRadius2, 0.0) * max(vn - uBias, 0.0);
}

void main() {
    vec2 invTexSize = 1.0 / uTexSize;
    vec2 coords = gl_FragCoord.xy * invTexSize;
    ivec2 screenPos = ivec2(gl_FragCoord.xy);

    float depth = getDepth(coords);
    vec2 packedDepth = packUnitIntervalToRG(depth);

    if (isBackground(depth)) {
        gl_FragColor = vec4(packUnitIntervalToRG(0.0), packedDepth);
        return;
    }

    vec2 offset1 = vec2(0.0, invTexSize.y);
    vec2 offset2 = vec2(invTexSize.x, 0.0);

    float depth1 = getDepth(coords + offset1);
    float depth2 = getDepth(coords + offset2);

    vec3 viewNormal = normalFromDepth(depth, depth1, depth2, offset1, offset2);
    vec3 viewPos = screenSpaceToWorldSpace(vec3(coords, depth), uInvProjection);

    float randomPatternRotationAngle = mod(float((3 * screenPos.x ^ screenPos.y + screenPos.x * screenPos.y) * 10), TWO_PI);

	float screenDiskRadius = uIsOrtho ? uProjectionScale * uRadius : uProjectionScale * uRadius / viewPos.z;
	screenDiskRadius = abs(screenDiskRadius);

	float sum = 0.0;
	for (int i = 0; i < dNSamples; ++i) {
		sum += sampleAO(invTexSize, screenPos, viewPos, viewNormal, screenDiskRadius, uRadius, i, randomPatternRotationAngle);
	}

	float occlusion = clamp(1.0 - uIntensity * sum / float(5 * dNSamples), 0.0, 1.0);

	#if defined(enabledStandardDerivatives)
		if (abs(dFdx(viewPos.z)) < 0.02) {
			occlusion -= dFdx(occlusion) * (float(screenPos.x & 1) - 0.5);
		}
		if (abs(dFdy(viewPos.z)) < 0.02) {
			occlusion -= dFdy(occlusion) * (float(screenPos.y & 1) - 0.5);
		}
	#endif

    vec2 packedOcclusion = packUnitIntervalToRG(occlusion);
    gl_FragColor = vec4(packedOcclusion, packedDepth);
}
`;