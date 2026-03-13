import './style.css'
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

let rocketModel = null;
let winRocketModel = null;
const loader = new GLTFLoader();
loader.load('/shoot_rocket.glb', (gltf) => {
    rocketModel = gltf.scene;
        });
loader.load('/retrofuturistic_toy_rocket.glb', (gltf) => {
    winRocketModel = gltf.scene;
});

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111); 
const camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.querySelector('#app').appendChild( renderer.domElement );

const ambientLight = new THREE.AmbientLight(0x404040, 1.5); scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
directionalLight.position.set(5, 10, 7);
scene.add(directionalLight);


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
        color.setHex(0x2e8b57);     } else {
        color.setHex(0x1338be);     }

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

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); 

let rockets = [];
let asteroids = [];
let explosions = [];
let score = 0;
let isGameOver = false;
let isTimeStopped = false;
let activePowerup = null;
let isWinningSequence = false;
let winRocketInstance = null;
let isAiming = false;
let aimStartPos = new THREE.Vector3();
let aimCurrentPos = new THREE.Vector3();
let lastLaunchTime = 0;
let activeSatellite = null; const LAUNCH_COOLDOWN = 0; 
const MAX_ROCKET_SPEED = 0.45; 

const scoreEl = document.getElementById('score');
const gameOverEl = document.getElementById('game-over');
const restartBtn = document.getElementById('restart');
const powerupBombBtn = document.getElementById('powerup-bomb');
const powerupLaserBtn = document.getElementById('powerup-laser');
const powerupRocketBtn = document.getElementById('powerup-rocket');

function updateUI() {
    if (score >= 20) powerupBombBtn.classList.remove('disabled');
    else powerupBombBtn.classList.add('disabled');
    if (score >= 50) powerupLaserBtn.classList.remove('disabled');
    else powerupLaserBtn.classList.add('disabled');
    if (score >= 250) powerupRocketBtn.classList.remove('disabled');
    else powerupRocketBtn.classList.add('disabled');
}
updateUI();


const MAX_POINTS = 20;
const trajectoryGeometry = new THREE.BufferGeometry();
const trajPositions = new Float32Array(MAX_POINTS * 3);
trajectoryGeometry.setAttribute('position', new THREE.BufferAttribute(trajPositions, 3));
const trajectoryMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
const trajectoryLine = new THREE.Line(trajectoryGeometry, trajectoryMaterial);
trajectoryLine.visible = false;
scene.add(trajectoryLine);

const aimMarkerGeometry = new THREE.SphereGeometry(0.2, 8, 8);
const aimMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
const aimMarker = new THREE.Mesh(aimMarkerGeometry, aimMarkerMaterial);
aimMarker.visible = false;
scene.add(aimMarker);

const hoverMarkerGeo = new THREE.SphereGeometry(0.1, 8, 8);
const hoverMarkerMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const hoverMarker = new THREE.Mesh(hoverMarkerGeo, hoverMarkerMat);
hoverMarker.visible = false;
scene.add(hoverMarker);

const ghostLaserGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,0)]);
const ghostLaserMat = new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 1, transparent: true, opacity: 0.5 });
const ghostLaserLine = new THREE.Line(ghostLaserGeo, ghostLaserMat);
ghostLaserLine.visible = false;
scene.add(ghostLaserLine);


class Satellite {
    constructor() {
        const geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
        const material = new THREE.MeshLambertMaterial({ color: 0x00ffff });         this.mesh = new THREE.Mesh(geometry, material);
        
        this.angle = Math.random() * Math.PI * 2;         this.radius = 2.2; 
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
        this.mesh.material.emissive.setHex(0xff0000);         setTimeout(() => {
            if (this.mesh && this.active) this.mesh.material.emissive.setHex(0x000000);
        }, 200);
    }

    kill() {
        this.active = false;
        scene.remove(this.mesh);
    }
}

class Rocket {
    constructor(position, velocity) {
        if (rocketModel) {
            this.mesh = rocketModel.clone();
            this.mesh.scale.set(0.05, 0.05, 0.05);         } else {
            this.mesh = new THREE.Mesh(
                new THREE.CylinderGeometry(0.2, 0.2, 0.8, 8),
                new THREE.MeshLambertMaterial({ color: 0xffaa00 })
            );
        }
        this.mesh.position.copy(position);
        this.velocity = velocity.clone();
        
                const targetQuaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.velocity.clone().normalize());
        this.mesh.quaternion.copy(targetQuaternion);
        
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
        
                this.velocities = [];

        for (let i = 0; i < particleCount; i++) {
                        positions[i * 3] = position.x;
            positions[i * 3 + 1] = position.y;
            positions[i * 3 + 2] = position.z;

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
            size: 0.15,             transparent: true,
            opacity: 1.0
        });

        this.mesh = new THREE.Points(geometry, material);
        scene.add(this.mesh);
        this.alive = true;
    }

    update() {
        if (!this.alive) return false;

        const positions = this.mesh.geometry.attributes.position.array;
        
                for (let i = 0; i < this.velocities.length; i++) {
            positions[i * 3] += this.velocities[i].x;
            positions[i * 3 + 1] += this.velocities[i].y;
            positions[i * 3 + 2] += this.velocities[i].z;
        }
        
                this.mesh.geometry.attributes.position.needsUpdate = true;

                this.mesh.material.opacity -= 0.02; 

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


function getMouseWorldPos(clientX, clientY) {
    mouse.x = (clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const target = new THREE.Vector3();
    const intersect = raycaster.ray.intersectPlane(plane, target);
    return intersect ? target : null;
}

powerupBombBtn.addEventListener('click', () => {
    if (score >= 20 && !activePowerup && !isGameOver) {
        score -= 20;
        scoreEl.innerText = 'Score: ' + score;
        activePowerup = 'bomb';
        isTimeStopped = true;
        powerupBombBtn.classList.add('active');
        updateUI();
    }
});

powerupLaserBtn.addEventListener('click', () => {
    if (score >= 50 && !activePowerup && !isGameOver) {
        score -= 50;
        scoreEl.innerText = 'Score: ' + score;
        activePowerup = 'laser';
        isTimeStopped = true;
        powerupLaserBtn.classList.add('active');
        updateUI();
    }
});

powerupRocketBtn.addEventListener('click', () => {
    if (score >= 250 && !activePowerup && !isGameOver) {
        score -= 250;
        scoreEl.innerText = 'Score: ' + score;
        triggerWinSequence();
        updateUI();
    }
});

window.addEventListener('mousedown', (event) => {
    if (event.target.closest('#powerups')) return;
    if (event.target.tagName === 'BUTTON') return;
    if (isGameOver) return;
    
    if (activePowerup) {
        const pos = getMouseWorldPos(event.clientX, event.clientY);
        if (pos) {
            if (activePowerup === 'bomb') {
                triggerBomb(pos);
            } else if (activePowerup === 'laser') {
                triggerLaser(pos);
            }
            activePowerup = null;
            isTimeStopped = false;
            powerupBombBtn.classList.remove('active');
            powerupLaserBtn.classList.remove('active');
            ghostLaserLine.visible = false;
        }
        return;
    }

    const now = Date.now();
    if (now - lastLaunchTime < LAUNCH_COOLDOWN) return;

    if (!isAiming && !isGameOver && hoverMarker.visible) {
        if (hoverMarker.material.color.getHex() === 0xff0000) {
            if (activeSatellite) activeSatellite.flashWarning();
            return;
        }
        
        isAiming = true;
        aimStartPos.copy(hoverMarker.position);
        aimCurrentPos.copy(aimStartPos);
        updateTrajectory();
        aimMarker.position.copy(aimStartPos);
        aimMarker.visible = true;
        trajectoryLine.visible = true;
    }
});

window.addEventListener('mousemove', (event) => {
    if (isGameOver) return;

    if (activePowerup) {
        hoverMarker.visible = false;
        
        if (activePowerup === 'laser') {
            const pos = getMouseWorldPos(event.clientX, event.clientY);
            if (pos) {
                const direction = pos.clone().normalize();
                const farPoint = direction.clone().multiplyScalar(50);
                ghostLaserLine.geometry.setFromPoints([new THREE.Vector3(0,0,0), farPoint]);
                ghostLaserLine.geometry.attributes.position.needsUpdate = true;
                ghostLaserLine.visible = true;
            } else {
                ghostLaserLine.visible = false;
            }
        }
        return;
    }

    if (!isAiming) {
        const pos = getMouseWorldPos(event.clientX, event.clientY);
        if (pos && pos.length() < 5) {
            let proposedStartPos = pos.normalize().multiplyScalar(1.7);
            
            let isBlocked = false;
            if (activeSatellite) {
                const dist = proposedStartPos.distanceTo(activeSatellite.mesh.position);
                const BLOCK_RADIUS = 0.8; 
                if (dist < BLOCK_RADIUS) {
                    isBlocked = true;
                }
            }
            
            hoverMarker.position.copy(proposedStartPos);
            hoverMarker.material.color.setHex(isBlocked ? 0xff0000 : 0x00ff00);
            hoverMarker.visible = true;
        } else {
            hoverMarker.visible = false;
        }
    } else {
        hoverMarker.visible = false;
        const pos = getMouseWorldPos(event.clientX, event.clientY);
        if (pos) {
            aimCurrentPos.copy(pos);
            updateTrajectory();
        }
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

function triggerBomb(pos) {
    const BOMB_RADIUS = 3.0; 
    explosions.push(new Explosion(pos.clone(), 0xff4400, 100));
    
    for (let i = asteroids.length - 1; i >= 0; i--) {
        const asteroid = asteroids[i];
        if (asteroid.mesh.position.distanceTo(pos) < BOMB_RADIUS) {
            explosions.push(new Explosion(asteroid.mesh.position.clone(), 0xaaaaaa, 20));
            asteroid.kill();
            asteroids.splice(i, 1);
            score += 10; 
        }
    }
    scoreEl.innerText = 'Score: ' + score;
    updateUI();
}

function triggerLaser(pos) {
    const origin = new THREE.Vector3(0,0,0);
    const direction = pos.clone().normalize();
    
    const laserGeo = new THREE.BufferGeometry().setFromPoints([origin, direction.clone().multiplyScalar(50)]);
    const laserMat = new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 3 });
    const laserLine = new THREE.Line(laserGeo, laserMat);
    scene.add(laserLine);
    
    setTimeout(() => {
        scene.remove(laserLine);
        laserGeo.dispose();
        laserMat.dispose();
    }, 300);

    const ray = new THREE.Ray(origin, direction);
    
    for (let i = asteroids.length - 1; i >= 0; i--) {
        const asteroid = asteroids[i];
        const distanceSq = ray.distanceSqToPoint(asteroid.mesh.position);
        if (distanceSq < (asteroid.radius + 0.3) * (asteroid.radius + 0.3)) {
            const dot = direction.dot(asteroid.mesh.position);
            if (dot > 0) {
                explosions.push(new Explosion(asteroid.mesh.position.clone(), 0xaaaaaa, 20));
                asteroid.kill();
                asteroids.splice(i, 1);
                score += 10;
            }
        }
    }
    scoreEl.innerText = 'Score: ' + score;
    updateUI();
}

function triggerWinSequence() {
    isWinningSequence = true;
    isTimeStopped = true;
    
    if (winRocketModel) {
        winRocketInstance = winRocketModel.clone();
        winRocketInstance.scale.set(1.5, 1.5, 1.5);     } else {
        winRocketInstance = new THREE.Mesh(
            new THREE.CylinderGeometry(0.5, 0.5, 2, 8),
            new THREE.MeshLambertMaterial({ color: 0x00ff00 })
        );
    }
    
        const winLight = new THREE.DirectionalLight(0xffffff, 3);
    winLight.position.set(0, 0, 10);
    scene.add(winLight);
    
    winRocketInstance.position.set(0, 1, -2.5);     winRocketInstance.userData = { time: 0, light: winLight };
    scene.add(winRocketInstance);
    
        const dir = new THREE.Vector3(0, 1, 1).normalize();
    winRocketInstance.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    
        winRocketInstance.rotateY(Math.PI / 4);
}

function triggerWinGameOver() {
    isGameOver = true;
    gameOverEl.style.display = 'block';
    gameOverEl.querySelector('h1').innerText = 'YOU WIN!';
    gameOverEl.querySelector('p').innerText = 'HUMANITY IS SAVED';
    gameOverEl.querySelector('h1').style.color = '#2a9d8f';
    isAiming = false;
    trajectoryLine.visible = false;
    aimMarker.visible = false;
}

window.addEventListener('keydown', (event) => {
    if (event.key === 'b' || event.key === 'B') {
        score += 50;
        scoreEl.innerText = 'Score: ' + score;
        updateUI();
    }
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
    isTimeStopped = false;
    activePowerup = null;
    isWinningSequence = false;
    if (winRocketInstance) {
        if (winRocketInstance.userData.light) {
            scene.remove(winRocketInstance.userData.light);
        }
        scene.remove(winRocketInstance);
        winRocketInstance = null;
    }
    powerupBombBtn.classList.remove('active');
    powerupLaserBtn.classList.remove('active');
    updateUI();
    
    gameOverEl.style.display = 'none';
    gameOverEl.querySelector('h1').innerText = 'GAME OVER';
    gameOverEl.querySelector('p').innerText = 'EARTH HAS BEEN DESTROYED';
    gameOverEl.querySelector('h1').style.color = '#ff4444';
    lastLaunchTime = 0;
}

if (restartBtn) restartBtn.addEventListener('click', resetGame);

let spawnTimer = 0;

function animate() {
    requestAnimationFrame(animate);

    if (!isGameOver && !isTimeStopped) {
        starField.rotation.y += 0.0002;
        earth.rotation.y += 0.002;
        earth.rotation.x += 0.001;

        if (activeSatellite) {
            activeSatellite.update();
        }

        spawnTimer++;

        let maxAsteroids = 1;
        let currentSpawnRate = 60;

        if (score >= 250) {
            maxAsteroids = 3;
            currentSpawnRate = 30;
        } else if (score >= 50) {
            maxAsteroids = 2;
            currentSpawnRate = 45;
        }

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
                    updateUI();
                    break; 
                }
            }
        }
    }
    
    if (isWinningSequence && winRocketInstance) {
        winRocketInstance.position.y += 0.05; 
        winRocketInstance.position.z += 0.06;         winRocketInstance.userData.time += 0.016;
        if (winRocketInstance.userData.time > 2) {             isWinningSequence = false;
            triggerWinGameOver();
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