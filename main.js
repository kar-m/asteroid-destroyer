import './style.css'
import * as THREE from 'three';

// --- Scene Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111); // Dark background for space

const camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize( window.innerWidth, window.innerHeight );
document.querySelector('#app').appendChild( renderer.domElement );

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0x404040, 1.5); // Soft white light
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
directionalLight.position.set(5, 10, 7);
scene.add(directionalLight);

// --- Game Objects ---

// --- Earth with "Real" Continents ---
const earthGeometry = new THREE.IcosahedronGeometry(1.5, 1); 
const count = earthGeometry.attributes.position.count;
earthGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));

const color = new THREE.Color();
const posAttr = earthGeometry.attributes.position;
const v = new THREE.Vector3();

for (let i = 0; i < count; i += 3) {
    // Get the position of the first vertex of the triangle to determine "climate"
    v.fromBufferAttribute(posAttr, i);
    
    // --- Pseudo-Noise Logic ---
    // We use sine/cosine waves based on the X, Y, Z position of the triangle.
    // This creates "blobs" of land rather than random speckles.
    const noise = Math.sin(v.x * 1.5) * Math.cos(v.y * 1.5) * Math.sin(v.z * 1.5);
    
    // Adjust this threshold (0.1) to get more or less land
    const isLand = noise > 0.1; 

    if (isLand) {
        color.setHex(0x2e8b57); // Sea Green
    } else {
        color.setHex(0x1338be); // Cobalt Blue
    }

    for (let j = 0; j < 3; j++) {
        earthGeometry.attributes.color.setXYZ(i + j, color.r, color.g, color.b);
    }
}

const earthMaterial = new THREE.MeshPhongMaterial({ 
    vertexColors: true, 
    flatShading: true,
    shininess: 0,
    emissive: 0x000000, // Starts off
    emissiveIntensity: 0
});

const earth = new THREE.Mesh(earthGeometry, earthMaterial);
scene.add(earth);

camera.position.z = 20;

// --- Stars Background ---
function addStars() {
    const starGeometry = new THREE.BufferGeometry();
    const starMaterial = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.1,           // Adjust this to make stars bigger or smaller
        transparent: true,
        opacity: 0.8
    });

    const starVertices = [];
    for (let i = 0; i < 5000; i++) {
        // Randomly scatter stars in a massive sphere around the scene
        const x = (Math.random() - 0.5) * 1000;
        const y = (Math.random() - 0.5) * 1000;
        const z = (Math.random() - 0.5) * 1000;
        starVertices.push(x, y, z);
    }

    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);
    
    return stars; // Returning it in case you want to rotate it later
}

const starField = addStars();

// --- Interaction & Game Logic ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); 

// Game State
let rockets = [];
let asteroids = [];
let score = 0;
let isGameOver = false;
let isAiming = false;
let aimStartPos = new THREE.Vector3();
let aimCurrentPos = new THREE.Vector3();
let lastLaunchTime = 0;
const LAUNCH_COOLDOWN = 500; 
const MAX_ROCKET_SPEED = 0.4; 

// UI Elements
const scoreEl = document.getElementById('score');
const gameOverEl = document.getElementById('game-over');
const restartBtn = document.getElementById('restart');

// --- Visual & Helper Objects ---

// Trajectory Line
const MAX_POINTS = 50;
const trajectoryGeometry = new THREE.BufferGeometry();
const trajPositions = new Float32Array(MAX_POINTS * 3);
trajectoryGeometry.setAttribute('position', new THREE.BufferAttribute(trajPositions, 3));
const trajectoryMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
const trajectoryLine = new THREE.Line(trajectoryGeometry, trajectoryMaterial);
trajectoryLine.visible = false;
scene.add(trajectoryLine);

// Aim Indicator
const aimMarkerGeometry = new THREE.SphereGeometry(0.2, 8, 8);
const aimMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
const aimMarker = new THREE.Mesh(aimMarkerGeometry, aimMarkerMaterial);
aimMarker.visible = false;
scene.add(aimMarker);

// Rocket Class
class Rocket {
    constructor(position, velocity) {
        this.mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(0.2, 0.2, 0.8, 8),
            new THREE.MeshLambertMaterial({ color: 0xffaa00 })
        );
        this.mesh.position.copy(position);
        this.velocity = velocity.clone();
        this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.velocity.clone().normalize());
        scene.add(this.mesh);
        this.alive = true;
        this.totalAngle = 0;
        this.lastAngle = Math.atan2(position.y, position.x);
    }

    update(dt) {
        const dist = this.mesh.position.length();
        const gravityStrength = 0.15 / (dist * dist);
        const gravityDir = this.mesh.position.clone().normalize().negate();
        const gravity = gravityDir.multiplyScalar(gravityStrength);

        this.velocity.add(gravity);
        this.mesh.position.add(this.velocity);

        const currentAngle = Math.atan2(this.mesh.position.y, this.mesh.position.x);
        let deltaAngle = currentAngle - this.lastAngle;
        if (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
        if (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI;
        this.totalAngle += Math.abs(deltaAngle);
        this.lastAngle = currentAngle;

        if (this.totalAngle > 2 * Math.PI) {
            this.kill();
            return false;
        }

        if (this.velocity.lengthSq() > 0.0001) {
             this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.velocity.clone().normalize());
        }

        if (dist < 1.5) {
            this.kill();
            return false;
        }

        if (dist > 50) {
            this.kill();
            return false;
        }
        return true; 
    }

    kill() {
        if (!this.alive) return;
        this.alive = false;
        scene.remove(this.mesh);
    }
}

// Asteroid Class
const ASTEROID_GRAVITY = 0.02;
class Asteroid {
    constructor() {
        const radius = Math.random() * 0.3 + 0.2;
        const detail = 0;
        this.mesh = new THREE.Mesh(
            new THREE.IcosahedronGeometry(radius, detail),
            new THREE.MeshStandardMaterial({ 
                color: 0x888888, 
                roughness: 0.8,
                flatShading: true
            })
        );

        const MU = ASTEROID_GRAVITY;
        const a = Math.random() * 4 + 6;
        const r_p = Math.random() * 0.8 + 0.5;
        const e = 1 - r_p / a;
        const p_orb = a * (1 - e * e);
        const omega = Math.random() * Math.PI * 2;
        const thetaSpawn = Math.random() * (Math.PI * 2 / 3) + (Math.PI * 2 / 3);
        const r = p_orb / (1 + e * Math.cos(thetaSpawn));
        const L = Math.sqrt(MU * p_orb);

        const v_r = (MU / L) * e * Math.sin(thetaSpawn);
        const v_theta = L / r;

        const px = r * Math.cos(thetaSpawn);
        const py = r * Math.sin(thetaSpawn);
        const vx_orb = v_r * Math.cos(thetaSpawn) - v_theta * Math.sin(thetaSpawn);
        const vy_orb = v_r * Math.sin(thetaSpawn) + v_theta * Math.cos(thetaSpawn);

        const cosW = Math.cos(omega);
        const sinW = Math.sin(omega);
        this.mesh.position.set(px * cosW - py * sinW, px * sinW + py * cosW, 0);
        this.velocity = new THREE.Vector3(vx_orb * cosW - vy_orb * sinW, vx_orb * sinW + vy_orb * cosW, 0);

        this.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        this.rotSpeed = new THREE.Vector3(Math.random()*0.01, Math.random()*0.01, Math.random()*0.01);
        
        scene.add(this.mesh);
        this.alive = true;
        this.radius = radius;

        const TRAJ_POINTS = 200;
        const trajGeom = new THREE.BufferGeometry();
        const trajPos = new Float32Array(TRAJ_POINTS * 3);
        trajGeom.setAttribute('position', new THREE.BufferAttribute(trajPos, 3));
        this.trajectoryLine = new THREE.Line(trajGeom, new THREE.LineDashedMaterial({ 
            color: 0xff4444, 
            dashSize: 0.5, 
            gapSize: 0.3,
        }));
        this.trajPointCount = TRAJ_POINTS;
        scene.add(this.trajectoryLine);
        this.updateTrajectoryLine();
    }

    updateTrajectoryLine() {
        const positions = this.trajectoryLine.geometry.attributes.position.array;
        const simPos = this.mesh.position.clone();
        const simVel = this.velocity.clone();
        const stepsPerPoint = 5;
        for (let i = 0; i < this.trajPointCount; i++) {
            positions[i * 3] = simPos.x;
            positions[i * 3 + 1] = simPos.y;
            positions[i * 3 + 2] = simPos.z;
            for (let s = 0; s < stepsPerPoint; s++) {
                const dist = simPos.length();
                if (dist < 1.5) break;
                const gravStr = ASTEROID_GRAVITY / (dist * dist);
                const gravDir = simPos.clone().normalize().negate();
                simVel.add(gravDir.multiplyScalar(gravStr));
                simPos.add(simVel);
            }
            if (simPos.length() < 1.5) {
                for (let j = i + 1; j < this.trajPointCount; j++) {
                    positions[j * 3] = simPos.x;
                    positions[j * 3 + 1] = simPos.y;
                    positions[j * 3 + 2] = simPos.z;
                }
                break;
            }
        }
        this.trajectoryLine.geometry.attributes.position.needsUpdate = true;
        this.trajectoryLine.computeLineDistances();
    }

    update() {
        const dist = this.mesh.position.length();
        const gravStr = ASTEROID_GRAVITY / (dist * dist);
        const gravDir = this.mesh.position.clone().normalize().negate();
        this.velocity.add(gravDir.multiplyScalar(gravStr));

        this.mesh.position.add(this.velocity);
        this.mesh.rotation.x += this.rotSpeed.x;
        this.mesh.rotation.y += this.rotSpeed.y;

        this.updateTrajectoryLine();

        if (this.mesh.position.length() < 1.5 + this.radius) {
           this.kill();
           flashEarth();
           triggerGameOver();
           return false;
        }
        return true;
    }

    kill() {
        if (!this.alive) return;
        this.alive = false;
        scene.remove(this.mesh);
        scene.remove(this.trajectoryLine);
    }
}

// --- Input Handling ---

function getMouseWorldPos(clientX, clientY) {
    mouse.x = (clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const target = new THREE.Vector3();
    const intersect = raycaster.ray.intersectPlane(plane, target);
    return intersect ? target : null;
}

window.addEventListener('mousedown', (event) => {
    if (isGameOver) return;
    const now = Date.now();
    if (now - lastLaunchTime < LAUNCH_COOLDOWN) return;

    const pos = getMouseWorldPos(event.clientX, event.clientY);
    if (pos && pos.length() < 5) { 
        isAiming = true;
        aimStartPos = pos.normalize().multiplyScalar(1.7); 
        aimMarker.position.copy(aimStartPos);
        aimMarker.visible = true;
        trajectoryLine.visible = true;
    }
});

window.addEventListener('mousemove', (event) => {
    if (!isAiming || isGameOver) return;
    const pos = getMouseWorldPos(event.clientX, event.clientY);
    if (pos) {
        aimCurrentPos.copy(pos);
        updateTrajectory();
    }
});

window.addEventListener('mouseup', () => {
    if (!isAiming) return;
    isAiming = false;
    aimMarker.visible = false;
    trajectoryLine.visible = false;
    const velocity = calculateLaunchVelocity();
    rockets.push(new Rocket(aimStartPos.clone(), velocity));
    lastLaunchTime = Date.now();
});

function calculateLaunchVelocity() {
    const dragVector = new THREE.Vector3().subVectors(aimStartPos, aimCurrentPos);
    const launchPower = 0.02; 
    const velocity = dragVector.multiplyScalar(launchPower);
    if (velocity.length() > MAX_ROCKET_SPEED) {
        velocity.normalize().multiplyScalar(MAX_ROCKET_SPEED);
    }
    return velocity;
}

function updateTrajectory() {
    const velocity = calculateLaunchVelocity();
    const simPos = aimStartPos.clone();
    const simVel = velocity.clone();
    const positions = trajectoryLine.geometry.attributes.position.array;
    
    for (let i = 0; i < MAX_POINTS; i++) {
        positions[i * 3] = simPos.x;
        positions[i * 3 + 1] = simPos.y;
        positions[i * 3 + 2] = simPos.z;
        const dist = simPos.length();
        if (i > 0 && dist < 1.5) {
             for (let j = i; j < MAX_POINTS; j++) {
                 positions[j*3] = simPos.x;
                 positions[j*3+1] = simPos.y;
                 positions[j*3+2] = simPos.z;
             }
             break;
        }
        const gravityStrength = 0.15 / (dist * dist);
        const gravityDir = simPos.clone().normalize().negate();
        simVel.add(gravityDir.multiplyScalar(gravityStrength));
        simPos.add(simVel);
    }
    trajectoryLine.geometry.attributes.position.needsUpdate = true;
}

function flashEarth() {
    earth.material.emissive.setHex(0xff0000); // Bright Red
    earth.material.emissiveIntensity = 1;

    // After 200 milliseconds, turn the red glow off
    setTimeout(() => {
        if (earth.material) {
            earth.material.emissive.setHex(0x000000);
            earth.material.emissiveIntensity = 0;
        }
    }, 200);
}

function triggerGameOver() {
    isGameOver = true;
    gameOverEl.style.display = 'block';
    isAiming = false;
    trajectoryLine.visible = false;
    aimMarker.visible = false;
}

function resetGame() {
    asteroids.forEach(a => a.kill());
    rockets.forEach(r => r.kill());
    asteroids = [];
    rockets = [];
    score = 0;
    scoreEl.innerText = 'Score: 0';
    isGameOver = false;
    gameOverEl.style.display = 'none';
    lastLaunchTime = 0;
}

if (restartBtn) restartBtn.addEventListener('click', resetGame);

let spawnTimer = 0;

function animate() {
    requestAnimationFrame(animate);

    // 1. Only run game logic if the game is NOT over
    if (!isGameOver) {
        starField.rotation.y += 0.0002;
        earth.rotation.y += 0.002;
        earth.rotation.x += 0.001;

        spawnTimer++;
        if (asteroids.length === 0 && spawnTimer > 60) {
            asteroids.push(new Asteroid());
            spawnTimer = 0;
        }

        for (let i = rockets.length - 1; i >= 0; i--) {
            if (!rockets[i].update()) {
                rockets.splice(i, 1);
            }
        }

        for (let i = asteroids.length - 1; i >= 0; i--) {
            const asteroid = asteroids[i];
            if (!asteroid.update()) {
                asteroids.splice(i, 1);
                continue;
            }

            for (let j = rockets.length - 1; j >= 0; j--) {
                const rocket = rockets[j];
                const dist = asteroid.mesh.position.distanceTo(rocket.mesh.position);
                if (dist < asteroid.radius + 0.3) { 
                    asteroid.kill();
                    rocket.kill();
                    asteroids.splice(i, 1);
                    rockets.splice(j, 1);
                    score += 10;
                    scoreEl.innerText = 'Score: ' + score;
                    break; 
                }
            }
        }
    }

    // 2. ALWAYS render at the end, so we see the final state/flash
    renderer.render(scene, camera);
}

animate();