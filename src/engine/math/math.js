// Wildered Engine - Math Utilities
// 64-bit precision vector operations

class Vec3_64 {
    constructor(x = 0, y = 0, z = 0) {
        // True 64-bit storage
        this.x = x;
        this.y = y;
        this.z = z;
    }

    add(v) {
        return new Vec3_64(this.x + v.x, this.y + v.y, this.z + v.z);
    }

    sub(v) {
        return new Vec3_64(this.x - v.x, this.y - v.y, this.z - v.z);
    }

    scale(s) {
        return new Vec3_64(this.x * s, this.y * s, this.z * s);
    }

    length() {
        return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    }

    normalize() {
        const len = this.length();
        if (len === 0) return new Vec3_64();
        return this.scale(1 / len);
    }

    dot(v) {
        return this.x * v.x + this.y * v.y + this.z * v.z;
    }

    cross(v) {
        return new Vec3_64(
            this.y * v.z - this.z * v.y,
            this.z * v.x - this.x * v.z,
            this.x * v.y - this.y * v.x
        );
    }

    // Convert to 32-bit render space relative to origin
    toRenderSpace(originX, originY, originZ) {
        return new Float32Array([
            this.x - originX,
            this.y - originY,
            this.z - originZ
        ]);
    }

    distanceTo(v) {
        const dx = this.x - v.x;
        const dy = this.y - v.y;
        const dz = this.z - v.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
}

// Noise functions for terrain generation
const noise = {
    // Fast smooth noise
    smooth(x, z, scale, seed) {
        const s = scale * 0.001;
        const sd = seed || 0;
        return (
            Math.sin(x * s + sd) * Math.cos(z * s + sd) +
            Math.sin((x + z) * s * 0.7 + sd)
        ) / 2;
    },

    // Fractal Brownian Motion - layered noise for natural terrain
    fbm(x, z, octaves, lacunarity, gain) {
        let value = 0;
        let amplitude = 1.0;
        let frequency = 1.0;
        let maxValue = 0;

        for (let i = 0; i < octaves; i++) {
            value += amplitude * noise.smooth(
                x * frequency,
                z * frequency,
                1,
                i * 1.7
            );
            maxValue += amplitude;
            amplitude *= gain || 0.5;
            frequency *= lacunarity || 2.0;
        }

        return value / maxValue;
    },

    // Domain warped noise - creates realistic erosion patterns
    warp(x, z, strength) {
        const s = strength || 100;
        const wx = x + s * noise.fbm(x + 0.0, z + 0.0, 4, 2.0, 0.5);
        const wz = z + s * noise.fbm(x + 5.2, z + 1.3, 4, 2.0, 0.5);
        return noise.fbm(wx, wz, 6, 2.0, 0.5);
    }
};

// California terrain height at true world coordinates
const getTerrainHeight = (worldX, worldZ) => {
    // Normalize to 0-1 across California map
    const nx = worldX / 133000;
    const nz = worldZ / 433000;

    // Base continental shape
    let height = 0;

    // Sierra Nevada - eastern mountain range
    const sierraDist = Math.max(0, nx - 0.65);
    const sierraHeight = sierraDist * 3000 * noise.warp(
        worldX * 0.5, worldZ * 0.5, 80
    );

    // Coast ranges - western hills
    const coastDist = Math.max(0, 0.2 - nx);
    const coastHeight = coastDist * 1500 * noise.fbm(
        worldX * 0.3, worldZ * 0.3, 5, 2.0, 0.55
    );

    // Central Valley - flat basin
    const valleyFactor = Math.max(0, 1 - Math.abs(nx - 0.42) * 8);
    const valleyHeight = valleyFactor * 20 * noise.smooth(
        worldX, worldZ, 0.1, 3.0
    );

    // Mojave - southeast desert
    const mojaveFactor = nx > 0.6 && nz > 0.6 ? (nx - 0.6) * 2 : 0;
    const mojaveHeight = mojaveFactor * 400 * noise.fbm(
        worldX * 0.2, worldZ * 0.2, 3, 2.0, 0.5
    );

    // Detail noise
    const detail = noise.warp(worldX, worldZ, 120) * 80;

    height = sierraHeight + coastHeight + valleyHeight + 
             mojaveHeight + detail;

    return height;
};

// Get biome at world position
const getBiome = (worldX, worldZ) => {
    const nx = worldX / 133000;
    const nz = worldZ / 433000;
    const h = getTerrainHeight(worldX, worldZ);

    if (nx < 0.05) return 'ocean';
    if (nx < 0.18 && h < 400) return 'redwood';
    if (nx > 0.65 && h > 800) return 'sierra';
    if (nx > 0.58 && nz > 0.62) return 'mojave';
    return 'valley';
};

export { Vec3_64, noise, getTerrainHeight, getBiome };
