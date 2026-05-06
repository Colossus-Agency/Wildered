import { Renderer } from '../renderer/renderer.js';
import { World } from '../../game/world/world.js';

class WilderedEngine {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.gl = this.canvas.getContext('webgl2');

        if (!this.gl) {
            alert('WebGL2 not supported');
            return;
        }

        this.running = false;
        this.lastTime = 0;

        this.world = new World(this.gl);
        this.renderer = new Renderer(this.gl, this.canvas);

        window.addEventListener('resize', () => this.resize());
        this.resize();
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        if (this.renderer) {
            this.renderer.updateProjection(
                this.canvas.width,
                this.canvas.height
            );
        }
    }

    start() {
        this.running = true;
        this.lastTime = performance.now();
        requestAnimationFrame(t => this.loop(t));
        console.log('Wildered Engine started');
    }

    loop(timestamp) {
        if (!this.running) return;
        const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05);
        this.lastTime = timestamp;

        this.world.update(dt);
        this.renderer.update(dt, this.world);
        this.renderer.render(this.world);

        requestAnimationFrame(t => this.loop(t));
    }
}

const engine = new WilderedEngine();
engine.start();

export { WilderedEngine };
