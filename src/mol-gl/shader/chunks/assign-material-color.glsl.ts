export default `
#if defined(dRenderVariant_color)
    #if defined(dColorType_uniform)
        vec4 material = vec4(uColor, uAlpha);
    #elif defined(dColorType_varying)
        vec4 material = vec4(vColor.rgb, uAlpha);
    #endif

    // mix material with overpaint
    #if defined(dOverpaint)
        material.rgb = mix(material.rgb, vOverpaint.rgb, vOverpaint.a);
    #endif
#elif defined(dRenderVariant_pick)
    vec4 material = vColor;
#elif defined(dRenderVariant_depth)
    #ifdef enabledFragDepth
        vec4 material = packDepthToRGBA(gl_FragDepthEXT);
    #else
        vec4 material = packDepthToRGBA(gl_FragCoord.z);
    #endif
#endif

// apply screendoor transparency
#if defined(dTransparency)
    float ta = 1.0 - vTransparency;

    #if defined(dRenderVariant_pick)
        if (ta < uPickingAlphaThreshold)
            discard; // ignore so the element below can be picked
    #else
        #if defined(dRenderVariant_colorBlended)
            float at = 0.0;

            // shift by view-offset during multi-sample rendering to allow for blending
            vec2 coord = gl_FragCoord.xy + uViewOffset * 0.25;

            const mat4 thresholdMatrix = mat4(
                1.0 / 17.0,  9.0 / 17.0,  3.0 / 17.0, 11.0 / 17.0,
                13.0 / 17.0,  5.0 / 17.0, 15.0 / 17.0,  7.0 / 17.0,
                4.0 / 17.0, 12.0 / 17.0,  2.0 / 17.0, 10.0 / 17.0,
                16.0 / 17.0,  8.0 / 17.0, 14.0 / 17.0,  6.0 / 17.0
            );
            int ci = int(intMod(coord.x, 4.0));
            int ri = int(intMod(coord.y, 4.0));
            #if __VERSION__ == 100
                vec4 i = vec4(float(ci * 4 + ri));
                vec4 v = thresholdMatrix[0] * vec4(equal(i, vec4(0.0, 1.0, 2.0, 3.0))) +
                    thresholdMatrix[1] * vec4(equal(i, vec4(4.0, 5.0, 6.0, 7.0))) +
                    thresholdMatrix[2] * vec4(equal(i, vec4(8.0, 9.0, 10.0, 11.0))) +
                    thresholdMatrix[3] * vec4(equal(i, vec4(12.0, 13.0, 14.0, 15.0)));
                at = v.x + v.y + v.z + v.w;
            #else
                at = thresholdMatrix[ci][ri];
            #endif

            if (ta < 0.99 && (ta < 0.01 || ta < at)) {
                discard;
            }
        #elif defined(dRenderVariant_colorWboit)
            material.a *= ta;
        #endif
    #endif
#endif
`;