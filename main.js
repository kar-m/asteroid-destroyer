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
// Earth
// Icosahedron with detail 1 gives a bit more roundness but still low poly (80 faces). Detail 0 is 20 faces.
// User asked for 20-30 triangles. Detail 0 is 20 faces.
const earthGeometry = new THREE.IcosahedronGeometry(1.5, 1); // Smaller Earth, detail 1 = 80 faces
const earthMaterial = new THREE.MeshPhongMaterial({ 
    color: 0x2a9d8f, // Blue-green
    flatShading: true,
    shininess: 0
});
const earth = new THREE.Mesh(earthGeometry, earthMaterial);
scene.add(earth);

camera.position.z = 20; // Move camera back to see more field

// --- Interaction & Game Logic ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // Z=0 plane

// Game State
let rockets = [];
let asteroids = [];
let score = 0;
let isGameOver = false;
let isAiming = false;
let aimStartPos = new THREE.Vector3();
let aimCurrentPos = new THREE.Vector3();
let lastLaunchTime = 0;
const LAUNCH_COOLDOWN = 500; // ms
const MAX_ROCKET_SPEED = 0.4; // Cap max launch velocity

// UI Elements
const scoreEl = document.getElementById('score');
const gameOverEl = document.getElementById('game-over');
const restartBtn = document.getElementById('restart');

// --- Visual & Helper Objects ---

// Trajectory Line
const MAX_POINTS = 50;
const trajectoryGeometry = new THREE.BufferGeometry();
const positions = new Float32Array(MAX_POINTS * 3);
trajectoryGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
const trajectoryMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
const trajectoryLine = new THREE.Line(trajectoryGeometry, trajectoryMaterial);
trajectoryLine.visible = false;
scene.add(trajectoryLine);

// Aim Indicator (Where user clicks on Earth)
const aimMarkerGeometry = new THREE.SphereGeometry(0.2, 8, 8);
const aimMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
const aimMarker = new THREE.Mesh(aimMarkerGeometry, aimMarkerMaterial);
aimMarker.visible = false;
scene.add(aimMarker);

// Rocket Class
class Rocket {
    constructor(position, velocity) {
        // Bigger Rocket: Radius 0.2, Length 0.8
        this.mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(0.2, 0.2, 0.8, 8),
            new THREE.MeshLambertMaterial({ color: 0xffaa00 })
        );
        this.mesh.position.copy(position);
        this.velocity = velocity.clone();
        this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.velocity.clone().normalize());
        scene.add(this.mesh);
        this.alive = true;
        // Track angle for revolution detection
        this.totalAngle = 0;
        this.lastAngle = Math.atan2(position.y, position.x);
    }

    update(dt) {
        // Gravity (slower)
        const dist = this.mesh.position.length();
        const gravityStrength = 0.15 / (dist * dist);
        const gravityDir = this.mesh.position.clone().normalize().negate();
        const gravity = gravityDir.multiplyScalar(gravityStrength);

        this.velocity.add(gravity);
        this.mesh.position.add(this.velocity);

        // Track revolution
        const currentAngle = Math.atan2(this.mesh.position.y, this.mesh.position.x);
        let deltaAngle = currentAngle - this.lastAngle;
        // Handle wrap-around at ±π
        if (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
        if (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI;
        this.totalAngle += Math.abs(deltaAngle);
        this.lastAngle = currentAngle;

        // Destroy after one full revolution
        if (this.totalAngle > 2 * Math.PI) {
            this.kill();
            return false;
        }

        // Update Orientation to face velocity
        if (this.velocity.lengthSq() > 0.0001) {
             this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.velocity.clone().normalize());
        }

        // Collision with Earth
        if (dist < 1.5) {
            this.kill();
            return false;
        }

        // Remove if too far
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
const ASTEROID_GRAVITY = 0.02; // Gravity parameter (μ) for asteroids
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

        // --- Keplerian Orbit ---
        // Generate a random elliptical orbit whose periapsis is within Earth
        const MU = ASTEROID_GRAVITY;
        const a = Math.random() * 4 + 6;      // Semi-major axis: 6-10 units
        const r_p = Math.random() * 0.8 + 0.5; // Periapsis: 0.5-1.3 (inside Earth r=1.5)
        const e = 1 - r_p / a;                 // Eccentricity (~0.78-0.95, elliptical)
        const p_orb = a * (1 - e * e);         // Semi-latus rectum
        const omega = Math.random() * Math.PI * 2; // Random orbit orientation

        // Spawn at a random true anomaly on the far side (away from Earth)
        // θ ∈ [120°, 240°] → asteroid is far from periapsis (Earth)
        const thetaSpawn = Math.random() * (Math.PI * 2 / 3) + (Math.PI * 2 / 3);

        // Position at this point on the orbit
        const r = p_orb / (1 + e * Math.cos(thetaSpawn));

        // Specific angular momentum
        const L = Math.sqrt(MU * p_orb);

        // Velocity in polar coordinates (orbital frame)
        const v_r = (MU / L) * e * Math.sin(thetaSpawn);     // Radial
        const v_theta = L / r;                                // Tangential

        // Convert to Cartesian in orbital frame (periapsis along +x)
        const px = r * Math.cos(thetaSpawn);
        const py = r * Math.sin(thetaSpawn);
        const vx_orb = v_r * Math.cos(thetaSpawn) - v_theta * Math.sin(thetaSpawn);
        const vy_orb = v_r * Math.sin(thetaSpawn) + v_theta * Math.cos(thetaSpawn);

        // Rotate by omega to world frame
        const cosW = Math.cos(omega);
        const sinW = Math.sin(omega);
        this.mesh.position.set(
            px * cosW - py * sinW,
            px * sinW + py * cosW,
            0
        );
        this.velocity = new THREE.Vector3(
            vx_orb * cosW - vy_orb * sinW,
            vx_orb * sinW + vy_orb * cosW,
            0
        );

        // Random tumble
        this.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        this.rotSpeed = new THREE.Vector3(Math.random()*0.01, Math.random()*0.01, Math.random()*0.01);
        
        scene.add(this.mesh);
        this.alive = true;
        this.radius = radius;
        this.mass = radius * 2;

        // Trajectory visualization — curved path simulation
        const TRAJ_POINTS = 200;
        const trajGeom = new THREE.BufferGeometry();
        const trajPositions = new Float32Array(TRAJ_POINTS * 3);
        trajGeom.setAttribute('position', new THREE.BufferAttribute(trajPositions, 3));
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
        const stepsPerPoint = 5; // Skip frames to cover more distance
        for (let i = 0; i < this.trajPointCount; i++) {
            positions[i * 3] = simPos.x;
            positions[i * 3 + 1] = simPos.y;
            positions[i * 3 + 2] = simPos.z;
            // Simulate multiple steps per point for longer reach
            for (let s = 0; s < stepsPerPoint; s++) {
                const dist = simPos.length();
                if (dist < 1.5) break; // Hit Earth
                const gravStr = ASTEROID_GRAVITY / (dist * dist);
                const gravDir = simPos.clone().normalize().negate();
                simVel.add(gravDir.multiplyScalar(gravStr));
                simPos.add(simVel);
            }
            // Stop drawing at Earth
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
        // Apply gravity toward Earth
        const dist = this.mesh.position.length();
        const gravStr = ASTEROID_GRAVITY / (dist * dist);
        const gravDir = this.mesh.position.clone().normalize().negate();
        this.velocity.add(gravDir.multiplyScalar(gravStr));

        this.mesh.position.add(this.velocity);
        this.mesh.rotation.x += this.rotSpeed.x;
        this.mesh.rotation.y += this.rotSpeed.y;

        // Update trajectory line
        this.updateTrajectoryLine();

        // Check earth collision (Earth radius approx 2)
        if (this.mesh.position.length() < 1.5 + this.radius) {
           this.kill();
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
    if (pos && pos.length() < 5) { // Click needs to be near Earth
        isAiming = true;
        // Project onto Earth sphere (radius 2)
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
    
    // Launch
    const velocity = calculateLaunchVelocity();
    rockets.push(new Rocket(aimStartPos.clone(), velocity));
    lastLaunchTime = Date.now();
});

function calculateLaunchVelocity() {
    // Vector from Mouse to Start (Pull back to shoot)
    const dragVector = new THREE.Vector3().subVectors(aimStartPos, aimCurrentPos);
    // Slower launch power
    const launchPower = 0.02; 
    const velocity = dragVector.multiplyScalar(launchPower);
    // Clamp to max speed
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
    
    // Simulate steps
    for (let i = 0; i < MAX_POINTS; i++) {
        positions[i * 3] = simPos.x;
        positions[i * 3 + 1] = simPos.y;
        positions[i * 3 + 2] = simPos.z;

        // Physics Step (same as Rocket.update)
        const dist = simPos.length();
        // If crash into earth
        if (i > 0 && dist < 1.5) {
             for (let j = i; j < MAX_POINTS; j++) {
                 positions[j*3] = simPos.x;
                 positions[j*3+1] = simPos.y;
                 positions[j*3+2] = simPos.z;
             }
             break;
        }

        const gravityStrength = 0.15 / (dist * dist); // Match rocket gravity
        const gravityDir = simPos.clone().normalize().negate();
        simVel.add(gravityDir.multiplyScalar(gravityStrength));
        simPos.add(simVel);
    }
    trajectoryLine.geometry.attributes.position.needsUpdate = true;
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
    
    if (isGameOver) return;

    // Slow rotation for Earth
    earth.rotation.y += 0.002;
    earth.rotation.x += 0.001;

    // Spawn Asteroids — only one at a time
    spawnTimer++;
    if (asteroids.length === 0 && spawnTimer > 60) { // Wait ~1 second after last one is destroyed
        asteroids.push(new Asteroid());
        spawnTimer = 0;
    }

    // Update rockets
    for (let i = rockets.length - 1; i >= 0; i--) {
        if (!rockets[i].update()) {
            rockets.splice(i, 1);
        }
    }

    // Update asteroids and collision
    for (let i = asteroids.length - 1; i >= 0; i--) {
        const asteroid = asteroids[i];
        if (!asteroid.update()) {
            asteroids.splice(i, 1);
            continue;
        }

        // Check Collision with Rockets
        for (let j = rockets.length - 1; j >= 0; j--) {
            const rocket = rockets[j];
            const dist = asteroid.mesh.position.distanceTo(rocket.mesh.position);
            // More forgiving collision (Rocket radius 0.2 + Asteroid Radius)
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

	renderer.render( scene, camera );
}

animate(); 
