import { getTerrainHeight, getBiome, Vec3_64 } from '../../engine/math/math.js';
import { TerrainChunk } from './chunk.js';

const CHUNK_SIZE = 256;
const CHUNKS_VISIBLE = 3;

class World {
    constructor(gl) {
        this.gl = gl;
        this.chunks = new Map();

        // Start in Central Valley - guaranteed land
        this.playerPos = new Vec3_64(30000, 0, 30000);
        this.time = 0;

        this.sun = {
            direction: new Float32Array([-0.5, -1.0, -0.3]),
            color: new Float32Array([1.0, 0.95, 0.82]),
            intensity: 3.5
        };

        this.ambient = {
            sky: new Float32Array([0.55, 0.70, 1.0]),
            ground: new Float32Array([0.28, 0.22, 0.12]),
            intensity: 0.8
        };
    }

    update(deltaTime) {
        this.time += deltaTime;
        this.updateChunks();
    }

    updateChunks() {
        const cx = Math.floor(this.playerPos.x / CHUNK_SIZE);
        const cz = Math.floor(this.playerPos.z / CHUNK_SIZE);
        const needed = new Set();

        for (let dx = -CHUNKS_VISIBLE; dx <= CHUNKS_VISIBLE; dx++) {
            for (let dz = -CHUNKS_VISIBLE; dz <= CHUNKS_VISIBLE; dz++) {
                const key = `${cx + dx}_${cz + dz}`;
                needed.add(key);
                if (!this.chunks.has(key)) {
                    const chunk = new TerrainChunk(
                        this.gl,
                        (cx + dx) * CHUNK_SIZE,
                        (cz + dz) * CHUNK_SIZE,
                        CHUNK_SIZE
                    );
                    this.chunks.set(key, chunk);
                }
            }
        }

        for (const [key, chunk] of this.chunks) {
            if (!needed.has(key)) {
                chunk.dispose(this.gl);
                this.chunks.delete(key);
            }
        }
    }

    render(gl, projMatrix, viewMatrix, renderOrigin, camera, originReset) {
        for (const chunk of this.chunks.values()) {
            chunk.render(
                gl,
                projMatrix,
                viewMatrix,
                renderOrigin,
                this.sun,
                this.ambient,
                this.time
            );
        }
    }

    movePlayer(dx, dz) {
        this.playerPos.x += dx;
        this.playerPos.z += dz;
        this.playerPos.x = Math.max(0, Math.min(133000, this.playerPos.x));
        this.playerPos.z = Math.max(0, Math.min(433000, this.playerPos.z));
        this.playerPos.y = getTerrainHeight(
            this.playerPos.x, this.playerPos.z
        );
    }
}

export { World, CHUNK_SIZE };
