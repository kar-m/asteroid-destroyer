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
    v.fromBufferAttribute(posAttr, i);
    const noise = Math.sin(v.x * 1.5) * Math.cos(v.y * 1.5) * Math.sin(v.z * 1.5);
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
    emissive: 0x000000, 
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
        size: 0.1,           
        transparent: true,
        opacity: 0.8
    });

    const starVertices = [];
    for (let i = 0; i < 5000; i++) {
        const x = (Math.random() - 0.5) * 1000;
        const y = (Math.random() - 0.5) * 1000;
        const z = (Math.random() - 0.5) * 1000;
        starVertices.push(x, y, z);
    }

    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);
    
    return stars; 
}

const starField = addStars();

// --- Interaction & Game Logic ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); 

// Game State
let rockets = [];
let asteroids = [];
let explosions = [];
let score = 0;
let isGameOver = false;
let isAiming = false;
let aimStartPos = new THREE.Vector3();
let aimCurrentPos = new THREE.Vector3();
let lastLaunchTime = 0;
let activeSatellite = null; // Track the satellite
const LAUNCH_COOLDOWN = 0; 
const MAX_ROCKET_SPEED = 0.45; 

// UI Elements
const scoreEl = document.getElementById('score');
const gameOverEl = document.getElementById('game-over');
const restartBtn = document.getElementById('restart');

// --- Visual & Helper Objects ---

// Trajectory Line
const MAX_POINTS = 20;
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

// --- Classes ---

class Satellite {
    constructor() {
        const geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
        const material = new THREE.MeshLambertMaterial({ color: 0x00ffff }); // Cyan
        this.mesh = new THREE.Mesh(geometry, material);
        
        this.angle = Math.random() * Math.PI * 2; // Start at a random angle
        this.radius = 2.2; 
        this.orbitSpeed = 0.015;
        
        scene.add(this.mesh);
        this.active = true;
    }

    update() {
        if (!this.active) return;
        this.angle += this.orbitSpeed;
        this.mesh.position.x = Math.cos(this.angle) * this.radius;
        this.mesh.position.y = Math.sin(this.angle) * this.radius;
        this.mesh.rotation.x += 0.02;
        this.mesh.rotation.y += 0.02;
    }

    flashWarning() {
        this.mesh.material.emissive.setHex(0xff0000); // Flash red when blocking
        setTimeout(() => {
            if (this.mesh && this.active) this.mesh.material.emissive.setHex(0x000000);
        }, 200);
    }

    kill() {
        this.active = false;
        scene.remove(this.mesh);
    }
}

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

        let thetaSpawn;
        let r;
        const MIN_SPAWN_DISTANCE = 10.0; 
        do {
            thetaSpawn = Math.random() * Math.PI * 2;
            r = p_orb / (1 + e * Math.cos(thetaSpawn));
        } while (r < MIN_SPAWN_DISTANCE);

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
            explosions.push(new Explosion(this.mesh.position.clone(), 0xff5500, 60));
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

class Explosion {
    constructor(position, colorHex, particleCount = 30) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        
        // We need to store individual velocities for each particle
        this.velocities = [];

        for (let i = 0; i < particleCount; i++) {
            // Start all particles at the exact point of impact
            positions[i * 3] = position.x;
            positions[i * 3 + 1] = position.y;
            positions[i * 3 + 2] = position.z;

            // Give each particle a random direction and speed
            const velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2
            ).normalize().multiplyScalar(Math.random() * 0.15 + 0.05);
            
            this.velocities.push(velocity);
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        const material = new THREE.PointsMaterial({
            color: colorHex,
            size: 0.15, // Size of the "pixels"
            transparent: true,
            opacity: 1.0
        });

        this.mesh = new THREE.Points(geometry, material);
        scene.add(this.mesh);
        this.alive = true;
    }

    update() {
        if (!this.alive) return false;

        const positions = this.mesh.geometry.attributes.position.array;
        
        // Move each particle along its velocity vector
        for (let i = 0; i < this.velocities.length; i++) {
            positions[i * 3] += this.velocities[i].x;
            positions[i * 3 + 1] += this.velocities[i].y;
            positions[i * 3 + 2] += this.velocities[i].z;
        }
        
        // Tell Three.js the positions have changed
        this.mesh.geometry.attributes.position.needsUpdate = true;

        // Fade out the explosion
        this.mesh.material.opacity -= 0.02; 

        // If it is completely transparent, kill it to save memory
        if (this.mesh.material.opacity <= 0) {
            this.kill();
            return false;
        }
        return true;
    }

    kill() {
        if (!this.alive) return;
        this.alive = false;
        scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
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
    if (event.target.tagName === 'BUTTON') return;
    if (isGameOver) return;
    
    const now = Date.now();
    if (now - lastLaunchTime < LAUNCH_COOLDOWN) return;

    const pos = getMouseWorldPos(event.clientX, event.clientY);
    if (pos && pos.length() < 5) { 
        let proposedStartPos = pos.normalize().multiplyScalar(1.7); 

        // Check if satellite blocks the shot
        if (activeSatellite) {
            const dist = proposedStartPos.distanceTo(activeSatellite.mesh.position);
            const BLOCK_RADIUS = 0.8; // Area around satellite where you can't fire
            
            if (dist < BLOCK_RADIUS) {
                activeSatellite.flashWarning(); 
                return; // Stop aiming/firing
            }
        }
        isAiming = true;
        aimStartPos = proposedStartPos;

        aimCurrentPos.copy(aimStartPos);
        updateTrajectory();

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
    const launchPower = 0.04; 
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
    earth.material.emissive.setHex(0xff0000); 
    earth.material.emissiveIntensity = 1;

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
    explosions.forEach(e => e.kill());
    if (activeSatellite) {
        activeSatellite.kill();
        activeSatellite = null;
    }
    asteroids = [];
    rockets = [];
    explosions = [];
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

    if (!isGameOver) {
        starField.rotation.y += 0.0002;
        earth.rotation.y += 0.002;
        earth.rotation.x += 0.001;

        if (activeSatellite) {
            activeSatellite.update();
        }

        spawnTimer++;

        // --- Progressive Difficulty Logic ---
        let maxAsteroids = 1;
        let currentSpawnRate = 60; // 1 second

        // Stage 3: 25+ Asteroids
        if (score >= 250) {
            maxAsteroids = 3;
            currentSpawnRate = 30; // Half second
        // Stage 2: 5+ Asteroids
        } else if (score >= 50) {
            maxAsteroids = 2;
            currentSpawnRate = 45; // 0.75 seconds
        }

        // Spawn Satellite at 15 Asteroids
        if (score >= 150 && !activeSatellite) {
            activeSatellite = new Satellite();
        }

        if (asteroids.length < maxAsteroids && spawnTimer > currentSpawnRate) {
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
                    explosions.push(new Explosion(asteroid.mesh.position.clone(), 0xaaaaaa, 20));
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
    for (let i = explosions.length - 1; i >= 0; i--) {
        if (!explosions[i].update()) {
            explosions.splice(i, 1);
        }
    }

    renderer.render(scene, camera);
}

animate();