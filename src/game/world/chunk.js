import { mat4 } from 'gl-matrix';

const TERRAIN_VERT = `#version 300 es
precision highp float;

in vec3 position;
in vec2 uv;

uniform mat4 projection;
uniform mat4 view;
uniform mat4 model;
uniform vec2 chunkOrigin;
uniform vec2 renderOrigin;
uniform float time;

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUV;
out float vHeight;
out float vSlope;
out float vBiome;

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)),
             dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

float gradNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = dot(hash2(i + vec2(0,0)) * 2.0 - 1.0, f - vec2(0,0));
    float b = dot(hash2(i + vec2(1,0)) * 2.0 - 1.0, f - vec2(1,0));
    float c = dot(hash2(i + vec2(0,1)) * 2.0 - 1.0, f - vec2(0,1));
    float d = dot(hash2(i + vec2(1,1)) * 2.0 - 1.0, f - vec2(1,1));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 8; i++) {
        if (i >= octaves) break;
        value += amplitude * gradNoise(p * frequency);
        amplitude *= 0.5;
        frequency *= 2.1;
    }
    return value;
}

float warpedFbm(vec2 p, int octaves) {
    vec2 q = vec2(fbm(p + vec2(0.0, 0.0), 4),
                  fbm(p + vec2(5.2, 1.3), 4));
    vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2), 4),
                  fbm(p + 4.0 * q + vec2(8.3, 2.8), 4));
    return fbm(p + 4.0 * r, octaves);
}

float getHeight(float x, float z) {
    float nx = x / 133000.0;
    float nz = z / 433000.0;
    vec2 p = vec2(x, z);

    // Large scale rolling hills - increased amplitude
    float large = warpedFbm(p * 0.00012, 6) * 280.0;

    // Sierra Nevada
    float sierraDist = max(0.0, nx - 0.65);
    float sierraShape = warpedFbm(p * 0.00028 + vec2(2.3, 1.1), 7);
    float sierra = sierraDist * 3200.0 * (sierraShape * 0.75 + 0.35);

    // Coast ranges
    float coastDist = max(0.0, 0.2 - nx);
    float coastShape = warpedFbm(p * 0.00038 + vec2(7.1, 3.4), 6);
    float coast = coastDist * 1600.0 * (coastShape * 0.65 + 0.25);

    // Central Valley - more pronounced rolling hills
    float valleyFactor = max(0.0, 1.0 - abs(nx - 0.42) * 7.0);
    float valleyRolling = fbm(p * 0.0006 + vec2(3.3, 8.7), 5) * 80.0;
    float valleyMicro = fbm(p * 0.002 + vec2(1.1, 4.4), 4) * 25.0;
    float valley = valleyFactor * (valleyRolling + valleyMicro + 8.0);

    // Mojave
    float mojaveFactor = min(1.0,
        max(0.0, (nx - 0.58) * 2.5) *
        max(0.0, (nz - 0.60) * 2.5));
    float mojaveShape = warpedFbm(p * 0.00018 + vec2(4.5, 6.2), 5);
    float mojave = mojaveFactor * 420.0 * (mojaveShape * 0.55 + 0.3);

    // Surface micro detail
    float micro = fbm(p * 0.004 + vec2(2.2, 5.5), 4) * 10.0
                + fbm(p * 0.01  + vec2(8.1, 1.3), 3) * 3.5;

    return large + sierra + coast + valley + mojave + micro;
}

void main() {
    float worldX = position.x + chunkOrigin.x;
    float worldZ = position.z + chunkOrigin.y;

    float h  = getHeight(worldX, worldZ);
    float hx = getHeight(worldX + 2.0, worldZ);
    float hz = getHeight(worldX, worldZ + 2.0);
    float hl = getHeight(worldX - 2.0, worldZ);
    float hb = getHeight(worldX, worldZ - 2.0);

    vSlope = length(vec2(hx - hl, hz - hb)) * 0.25;
    vHeight = h;
    vUV = uv;

    float nx2 = worldX / 133000.0;
    float nz2 = worldZ / 433000.0;
    vBiome = nx2 < 0.05 ? 0.0 :
             nx2 < 0.18 ? 1.0 :
             nx2 > 0.65 && h > 800.0 ? 2.0 :
             nx2 > 0.58 && nz2 > 0.62 ? 3.0 : 4.0;

    vec3 tangentX = normalize(vec3(4.0, hx - hl, 0.0));
    vec3 tangentZ = normalize(vec3(0.0, hz - hb, 4.0));
    vNormal = normalize(cross(tangentZ, tangentX));

    float renderX = worldX - renderOrigin.x;
    float renderZ = worldZ - renderOrigin.y;

    vWorldPos = vec3(renderX, h, renderZ);
    gl_Position = projection * view * model *
        vec4(renderX, h, renderZ, 1.0);
}
`;

const TERRAIN_FRAG = `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUV;
in float vHeight;
in float vSlope;
in float vBiome;

uniform vec3 sunDirection;
uniform vec3 sunColor;
uniform float sunIntensity;
uniform vec3 ambientSky;
uniform vec3 ambientGround;
uniform float ambientIntensity;
uniform vec3 cameraPos;
uniform float time;

out vec4 fragColor;

// Increase color saturation
vec3 saturate(vec3 color, float amount) {
    float lum = dot(color, vec3(0.299, 0.587, 0.114));
    return mix(vec3(lum), color, amount);
}

vec3 getColor(float height, float slope, float biome) {
    float s = clamp(slope * 1.5, 0.0, 1.0);

    // Central Valley - richer more saturated versions
    vec3 valleyFlat   = vec3(0.65, 0.56, 0.28); // dry golden straw
    vec3 valleyHill   = vec3(0.55, 0.42, 0.18); // warm brown hill
    vec3 valleyWet    = vec3(0.24, 0.36, 0.12); // muted olive green
    vec3 valleyDirt   = vec3(0.50, 0.34, 0.16); // rich ochre
    vec3 valleyRock   = vec3(0.40, 0.34, 0.24); // warm grey rock

    vec3 redwoodDeep  = vec3(0.06, 0.16, 0.04);
    vec3 redwoodMid   = vec3(0.12, 0.26, 0.08);
    vec3 coastRock    = vec3(0.32, 0.26, 0.20);
    vec3 coastSand    = vec3(0.65, 0.55, 0.32);

    vec3 sierraGrass  = vec3(0.28, 0.38, 0.14);
    vec3 sierraRock   = vec3(0.38, 0.33, 0.24);
    vec3 sierraDark   = vec3(0.22, 0.19, 0.14);
    vec3 snowBright   = vec3(0.93, 0.96, 1.00);
    vec3 snowBlue     = vec3(0.65, 0.74, 0.90);

    vec3 mojaveWarm   = vec3(0.64, 0.48, 0.24);
    vec3 mojaveRock   = vec3(0.50, 0.38, 0.22);

    vec3 oceanDeep    = vec3(0.02, 0.07, 0.16);
    vec3 oceanMid     = vec3(0.03, 0.14, 0.28);
    vec3 beachSand    = vec3(0.70, 0.60, 0.38);

    if (biome < 0.5) {
        return mix(oceanDeep, oceanMid,
            smoothstep(-200.0, -10.0, height));
    }
    if (biome < 1.5) {
        vec3 base = mix(redwoodDeep, redwoodMid,
            smoothstep(0.0, 200.0, height));
        base = mix(base, coastRock, smoothstep(0.28, 0.65, s));
        base = mix(base, coastSand, smoothstep(8.0, -2.0, height));
        return saturate(base, 1.4);
    }
    if (biome < 2.5) {
        vec3 base = mix(sierraGrass, sierraRock,
            smoothstep(0.18, 0.52, s));
        base = mix(base, sierraDark, smoothstep(0.52, 0.82, s));
        float snow = smoothstep(900.0, 1080.0, height);
        float sunFace = smoothstep(0.2, 0.85, vNormal.y);
        base = mix(base, mix(snowBlue, snowBright, sunFace), snow);
        return saturate(base, 1.3);
    }
    if (biome < 3.5) {
        vec3 base = mix(mojaveWarm, mojaveRock,
            smoothstep(0.22, 0.62, s));
        return saturate(base, 1.35);
    }

    // Central Valley
    float hillFactor = smoothstep(5.0, 80.0, height);
    vec3 grass = mix(valleyFlat, valleyHill, hillFactor);
    grass = mix(grass, valleyWet,
        smoothstep(14.0, 0.0, height) * 0.70);
    vec3 base = mix(grass, valleyDirt, smoothstep(0.20, 0.48, s));
    base = mix(base, valleyRock, smoothstep(0.48, 0.78, s));
    base = mix(base, beachSand, smoothstep(5.0, -3.0, height));
    return saturate(base, 1.35);
}

void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(cameraPos - vWorldPos);
    vec3 sunDir = normalize(sunDirection);

    vec3 baseColor = getColor(vHeight, vSlope, vBiome);

    // Strong directional lighting - real California sun contrast
    float NdotL = dot(normal, -sunDir);

    // Lit side - full sun
    float litSide = max(NdotL, 0.0);

    // Shadow side - ambient only, not black
    float shadowSide = max(-NdotL * 0.15, 0.0);

    // Hemisphere ambient
    float upness = normal.y * 0.5 + 0.5;
    vec3 ambient = mix(ambientGround, ambientSky, upness)
                   * ambientIntensity;

    // Warm top light - California noon sun
    float topLight = max(0.0, normal.y);
    vec3 warmTop = vec3(1.05, 0.95, 0.72) * topLight * 0.22;

    // Cool sky bounce in shadowed areas
    float skyBounce = max(0.0, -NdotL) * 0.12;
    vec3 coolBounce = vec3(0.55, 0.68, 0.90) * skyBounce;

    // Specular on rock surfaces
    float specStr = smoothstep(0.35, 0.70, vSlope) * 0.25;
    vec3 halfVec = normalize(-sunDir + viewDir);
    float spec = pow(max(dot(normal, halfVec), 0.0), 32.0) * specStr;

    // Grass SSS - light through thin dry grass
    float sssStr = max(0.0, 1.0 - vSlope * 2.8) *
                   smoothstep(-5.0, 30.0, vHeight) * 0.20;
    vec3 sss = vec3(0.40, 0.52, 0.08) * sssStr;

    // Combine - higher sun intensity for stronger contrast
    vec3 color = baseColor * (
        sunColor * sunIntensity * litSide +
        ambient +
        coolBounce
    ) + warmTop + sss + vec3(spec) * sunColor * 0.8;

    // Subtle ambient occlusion in valleys
    float ao = smoothstep(-30.0, 60.0, vHeight) * 0.15 + 0.85;
    color *= ao;

    // California golden hour haze - starts much further
    float dist = length(vWorldPos);
    float fog = smoothstep(6000.0, 18000.0, dist);
    vec3 hazeColor = vec3(0.82, 0.80, 0.76);
    color = mix(color, hazeColor, fog * 0.60);

    // ACES tone mapping
    color = color * (color + 0.0245786) /
            (color * (0.983729 * color + 0.432951) + 0.238081);

    // Gamma
    color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));

    fragColor = vec4(color, 1.0);
}
`;

class TerrainChunk {
    constructor(gl, worldX, worldZ, size) {
        this.worldX = worldX;
        this.worldZ = worldZ;
        this.size = size;
        this.ready = false;
        this.program = null;
        this.vao = null;
        this.indexCount = 0;
        this.modelMatrix = mat4.create();
        this.init(gl);
    }

    init(gl) {
        const vert = this.compileShader(gl, TERRAIN_VERT, gl.VERTEX_SHADER);
        const frag = this.compileShader(gl, TERRAIN_FRAG, gl.FRAGMENT_SHADER);
        if (!vert || !frag) return;

        this.program = gl.createProgram();
        gl.attachShader(this.program, vert);
        gl.attachShader(this.program, frag);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('Chunk error:', gl.getProgramInfoLog(this.program));
            return;
        }

        gl.deleteShader(vert);
        gl.deleteShader(frag);

        const resolution = 64;
        const vertices = [];
        const uvs = [];
        const indices = [];
        const step = this.size / resolution;

        for (let z = 0; z <= resolution; z++) {
            for (let x = 0; x <= resolution; x++) {
                vertices.push(x * step, 0, z * step);
                uvs.push(x / resolution, z / resolution);
            }
        }

        for (let z = 0; z < resolution; z++) {
            for (let x = 0; x < resolution; x++) {
                const tl = z * (resolution + 1) + x;
                const tr = tl + 1;
                const bl = tl + (resolution + 1);
                const br = bl + 1;
                indices.push(tl, bl, tr, tr, bl, br);
            }
        }

        this.indexCount = indices.length;
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        const posLoc = gl.getAttribLocation(this.program, 'position');
        const posBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferData(gl.ARRAY_BUFFER,
            new Float32Array(vertices), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);

        const uvLoc = gl.getAttribLocation(this.program, 'uv');
        const uvBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
        gl.bufferData(gl.ARRAY_BUFFER,
            new Float32Array(uvs), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(uvLoc);
        gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);

        const idxBuf = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,
            new Uint32Array(indices), gl.STATIC_DRAW);

        gl.bindVertexArray(null);
        this.ready = true;
    }

    compileShader(gl, source, type) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    render(gl, projection, view, renderOrigin, sun, ambient, time) {
        if (!this.ready) return;

        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);

        const u = name => gl.getUniformLocation(this.program, name);

        gl.uniformMatrix4fv(u('projection'), false, projection);
        gl.uniformMatrix4fv(u('view'), false, view);
        gl.uniformMatrix4fv(u('model'), false, this.modelMatrix);
        gl.uniform2f(u('chunkOrigin'), this.worldX, this.worldZ);
        gl.uniform2f(u('renderOrigin'), renderOrigin[0], renderOrigin[2]);
        gl.uniform3fv(u('sunDirection'), sun.direction);
        gl.uniform3fv(u('sunColor'), sun.color);
        gl.uniform1f(u('sunIntensity'), sun.intensity);
        gl.uniform3fv(u('ambientSky'), ambient.sky);
        gl.uniform3fv(u('ambientGround'), ambient.ground);
        gl.uniform1f(u('ambientIntensity'), ambient.intensity);
        gl.uniform1f(u('time'), time);

        gl.drawElements(gl.TRIANGLES, this.indexCount,
            gl.UNSIGNED_INT, 0);
        gl.bindVertexArray(null);
    }

    dispose(gl) {
        if (this.program) gl.deleteProgram(this.program);
        if (this.vao) gl.deleteVertexArray(this.vao);
    }
}

export { TerrainChunk };
