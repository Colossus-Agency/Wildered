import { mat4 } from 'gl-matrix';

class Renderer {
    constructor(gl, canvas) {
        this.gl = gl;
        this.canvas = canvas;

        this.projectionMatrix = mat4.create();
        this.viewMatrix = mat4.create();

        this.camera = {
            position: new Float64Array([30000, 400, 30000]),
            fov: 60,
            near: 0.1,
            far: 50000,
            yaw: 0,
            pitch: -0.5,
            distance: 800,
            orbitTarget: new Float64Array([30000, 0, 30000])
        };

        this.renderOrigin = new Float64Array([30000, 0, 30000]);

        this.keys = {};
        this.mouse = { down: false };
        this.setupInput();
        this.setupGL();
        this.updateProjection(canvas.width, canvas.height);
    }

    setupInput() {
        window.addEventListener('keydown', e => {
            this.keys[e.key.toLowerCase()] = true;
        });
        window.addEventListener('keyup', e => {
            this.keys[e.key.toLowerCase()] = false;
        });

        this.canvas.addEventListener('mousedown', () => {
            this.mouse.down = true;
        });
        window.addEventListener('mouseup', () => {
            this.mouse.down = false;
        });
        window.addEventListener('mousemove', e => {
            if (this.mouse.down) {
                this.camera.yaw -= e.movementX * 0.005;
                this.camera.pitch -= e.movementY * 0.005;
                this.camera.pitch = Math.max(-1.4,
                    Math.min(-0.05, this.camera.pitch));
            }
        });

        window.addEventListener('wheel', e => {
            this.camera.distance *= 1 + e.deltaY * 0.001;
            this.camera.distance = Math.max(50,
                Math.min(8000, this.camera.distance));
        });

        // Touch for iPad
        let lastTouchDist = 0;
        let lastTouch = null;
        this.canvas.addEventListener('touchstart', e => {
            if (e.touches.length === 1) lastTouch = e.touches[0];
            if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                lastTouchDist = Math.sqrt(dx*dx + dy*dy);
            }
        });
        this.canvas.addEventListener('touchmove', e => {
            e.preventDefault();
            if (e.touches.length === 1 && lastTouch) {
                const dx = e.touches[0].clientX - lastTouch.clientX;
                const dy = e.touches[0].clientY - lastTouch.clientY;
                this.camera.yaw -= dx * 0.005;
                this.camera.pitch -= dy * 0.005;
                this.camera.pitch = Math.max(-1.4,
                    Math.min(-0.05, this.camera.pitch));
                lastTouch = e.touches[0];
            }
            if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.sqrt(dx*dx + dy*dy);
                this.camera.distance *= lastTouchDist / dist;
                this.camera.distance = Math.max(50,
                    Math.min(8000, this.camera.distance));
                lastTouchDist = dist;
            }
        }, { passive: false });
    }

    setupGL() {
        const gl = this.gl;
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0.52, 0.73, 0.92, 1.0);
    }

    updateProjection(width, height) {
        mat4.perspective(
            this.projectionMatrix,
            this.camera.fov * Math.PI / 180,
            width / height,
            this.camera.near,
            this.camera.far
        );
    }

    update(deltaTime, world) {
        const speed = 300 * deltaTime;
        const cam = this.camera;

        const forward = [Math.sin(cam.yaw), 0, Math.cos(cam.yaw)];
        const right = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];

        if (this.keys['w']) {
            cam.orbitTarget[0] += forward[0] * speed;
            cam.orbitTarget[2] += forward[2] * speed;
        }
        if (this.keys['s']) {
            cam.orbitTarget[0] -= forward[0] * speed;
            cam.orbitTarget[2] -= forward[2] * speed;
        }
        if (this.keys['a']) {
            cam.orbitTarget[0] -= right[0] * speed;
            cam.orbitTarget[2] -= right[2] * speed;
        }
        if (this.keys['d']) {
            cam.orbitTarget[0] += right[0] * speed;
            cam.orbitTarget[2] += right[2] * speed;
        }

        world.playerPos.x = cam.orbitTarget[0];
        world.playerPos.z = cam.orbitTarget[2];

        cam.position[0] = cam.orbitTarget[0] +
            cam.distance * Math.sin(cam.yaw) * Math.cos(cam.pitch);
        cam.position[1] = cam.orbitTarget[1] +
            cam.distance * Math.sin(-cam.pitch);
        cam.position[2] = cam.orbitTarget[2] +
            cam.distance * Math.cos(cam.yaw) * Math.cos(cam.pitch);

        this.checkOriginReset();

        const rx = cam.position[0] - this.renderOrigin[0];
        const ry = cam.position[1] - this.renderOrigin[1];
        const rz = cam.position[2] - this.renderOrigin[2];
        const tx = cam.orbitTarget[0] - this.renderOrigin[0];
        const ty = cam.orbitTarget[1] - this.renderOrigin[1];
        const tz = cam.orbitTarget[2] - this.renderOrigin[2];

        mat4.lookAt(
            this.viewMatrix,
            [rx, ry, rz],
            [tx, ty, tz],
            [0, 1, 0]
        );
    }

    checkOriginReset() {
        const dx = this.camera.position[0] - this.renderOrigin[0];
        const dz = this.camera.position[2] - this.renderOrigin[2];
        if (dx*dx + dz*dz > 1000*1000) {
            this.renderOrigin[0] = this.camera.position[0];
            this.renderOrigin[1] = this.camera.position[1];
            this.renderOrigin[2] = this.camera.position[2];
            return true;
        }
        return false;
    }

    render(world) {
        const gl = this.gl;
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        world.render(
            gl,
            this.projectionMatrix,
            this.viewMatrix,
            this.renderOrigin,
            this.camera,
            false
        );
    }
}

export { Renderer };
