// Wildered - Terrain Chunk
// Raw WebGL2 geometry with GPU shader displacement

import { getTerrainHeight, getBiome } from '../../engine/math/math.js';
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

float getHeight(float x, float z) {
    float nx = x / 133000.0;
    float nz = z / 433000.0;

    // Domain warped noise
    float warpX = x + 120.0 * (
        sin(x * 0.003 + 0.0) * cos(z * 0.003 + 0.0) * 0.5 +
        sin(x * 0.006 + 5.2) * cos(z * 0.006 + 1.3) * 0.25
    );
    float warpZ = z + 120.0 * (
        sin(x * 0.003 + 1.7) * cos(z * 0.003 + 9.2) * 0.5 +
        sin(x * 0.006 + 8.3) * cos(z * 0.006 + 2.8) * 0.25
    );

    // Sierra Nevada
    float sierraDist = max(0.0, nx - 0.65);
    float sierra = sierraDist * 3000.0 * (
        sin(warpX * 0.0008) * cos(warpZ * 0.0008) * 0.5 +
        sin(warpX * 0.002) * cos(warpZ * 0.002) * 0.3 +
        sin(warpX * 0.005) * cos(warpZ * 0.005) * 0.2
    );

    // Coast ranges
    float coastDist = max(0.0, 0.2 - nx);
    float coast = coastDist * 1500.0 * (
        sin(warpX * 0.001) * cos(warpZ * 0.001) * 0.6 +
        sin(warpX * 0.003) * cos(warpZ * 0.003) * 0.4
    );

    // Central Valley
    float valleyFactor = max(0.0, 1.0 - abs(nx - 0.42) * 8.0);
    float valley = valleyFactor * 20.0 * sin(x * 0.0001) * cos(z * 0.0001);

    // Mojave
    float mojaveFactor = (nx > 0.6 && nz > 0.6) ? 
        (nx - 0.6) * 2.0 : 0.0;
    float mojave = mojaveFactor * 400.0 * (
        sin(warpX * 0.0005) * cos(warpZ * 0.0005)
    );

    // Detail
    float detail = (
        sin(warpX * 0.008) * cos(warpZ * 0.008) * 40.0 +
        sin(warpX * 0.02) * cos(warpZ * 0.02) * 15.0 +
        sin(warpX * 0.05) * cos(warpZ * 0.05) * 5.0
    );

    return sierra + coast + valley + mojave + detail;
}

void main() {
    // True world position
    float worldX = position.x + chunkOrigin.x;
    float worldZ = position.z + chunkOrigin.y;

    float h = getHeight(worldX, worldZ);
    float hx = getHeight(worldX + 1.0, worldZ);
    float hz = getHeight(worldX, worldZ + 1.0);

    vSlope = length(vec2(hx - h, hz - h));
    vHeight = h;
    vUV = uv;

    // Biome factor
    float nx = worldX / 133000.0;
    float nz = worldZ / 433000.0;
    vBiome = nx < 0.05 ? 0.0 :
             nx < 0.18 ? 1.0 :
             nx > 0.65 && h > 800.0 ? 2.0 :
             nx > 0.58 && nz > 0.62 ? 3.0 : 4.0;

    // Normal from height samples
    vec3 tangentX = normalize(vec3(1.0, hx - h, 0.0));
    vec3 tangentZ = normalize(vec3(0.0, hz - h, 1.0));
    vNormal = normalize(cross(tangentZ, tangentX));

    // Render space position (subtract render origin for precision)
    float renderX = worldX - renderOrigin.x;
    float renderZ = worldZ - renderOrigin.y;

    vWorldPos = vec3(renderX, h, renderZ);

    gl_Position = projection * view * model * vec4(renderX, h, renderZ, 1.0);
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

vec3 getColor(float height, float slope, float biome) {
    vec3 grassColor   = vec3(0.18, 0.34, 0.10);
    vec3 dryGrass     = vec3(0.52, 0.48, 0.22);
    vec3 dirtColor    = vec3(0.48, 0.34, 0.18);
    vec3 rockColor    = vec3(0.40, 0.36, 0.28);
    vec3 darkRock     = vec3(0.28, 0.25, 0.20);
    vec3 snowColor    = vec3(0.88, 0.92, 1.00);
    vec3 sandColor    = vec3(0.78, 0.70, 0.48);
    vec3 redwoodColor = vec3(0.10, 0.24, 0.07);
    vec3 mojaveColor  = vec3(0.62, 0.44, 0.24);
    vec3 oceanColor   = vec3(0.02, 0.10, 0.20);

    // Ocean
    if (biome < 0.5) return oceanColor;

    // Redwood coast
    if (biome < 1.5) {
        vec3 base = mix(redwoodColor, grassColor, 
            smoothstep(0.0, 0.3, slope));
        return mix(base, rockColor, smoothstep(0.4, 0.8, slope));
    }

    // Sierra Nevada
    if (biome < 2.5) {
        vec3 base = mix(grassColor, rockColor, 
            smoothstep(0.2, 0.6, slope));
        base = mix(base, darkRock, smoothstep(0.6, 1.0, slope));
        base = mix(base, snowColor, smoothstep(1000.0, 1300.0, height));
        return base;
    }

    // Mojave
    if (biome < 3.5) {
        return mix(mojaveColor, rockColor, 
            smoothstep(0.3, 0.7, slope));
    }

    // Central Valley
    vec3 base = mix(grassColor, dryGrass, 
        smoothstep(20.0, 80.0, height));
    base = mix(base, dirtColor, smoothstep(0.25, 0.5, slope));
    base = mix(base, rockColor, smoothstep(0.5, 0.8, slope));
    base = mix(base, sandColor, smoothstep(5.0, -5.0, height));
    return base;
}

void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(cameraPos - vWorldPos);
    vec3 sunDir = normalize(sunDirection);

    // Base color
    vec3 baseColor = getColor(vHeight, vSlope, vBiome);

    // Diffuse lighting
    float NdotL = max(dot(normal, -sunDir), 0.0);

    // Hemisphere ambient
    float upness = normal.y * 0.5 + 0.5;
    vec3 ambient = mix(ambientGround, ambientSky, upness) * ambientIntensity;

    // Specular for wet rock
    float spec = 0.0;
    if (vSlope > 0.5) {
        vec3 halfVec = normalize(-sunDir + viewDir);
        spec = pow(max(dot(normal, halfVec), 0.0), 32.0) * 0.15;
    }

    // Subsurface scattering for grass
    float sss = 0.0;
    if (vSlope < 0.3 && vHeight > 0.0 && vHeight < 200.0) {
        sss = max(0.0, dot(normal, vec3(0.0, 1.0, 0.0))) * 0.25;
    }
    vec3 sssColor = vec3(0.22, 0.42, 0.06) * sss;

    // Final
    vec3 color = baseColor * (sunColor * sunIntensity * NdotL + ambient)
                 + sssColor
                 + vec3(spec);

    // Atmospheric fog
    float dist = length(vWorldPos);
    float fog = smoothstep(2000.0, 8000.0, dist);
    vec3 fogColor = vec3(0.65, 0.78, 0.92);
    color = mix(color, fogColor, fog * 0.7);

    // Tone mapping - ACES approximation
    color = color * (color + 0.0245786) / 
            (color * (0.983729 * color + 0.432951) + 0.238081);

    // Gamma correction
    color = pow(color, vec3(1.0 / 2.2));

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
        // Compile shaders
        const vert = this.compileShader(gl, TERRAIN_VERT, gl.VERTEX_SHADER);
        const frag = this.compileShader(gl, TERRAIN_FRAG, gl.FRAGMENT_SHADER);
        if (!vert || !frag) return;

        this.program = gl.createProgram();
        gl.attachShader(this.program, vert);
        gl.attachShader(this.program, frag);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('Chunk shader error:', gl.getProgramInfoLog(this.program));
            return;
        }

        gl.deleteShader(vert);
        gl.deleteShader(frag);

        // Build geometry - flat grid, GPU displaces
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

        // Create VAO
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        // Position buffer
        const posLoc = gl.getAttribLocation(this.program, 'position');
        const posBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);

        // UV buffer
        const uvLoc = gl.getAttribLocation(this.program, 'uv');
        const uvBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(uvLoc);
        gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);

        // Index buffer
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
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    render(gl, projection, view, renderOrigin, sun, ambient, time) {
        if (!this.ready) return;

        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);

        // Set uniforms
        const u = (name) => gl.getUniformLocation(this.program, name);

        gl.uniformMatrix4fv(u('projection'), false, projection);
        gl.uniformMatrix4fv(u('view'), false, view);
        gl.uniformMatrix4fv(u('model'), false, this.modelMatrix);

        // Chunk world origin
        gl.uniform2f(u('chunkOrigin'), this.worldX, this.worldZ);

        // Render origin for 64-bit precision
        gl.uniform2f(u('renderOrigin'), renderOrigin[0], renderOrigin[2]);

        // Sun
        gl.uniform3fv(u('sunDirection'), sun.direction);
        gl.uniform3fv(u('sunColor'), sun.color);
        gl.uniform1f(u('sunIntensity'), sun.intensity);

        // Ambient
        gl.uniform3fv(u('ambientSky'), ambient.sky);
        gl.uniform3fv(u('ambientGround'), ambient.ground);
        gl.uniform1f(u('ambientIntensity'), ambient.intensity);

        // Time
        gl.uniform1f(u('time'), time);

        gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);

        gl.bindVertexArray(null);
    }

    dispose(gl) {
        if (this.program) gl.deleteProgram(this.program);
        if (this.vao) gl.deleteVertexArray(this.vao);
    }
}

export { TerrainChunk };
