import * as THREE from 'three';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';

let container;
let camera, scene, renderer;
let controller1, controller2;
let controllerGrip1, controllerGrip2;
let hand1, hand2;

let reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;
let portalGroup = null;
let portalPlaced = false;

// Mine Elements
let tunnelGroup;
let pickaxe;
const tunnelWidth = 4;
const tunnelHeight = 3;
const tunnelDepth = 30;

let listener;
let hitSound;
let pickaxeEquipped = false;
let swingProgress = 0;
const clock = new THREE.Clock();

// Fallback Mode Variables
let isFallbackMode = false;
let moveForward = false;
let moveBackward = false;
let turnLeft = false;
let turnRight = false;
const moveSpeed = 3.0; // units per second
const turnSpeed = 1.2; // radians per second
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };
let camYaw = 0;
let camPitch = 0;

const pointLights = [];

let minerGroup;
let minerHead;
let minerRightArm;
let minerLampLight;

// Elevator (Cage) variables
let elevatorState = 'BEFORE_START'; // 'BEFORE_START', 'DESCENDING', 'ARRIVED', 'OPENING', 'FINISHED'
let elevatorGroup;
let leftGateMesh, rightGateMesh;         // Front gates (facing the mine)
let backLeftGateMesh, backRightGateMesh; // Back gates (facing the entry)
let shaftMesh, shaftTex, shaftBack;
let elevatorRumbleSound, elevatorGateSound;
let elevatorTime = 0;
const coalBlocks = [];
const miningParticles = [];

init();
animate();

function init() {
    container = document.createElement('div');
    document.body.appendChild(container);

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);

    listener = new THREE.AudioListener();
    camera.add(listener);
    
    const headlamp = new THREE.SpotLight(0xffedd0, 5, 20, Math.PI/4, 0.2, 1);
    headlamp.position.set(0, 0, 0);
    headlamp.target.position.set(0, 0, -1);
    camera.add(headlamp);
    camera.add(headlamp.target);
    scene.add(camera);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);

    document.body.appendChild(ARButton.createButton(renderer, {
        requiredFeatures: ['hit-test']
    }));

    createSounds();
    createElevatorSounds();

    // Setup AR Reticle
    const reticleGeometry = new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2);
    const reticleMaterial = new THREE.MeshBasicMaterial({ color: 0x0aff0a });
    reticle = new THREE.Mesh(reticleGeometry, reticleMaterial);
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    // Setup Controllers
    function onSelectStart() {
        if (!portalPlaced && !isFallbackMode) {
            placePortal();
        } else if (pickaxeEquipped) {
            swingPickaxe();
        } else {
            tryGrabPickaxe(this);
        }
    }

    controller1 = renderer.xr.getController(0);
    controller1.addEventListener('selectstart', onSelectStart);
    scene.add(controller1);

    controller2 = renderer.xr.getController(1);
    controller2.addEventListener('selectstart', onSelectStart);
    scene.add(controller2);

    const controllerModelFactory = new XRControllerModelFactory();
    const handModelFactory = new XRHandModelFactory();

    controllerGrip1 = renderer.xr.getControllerGrip(0);
    controllerGrip1.add(controllerModelFactory.createControllerModel(controllerGrip1));
    scene.add(controllerGrip1);

    hand1 = renderer.xr.getHand(0);
    hand1.add(handModelFactory.createHandModel(hand1, "mesh"));
    scene.add(hand1);

    controllerGrip2 = renderer.xr.getControllerGrip(1);
    controllerGrip2.add(controllerModelFactory.createControllerModel(controllerGrip2));
    scene.add(controllerGrip2);

    hand2 = renderer.xr.getHand(1);
    hand2.add(handModelFactory.createHandModel(hand2, "mesh"));
    scene.add(hand2);

    // Build Mine
    portalGroup = new THREE.Group();
    buildMine();
    portalGroup.visible = false;
    scene.add(portalGroup);

    window.addEventListener('resize', onWindowResize);

    // Bind Fallback Start
    document.getElementById('btn-fallback').addEventListener('click', startFallbackMode);
    
    // Bind USDZ Export
    document.getElementById('btn-usdz').addEventListener('click', exportToUSDZ);
}

async function exportToUSDZ() {
    const btn = document.getElementById('btn-usdz');
    btn.textContent = "Generiram USDZ (prosim počakajte)...";
    btn.disabled = true;

    try {
        const exporter = new USDZExporter();
        
        // Setup simple representation for export by making it at origin and visible
        const exportScene = tunnelGroup.clone(true);
        exportScene.position.set(0, 0, 0);
        exportScene.quaternion.identity();
        
        // Remove Points, Lights, and Lines because USDZ Exporter does not serialize them natively 
        // in a stable way and we want to ensure the file saves fully for Quick Look.
        const objectsToRemove = [];
        exportScene.traverse((child) => {
            if (child.type === 'Points' || child.type === 'Audio' || child.isLight || child.isLine || child.type === 'Line') {
                objectsToRemove.push(child);
            }
            if (child.type === 'Mesh' && child.material) {
                // If the mesh is the occlusion cube (used for AR mask), disable colorWrite logic or remove it
                if (Array.isArray(child.material) && child.material[0] && child.material[0].colorWrite === false) {
                    objectsToRemove.push(child);
                } else if (child.material.colorWrite === false) {
                    objectsToRemove.push(child);
                }
            }
        });
        objectsToRemove.forEach(child => child.parent.remove(child));

        const arraybuffer = await exporter.parse( exportScene );
        const blob = new Blob( [ arraybuffer ], { type: 'application/octet-stream' } );

        const link = document.createElement('a');
        link.style.display = 'none';
        link.href = URL.createObjectURL(blob);
        link.download = 'rudnik.usdz';
        link.rel = 'ar';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (e) {
        console.error("USDZ Export failed", e);
        alert("Napaka pri generiranju USDZ.");
    } finally {
        btn.textContent = "Odpri v AR na iPhonu (.usdz)";
        btn.disabled = false;
    }
}

function startFallbackMode() {
    isFallbackMode = true;
    renderer.xr.enabled = false; // Disable AR
    renderer.setClearColor(0x000000, 1); // Solid black background
    
    document.getElementById('ui-container').style.display = 'none';
    document.getElementById('fallback-ui').style.display = 'block';
    
    // Hide AR Button
    const arBtn = document.getElementById('ARButton');
    if (arBtn) arBtn.style.display = 'none';

    // Make the portal visible immediately and bypass occlusion mask
    portalGroup.position.set(0, 0, 0);
    portalGroup.quaternion.identity();
    portalGroup.visible = true;

    // Remove occlusion box for fallback so it doesn't block vision accidentally
    tunnelGroup.children.forEach(child => {
        if(child.type === 'Mesh' && child.material && Array.isArray(child.material) && child.material[0].colorWrite === false) {
            child.visible = false; 
        }
    });

    // Start inside tunnel explicitly
    camera.position.set(0, tunnelHeight/2 - 0.2, 2);

    // Setup input for Fallback View
    setupFallbackControls();
    
    const ctx = THREE.AudioContext.getContext();
    if(ctx.state === 'suspended') ctx.resume();
}

function setupFallbackControls() {
    // Touch / Mouse Drag to Look
    renderer.domElement.addEventListener('pointerdown', (e) => {
        isDragging = true;
        previousMousePosition = { x: e.clientX, y: e.clientY };
    });
    renderer.domElement.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        
        const deltaMove = {
            x: e.clientX - previousMousePosition.x,
            y: e.clientY - previousMousePosition.y
        };

        camYaw -= deltaMove.x * 0.005;
        camPitch -= deltaMove.y * 0.005;
        
        // Clamp pitch
        camPitch = Math.max(-Math.PI/2 + 0.1, Math.min(Math.PI/2 - 0.1, camPitch));
        
        // Apply rotation
        camera.rotation.set(camPitch, camYaw, 0, 'YXZ');

        previousMousePosition = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointerup', () => { isDragging = false; });
    
    // UI Buttons for walking and turning
    const btnFwd = document.getElementById('btn-forward');
    const btnBwd = document.getElementById('btn-backward');
    const btnLeft = document.getElementById('btn-left');
    const btnRight = document.getElementById('btn-right');
    
    const startFwd = (e) => { e.preventDefault(); moveForward = true; };
    const stopFwd = (e) => { e.preventDefault(); moveForward = false; };
    btnFwd.addEventListener('mousedown', startFwd);
    btnFwd.addEventListener('touchstart', startFwd);
    btnFwd.addEventListener('mouseup', stopFwd);
    btnFwd.addEventListener('touchend', stopFwd);
    btnFwd.addEventListener('mouseleave', stopFwd);
    
    const startBwd = (e) => { e.preventDefault(); moveBackward = true; };
    const stopBwd = (e) => { e.preventDefault(); moveBackward = false; };
    btnBwd.addEventListener('mousedown', startBwd);
    btnBwd.addEventListener('touchstart', startBwd);
    btnBwd.addEventListener('mouseup', stopBwd);
    btnBwd.addEventListener('touchend', stopBwd);
    btnBwd.addEventListener('mouseleave', stopBwd);

    const startLeft = (e) => { e.preventDefault(); turnLeft = true; };
    const stopLeft = (e) => { e.preventDefault(); turnLeft = false; };
    btnLeft.addEventListener('mousedown', startLeft);
    btnLeft.addEventListener('touchstart', startLeft);
    btnLeft.addEventListener('mouseup', stopLeft);
    btnLeft.addEventListener('touchend', stopLeft);
    btnLeft.addEventListener('mouseleave', stopLeft);

    const startRight = (e) => { e.preventDefault(); turnRight = true; };
    const stopRight = (e) => { e.preventDefault(); turnRight = false; };
    btnRight.addEventListener('mousedown', startRight);
    btnRight.addEventListener('touchstart', startRight);
    btnRight.addEventListener('mouseup', stopRight);
    btnRight.addEventListener('touchend', stopRight);
    btnRight.addEventListener('mouseleave', stopRight);

    // Pickaxe Button (For Fallback)
    const btnHit = document.getElementById('btn-hit');
    btnHit.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (!pickaxeEquipped) {
            pickaxeEquipped = true;
            tunnelGroup.remove(pickaxe);
            pickaxe.position.set(0.3, -0.3, -0.5);
            pickaxe.rotation.set(-Math.PI/4, 0, 0);
            camera.add(pickaxe);
        }
        swingPickaxe();
    });
    btnHit.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (!pickaxeEquipped) {
            pickaxeEquipped = true;
            tunnelGroup.remove(pickaxe);
            pickaxe.position.set(0.3, -0.3, -0.5);
            pickaxe.rotation.set(-Math.PI/4, 0, 0);
            camera.add(pickaxe);
        }
        swingPickaxe();
    });

    // Keyboard support for PC testing (WASD & Arrow Keys)
    window.addEventListener('keydown', (e) => {
        if (!isFallbackMode) return;
        switch (e.code) {
            case 'ArrowUp':
            case 'KeyW':
                moveForward = true;
                break;
            case 'ArrowDown':
            case 'KeyS':
                moveBackward = true;
                break;
            case 'ArrowLeft':
            case 'KeyA':
                turnLeft = true;
                break;
            case 'ArrowRight':
            case 'KeyD':
                turnRight = true;
                break;
            case 'Space':
                e.preventDefault();
                // Pickaxe action
                if (!pickaxeEquipped) {
                    pickaxeEquipped = true;
                    tunnelGroup.remove(pickaxe);
                    pickaxe.position.set(0.3, -0.3, -0.5);
                    pickaxe.rotation.set(-Math.PI/4, 0, 0);
                    camera.add(pickaxe);
                }
                swingPickaxe();
                break;
        }
    });

    window.addEventListener('keyup', (e) => {
        if (!isFallbackMode) return;
        switch (e.code) {
            case 'ArrowUp':
            case 'KeyW':
                moveForward = false;
                break;
            case 'ArrowDown':
            case 'KeyS':
                moveBackward = false;
                break;
            case 'ArrowLeft':
            case 'KeyA':
                turnLeft = false;
                break;
            case 'ArrowRight':
            case 'KeyD':
                turnRight = false;
                break;
        }
    });
}

function startElevatorDescent() {
    if (elevatorState !== 'BEFORE_START') return;
    elevatorState = 'DESCENDING';
    elevatorTime = 0;
    
    // Centering the camera inside the elevator in fallback mode
    if (isFallbackMode) {
        camera.position.set(0, tunnelHeight/2 - 0.2, -1.8);
        moveForward = false;
        moveBackward = false;
    }
    
    // Play back doors closing clang sound
    if (elevatorGateSound) {
        if (elevatorGateSound.isPlaying) elevatorGateSound.stop();
        elevatorGateSound.play();
    }
    
    // Start continuous rumble sound
    if (elevatorRumbleSound) {
        if (elevatorRumbleSound.isPlaying) elevatorRumbleSound.stop();
        elevatorRumbleSound.play();
    }

    // Make the back shaft wall visible to completely enclose the cage
    if (shaftBack) {
        shaftBack.visible = true;
    }
}

function updateFallbackMovement(delta) {
    if (!isFallbackMode) return;
    
    // Smooth camera rotation with buttons (always allowed to look around)
    if (turnLeft) {
        camYaw += turnSpeed * delta;
        camera.rotation.set(camPitch, camYaw, 0, 'YXZ');
    }
    if (turnRight) {
        camYaw -= turnSpeed * delta;
        camera.rotation.set(camPitch, camYaw, 0, 'YXZ');
    }
    
    // Lock translation controls completely during descent and door opening
    if (elevatorState === 'DESCENDING' || elevatorState === 'ARRIVED' || elevatorState === 'OPENING') {
        return;
    }
    
    const direction = new THREE.Vector3(0, 0, -1);
    // Move along viewing direction, but ignore Y to stay on ground
    direction.applyQuaternion(camera.quaternion);
    direction.y = 0;
    direction.normalize();
    
    if (moveForward) {
        camera.position.addScaledVector(direction, moveSpeed * delta);
    }
    if (moveBackward) {
        camera.position.addScaledVector(direction, -moveSpeed * delta);
    }
    
    // Bounds restriction and triggers based on elevator state
    if (elevatorState === 'BEFORE_START') {
        // Prevent walking out the front where the elevator door is closed
        if (camera.position.z < -3.3) camera.position.z = -3.3;
        // Basic outer limits
        if (camera.position.z > 5) camera.position.z = 5;
        if (camera.position.x > tunnelWidth/2 - 0.5) camera.position.x = tunnelWidth/2 - 0.5;
        if (camera.position.x < -tunnelWidth/2 + 0.5) camera.position.x = -tunnelWidth/2 + 0.5;
        
        // Trigger descent if stepping inside the elevator cage (z < -0.4 and x is aligned)
        if (camera.position.z < -0.4 && Math.abs(camera.position.x) < 1.0) {
            startElevatorDescent();
        }
    } else {
        // 'FINISHED' state - Normal mine boundaries
        if (camera.position.z > 5) camera.position.z = 5;
        if (camera.position.z < -tunnelDepth) camera.position.z = -tunnelDepth;
        if (camera.position.x > tunnelWidth/2 - 0.5) camera.position.x = tunnelWidth/2 - 0.5;
        if (camera.position.x < -tunnelWidth/2 + 0.5) camera.position.x = -tunnelWidth/2 + 0.5;
    }
}

function createAudioBuffer(duration, frequency, decay, type = 'sine') {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < buffer.length; i++) {
        const t = i / ctx.sampleRate;
        const envelope = Math.exp(-t * decay);
        if (type === 'noise') {
            data[i] = (Math.random() * 2 - 1) * envelope;
        } else if (type === 'rumble') {
            // Low frequency rumble hum + low frequency noise component
            const lowHum = Math.sin(2 * Math.PI * 45 * t) * 0.45 + Math.sin(2 * Math.PI * 27 * t) * 0.35;
            const noise = (Math.random() * 2 - 1) * 0.2;
            let loopFade = 1.0;
            // Fade loop edges to avoid pops/clicks
            if (t < 0.2) loopFade = t / 0.2;
            if (t > duration - 0.2) loopFade = (duration - t) / 0.2;
            data[i] = (lowHum + noise) * loopFade * envelope;
        } else if (type === 'clang') {
            // Detuned metallic ringing + noise transient
            const resonantHums = Math.sin(2 * Math.PI * 90 * t) * 0.3 + 
                                 Math.sin(2 * Math.PI * 220 * t) * 0.25 + 
                                 Math.sin(2 * Math.PI * 440 * t) * 0.15 +
                                 Math.sin(2 * Math.PI * 780 * t) * 0.1;
            const whiteNoise = (Math.random() * 2 - 1) * 0.2;
            data[i] = (resonantHums + whiteNoise) * envelope;
        } else {
            data[i] = Math.sin(2 * Math.PI * frequency * t) * envelope;
        }
    }
    return buffer;
}

function createElevatorSounds() {
    // 1. Elevator continuous low-frequency mechanical rumble sound
    elevatorRumbleSound = new THREE.Audio(listener);
    const rumbleBuffer = createAudioBuffer(6.0, 40, 0.0, 'rumble'); // no decay
    elevatorRumbleSound.setBuffer(rumbleBuffer);
    elevatorRumbleSound.setLoop(true);
    elevatorRumbleSound.setVolume(0.85);

    // 2. Heavy metallic gate clang sound
    elevatorGateSound = new THREE.Audio(listener);
    const clangBuffer = createAudioBuffer(1.5, 120, 4.0, 'clang'); // rapid decay
    elevatorGateSound.setBuffer(clangBuffer);
    elevatorGateSound.setVolume(1.0);
}

function createSounds() {
    hitSound = new THREE.PositionalAudio(listener);
    const audioBuffer = createAudioBuffer(0.5, 100, 10, 'noise');
    hitSound.setBuffer(audioBuffer);
    hitSound.setVolume(1.0);
    hitSound.setRefDistance(10);
}

function buildMine() {
    tunnelGroup = new THREE.Group();
    tunnelGroup.position.set(0, tunnelHeight / 2, -tunnelDepth / 2);

    const occWidth = tunnelWidth + 0.2;
    const occHeight = tunnelHeight + 0.2;
    const occDepth = tunnelDepth + 0.2;
    const occlusionGeo = new THREE.BoxGeometry(occWidth, occHeight, occDepth);
    const occMat = new THREE.MeshBasicMaterial({ colorWrite: false });
    const occClearMat = new THREE.MeshBasicMaterial({ visible: false });
    const occlusionMaterials = [ occMat, occMat, occMat, occMat, occClearMat, occMat ];
    
    const occlusionCube = new THREE.Mesh(occlusionGeo, occlusionMaterials);
    occlusionCube.renderOrder = 0;
    portalGroup.add(tunnelGroup);
    tunnelGroup.add(occlusionCube);

    // 1. Realistic Stacked Logs Texture for Walls/Ceiling
    const logCanvas = document.createElement('canvas');
    logCanvas.width = 512;
    logCanvas.height = 512;
    const ctx = logCanvas.getContext('2d');
    
    // Base dark wood brown
    ctx.fillStyle = '#2c1c12';
    ctx.fillRect(0, 0, 512, 512);

    const numLogs = 16;
    const logPixelHeight = 512 / numLogs;
    for (let i = 0; i < numLogs; i++) {
        const y = i * logPixelHeight;
        
        // Vary base color slightly per log
        const shade = 10 + Math.floor(Math.random() * 15);
        ctx.fillStyle = `rgb(${shade + 30}, ${shade + 18}, ${shade + 8})`;
        ctx.fillRect(0, y, 512, logPixelHeight);

        // Draw bark grain texture (horizontal streaks)
        for (let j = 0; j < 6; j++) {
            ctx.fillStyle = `rgba(15, 8, 2, ${0.1 + Math.random() * 0.15})`;
            ctx.fillRect(0, y + Math.random() * logPixelHeight, 512, 1 + Math.floor(Math.random() * 3));
        }

        // Draw cylindrical shading (top/bottom shadows, middle highlight)
        const shadowTop = ctx.createLinearGradient(0, y, 0, y + 8);
        shadowTop.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
        shadowTop.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = shadowTop;
        ctx.fillRect(0, y, 512, 8);

        const shadowBottom = ctx.createLinearGradient(0, y + logPixelHeight - 8, 0, y + logPixelHeight);
        shadowBottom.addColorStop(0, 'rgba(0, 0, 0, 0)');
        shadowBottom.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
        ctx.fillStyle = shadowBottom;
        ctx.fillRect(0, y + logPixelHeight - 8, 512, 8);

        const highlight = ctx.createLinearGradient(0, y + 8, 0, y + 24);
        highlight.addColorStop(0, 'rgba(255, 255, 255, 0)');
        highlight.addColorStop(0.5, 'rgba(255, 255, 255, 0.08)');
        highlight.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = highlight;
        ctx.fillRect(0, y + 8, 512, 16);
    }

    const logTex = new THREE.CanvasTexture(logCanvas);
    logTex.wrapS = THREE.RepeatWrapping;
    logTex.wrapT = THREE.RepeatWrapping;
    logTex.repeat.set(5, 10);

    // 2. Matching Bump Map for Horizontal Stacked Logs
    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = 512;
    bumpCanvas.height = 512;
    const bCtx = bumpCanvas.getContext('2d');
    bCtx.fillStyle = '#808080';
    bCtx.fillRect(0, 0, 512, 512);

    for (let i = 0; i < numLogs; i++) {
        const y = i * logPixelHeight;
        for (let ly = 0; ly < logPixelHeight; ly++) {
            const factor = Math.sin((ly / logPixelHeight) * Math.PI);
            const val = Math.floor(factor * 200);
            bCtx.fillStyle = `rgb(${val}, ${val}, ${val})`;
            bCtx.fillRect(0, y + ly, 512, 1);
        }
    }

    const logBumpTex = new THREE.CanvasTexture(bumpCanvas);
    logBumpTex.wrapS = THREE.RepeatWrapping;
    logBumpTex.wrapT = THREE.RepeatWrapping;
    logBumpTex.repeat.set(5, 10);

    const logMat = new THREE.MeshStandardMaterial({
        map: logTex,
        bumpMap: logBumpTex,
        bumpScale: 0.12,
        roughness: 0.85,
        metalness: 0.1,
        side: THREE.BackSide
    });

    // 3. Procedural Split Floor Texture (Concrete path on left, dark gravel on right)
    const floorCanvas = document.createElement('canvas');
    floorCanvas.width = 512;
    floorCanvas.height = 512;
    const fCtx = floorCanvas.getContext('2d');

    fCtx.fillStyle = '#1e1b18';
    fCtx.fillRect(0, 0, 512, 512);

    for (let i = 0; i < 10000; i++) {
        const x = 200 + Math.random() * 312;
        const y = Math.random() * 512;
        const size = Math.random() * 3 + 1;
        const col = 10 + Math.floor(Math.random() * 20);
        fCtx.fillStyle = `rgb(${col + 15}, ${col + 10}, ${col + 5})`;
        fCtx.fillRect(x, y, size, size);
    }

    fCtx.fillStyle = '#7a7a7a';
    fCtx.fillRect(0, 0, 200, 512);

    for (let i = 0; i < 8000; i++) {
        const x = Math.random() * 200;
        const y = Math.random() * 512;
        const size = Math.random() * 2 + 1;
        const val = 100 + Math.floor(Math.random() * 30);
        fCtx.fillStyle = `rgb(${val}, ${val}, ${val})`;
        fCtx.fillRect(x, y, size, size);
    }

    fCtx.strokeStyle = '#333333';
    fCtx.lineWidth = 3;
    for (let y = 64; y < 512; y += 64) {
        fCtx.beginPath();
        fCtx.moveTo(0, y);
        fCtx.lineTo(200, y);
        fCtx.stroke();
    }

    const SeamGradient = fCtx.createLinearGradient(195, 0, 205, 0);
    SeamGradient.addColorStop(0, 'rgba(0, 0, 0, 0.4)');
    SeamGradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.8)');
    SeamGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    fCtx.fillStyle = SeamGradient;
    fCtx.fillRect(195, 0, 10, 512);

    const floorTex = new THREE.CanvasTexture(floorCanvas);
    floorTex.wrapS = THREE.RepeatWrapping;
    floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(1, 10);

    // 4. Floor Bump Map
    const floorBumpCanvas = document.createElement('canvas');
    floorBumpCanvas.width = 512;
    floorBumpCanvas.height = 512;
    const fbCtx = floorBumpCanvas.getContext('2d');
    fbCtx.fillStyle = '#808080';
    fbCtx.fillRect(0, 0, 200, 512);
    fbCtx.fillStyle = '#505050';
    fbCtx.fillRect(200, 0, 312, 512);

    for (let i = 0; i < 4000; i++) {
        const x = 200 + Math.random() * 312;
        const y = Math.random() * 512;
        const size = Math.random() * 5 + 2;
        const val = Math.random() > 0.5 ? 255 : 0;
        fbCtx.fillStyle = `rgba(${val}, ${val}, ${val}, 0.5)`;
        fbCtx.fillRect(x, y, size, size);
    }
    fbCtx.strokeStyle = '#000000';
    fbCtx.lineWidth = 3;
    for (let y = 64; y < 512; y += 64) {
        fbCtx.beginPath();
        fbCtx.moveTo(0, y);
        fbCtx.lineTo(200, y);
        fbCtx.stroke();
    }

    const floorBumpTex = new THREE.CanvasTexture(floorBumpCanvas);
    floorBumpTex.wrapS = THREE.RepeatWrapping;
    floorBumpTex.wrapT = THREE.RepeatWrapping;
    floorBumpTex.repeat.set(1, 10);

    const floorMat = new THREE.MeshStandardMaterial({
        map: floorTex,
        bumpMap: floorBumpTex,
        bumpScale: 0.08,
        roughness: 0.8,
        metalness: 0.05,
        side: THREE.BackSide
    });

    // 4. Materials for round log arches and stacked logs
    const barkCanvas = document.createElement('canvas');
    barkCanvas.width = 128;
    barkCanvas.height = 128;
    const barkCtx = barkCanvas.getContext('2d');
    barkCtx.fillStyle = '#3a261a';
    barkCtx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 128; i++) {
        barkCtx.fillStyle = `rgb(${45 + Math.random()*15}, ${30 + Math.random()*10}, ${20 + Math.random()*8})`;
        barkCtx.fillRect(0, i, 128, 1);
    }
    const barkTex = new THREE.CanvasTexture(barkCanvas);
    barkTex.wrapS = THREE.RepeatWrapping;
    barkTex.wrapT = THREE.RepeatWrapping;
    
    const logSideMat = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 0.9, metalness: 0.05 });
    const logCapMat = new THREE.MeshStandardMaterial({ color: 0xc4a482, roughness: 0.7 });
    const archMat = [ logSideMat, logCapMat, logCapMat ];

    // Create the split floor plane (concrete/gravel)
    const floorGeo = new THREE.PlaneGeometry(tunnelWidth, tunnelDepth);
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -tunnelHeight / 2;
    floorMesh.renderOrder = 1;
    tunnelGroup.add(floorMesh);

    // Dark end-cap plane at the end of the tunnel
    const endCapGeo = new THREE.PlaneGeometry(tunnelWidth, tunnelHeight);
    const endCapMat = new THREE.MeshStandardMaterial({ color: 0x15110e, roughness: 0.9 });
    const endCapMesh = new THREE.Mesh(endCapGeo, endCapMat);
    endCapMesh.position.set(0, 0, -tunnelDepth / 2);
    tunnelGroup.add(endCapMesh);

    // Rails
    const railMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.8, roughness: 0.4 });
    const railGeo = new THREE.BoxGeometry(0.1, 0.1, tunnelDepth);
    const leftRail = new THREE.Mesh(railGeo, railMat);
    leftRail.position.set(-0.5, -tunnelHeight/2 + 0.05, 0);
    tunnelGroup.add(leftRail);
    const rightRail = new THREE.Mesh(railGeo, railMat);
    rightRail.position.set(0.5, -tunnelHeight/2 + 0.05, 0);
    tunnelGroup.add(rightRail);

    // Ventilation pipe running on upper right
    const pipeGeo = new THREE.CylinderGeometry(0.15, 0.15, tunnelDepth, 12);
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x5a5f63, metalness: 0.7, roughness: 0.3 });
    const ventPipe = new THREE.Mesh(pipeGeo, pipeMat);
    ventPipe.rotation.x = Math.PI / 2;
    ventPipe.position.set(tunnelWidth/2 - 0.4, tunnelHeight/2 - 0.35, 0);
    tunnelGroup.add(ventPipe);

    // 3D Stacked Log Walls
    const logRadius = 0.1;
    const wallLogGeo = new THREE.CylinderGeometry(logRadius, logRadius, tunnelDepth, 8);
    
    // Left Wall Logs (tilted inward)
    const leftWallLogs = new THREE.Group();
    leftWallLogs.position.set(-tunnelWidth / 2 + 0.1, 0, 0);
    for (let i = 0; i < 15; i++) {
        const log = new THREE.Mesh(wallLogGeo, [logSideMat, logCapMat, logCapMat]);
        log.rotation.x = Math.PI / 2;
        log.position.set(0, -tunnelHeight / 2 + logRadius + i * (logRadius * 2), 0);
        leftWallLogs.add(log);
    }
    leftWallLogs.rotation.z = -0.12;
    tunnelGroup.add(leftWallLogs);

    // Right Wall Logs (tilted inward)
    const rightWallLogs = new THREE.Group();
    rightWallLogs.position.set(tunnelWidth / 2 - 0.1, 0, 0);
    for (let i = 0; i < 15; i++) {
        const log = new THREE.Mesh(wallLogGeo, [logSideMat, logCapMat, logCapMat]);
        log.rotation.x = Math.PI / 2;
        log.position.set(0, -tunnelHeight / 2 + logRadius + i * (logRadius * 2), 0);
        rightWallLogs.add(log);
    }
    rightWallLogs.rotation.z = 0.12;
    tunnelGroup.add(rightWallLogs);

    // 3D Ceiling Logs
    const numCeilingLogs = 15;
    const ceilingLogWidth = tunnelWidth - 0.6;
    const ceilingLogSpacing = ceilingLogWidth / (numCeilingLogs - 1);
    for (let i = 0; i < numCeilingLogs; i++) {
        const log = new THREE.Mesh(wallLogGeo, [logSideMat, logCapMat, logCapMat]);
        log.rotation.x = Math.PI / 2;
        log.position.set(-ceilingLogWidth / 2 + i * ceilingLogSpacing, tunnelHeight / 2 - 0.12, 0);
        tunnelGroup.add(log);
    }

    // Tilted support frames, hanging cables and point lights
    pointLights.length = 0;

    for (let z = 2; z < tunnelDepth; z += 4) {
        // Tilted posts (Cylinders)
        const postGeo = new THREE.CylinderGeometry(0.12, 0.12, tunnelHeight + 0.1, 12);
        
        // Left post (tilts inward, i.e., rotation.z = -0.12 rad)
        const leftPost = new THREE.Mesh(postGeo, archMat);
        leftPost.rotation.z = -0.12;
        leftPost.position.set(-tunnelWidth/2 + 0.3, 0, -tunnelDepth/2 + z);
        tunnelGroup.add(leftPost);

        // Right post (tilts inward, i.e., rotation.z = 0.12 rad)
        const rightPost = new THREE.Mesh(postGeo, archMat);
        rightPost.rotation.z = 0.12;
        rightPost.position.set(tunnelWidth/2 - 0.3, 0, -tunnelDepth/2 + z);
        tunnelGroup.add(rightPost);

        // Ceiling beam spanning between tilted posts
        const beamGeo = new THREE.CylinderGeometry(0.11, 0.11, tunnelWidth - 0.5, 12);
        const topBeam = new THREE.Mesh(beamGeo, archMat);
        topBeam.rotation.z = Math.PI / 2;
        topBeam.position.set(0, tunnelHeight/2 - 0.15, -tunnelDepth/2 + z);
        tunnelGroup.add(topBeam);
        
        // Vent Pipe Bracket (Torus ring)
        const bracketGeo = new THREE.TorusGeometry(0.16, 0.02, 6, 16);
        const bracket = new THREE.Mesh(bracketGeo, railMat);
        bracket.position.set(tunnelWidth/2 - 0.4, tunnelHeight/2 - 0.35, -tunnelDepth/2 + z);
        tunnelGroup.add(bracket);
        
        // Flickering Mine Lamp mounted low on the left post
        const lampX = -tunnelWidth/2 + 0.45;
        const lampY = -0.5;
        const lampZ = -tunnelDepth/2 + z;
        
        const isCool = (z % 8 === 2);
        const lightColor = isCool ? 0xd0e2ff : 0xffa64d;
        
        const pointLight = new THREE.PointLight(lightColor, 0.9, 8);
        pointLight.position.set(lampX, lampY, lampZ);
        pointLight.userData = { baseIntensity: 0.9 };
        tunnelGroup.add(pointLight);
        pointLights.push(pointLight);
        
        // Small lamp cylinder visual sticking out from the left post
        const lampGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.1, 8);
        const lampMat = new THREE.MeshBasicMaterial({ color: isCool ? 0xddedff : 0xffdb99 });
        const lamp = new THREE.Mesh(lampGeo, lampMat);
        lamp.rotation.z = Math.PI / 2;
        lamp.position.set(lampX - 0.05, lampY, lampZ);
        tunnelGroup.add(lamp);
    }

    // 5. Sagging Electric/Power Cables hanging along the left wooden posts
    for (let z = 2; z < tunnelDepth - 4; z += 4) {
        const p1 = new THREE.Vector3(-tunnelWidth/2 + 0.3, tunnelHeight/2 - 0.3, -tunnelDepth/2 + z);
        const p2 = new THREE.Vector3(-tunnelWidth/2 + 0.3, tunnelHeight/2 - 0.3, -tunnelDepth/2 + z + 4);
        const midPoint = new THREE.Vector3(-tunnelWidth/2 + 0.3, tunnelHeight/2 - 0.6, -tunnelDepth/2 + z + 2);
        
        const curve = new THREE.CatmullRomCurve3([p1, midPoint, p2]);
        const points = curve.getPoints(16);
        const cableGeo = new THREE.BufferGeometry().setFromPoints(points);
        const cableMat = new THREE.LineBasicMaterial({ color: 0x111111 });
        const cable = new THREE.Line(cableGeo, cableMat);
        tunnelGroup.add(cable);
    }

    // Helper to add stacked log piles on the right gravel side
    function addLogPile(x, z, count) {
        const pileGroup = new THREE.Group();
        pileGroup.position.set(x, -tunnelHeight/2 + 0.12, z);
        
        const logLength = 1.8;
        const logRadius = 0.11;
        const singleLogGeo = new THREE.CylinderGeometry(logRadius, logRadius, logLength, 8);
        
        if (count === 3) {
            const log1 = new THREE.Mesh(singleLogGeo, archMat);
            log1.rotation.x = Math.PI / 2;
            log1.position.set(-logRadius, 0, 0);
            pileGroup.add(log1);
            
            const log2 = new THREE.Mesh(singleLogGeo, archMat);
            log2.rotation.x = Math.PI / 2;
            log2.position.set(logRadius, 0, 0);
            pileGroup.add(log2);
            
            const log3 = new THREE.Mesh(singleLogGeo, archMat);
            log3.rotation.x = Math.PI / 2;
            log3.position.set(0, logRadius * 1.5, 0);
            pileGroup.add(log3);
        } else {
            const log1 = new THREE.Mesh(singleLogGeo, archMat);
            log1.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.1;
            log1.rotation.y = (Math.random() - 0.5) * 0.1;
            pileGroup.add(log1);
        }
        tunnelGroup.add(pileGroup);
    }

    // Add log piles (3-log stack) at z=-8 and z=-20 on the right side
    addLogPile(tunnelWidth/2 - 0.75, -tunnelDepth/2 + 8, 3);
    addLogPile(tunnelWidth/2 - 0.85, -tunnelDepth/2 + 20, 3);

    // Particles/Dust
    const particleGeo = new THREE.BufferGeometry();
    const particleCount = 2000;
    const particlePositions = new Float32Array(particleCount * 3);
    for(let i=0; i < particleCount * 3; i++) {
        particlePositions[i] = (Math.random() - 0.5) * tunnelWidth;
        particlePositions[i+1] = (Math.random() - 0.5) * tunnelHeight;
        particlePositions[i+2] = (Math.random() - 0.5) * tunnelDepth;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particleMat = new THREE.PointsMaterial({ color: 0x888888, size: 0.05, transparent: true, opacity: 0.5 });
    const particles = new THREE.Points(particleGeo, particleMat);
    tunnelGroup.add(particles);

    addPosters();

    // Place animated sitting miner in a side alcove
    minerGroup = createMiner();
    minerGroup.position.set(tunnelWidth/2 - 0.7, -tunnelHeight/2, -14);
    minerGroup.rotation.y = -Math.PI / 4 - 0.2;
    tunnelGroup.add(minerGroup);

    // Warm lantern light next to the miner
    const minerLantern = new THREE.PointLight(0xffaa44, 0.8, 4);
    minerLantern.position.set(tunnelWidth/2 - 0.7, 0.4, -13.5);
    tunnelGroup.add(minerLantern);

    pickaxe = createPickaxe();
    pickaxe.position.set(0, -tunnelHeight/2 + 0.5, -tunnelDepth/2 + 2);
    tunnelGroup.add(pickaxe);
    
    hitSound.position.set(0, 0, -tunnelDepth/2 + 1);
    tunnelGroup.add(hitSound);

    // Build Elevator Cage and Shaft
    createElevator();

    // Spawn interactive coal blocks at the end of the mine
    createCoalBlocks();
}

function createCoalBlocks() {
    // Material: Shiny black anthracite coal
    const coalMat = new THREE.MeshStandardMaterial({
        color: 0x111111,
        roughness: 0.15,
        metalness: 0.95
    });

    // Create a bumpy canvas texture for the coal blocks to look rough
    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = 128;
    bumpCanvas.height = 128;
    const bCtx = bumpCanvas.getContext('2d');
    bCtx.fillStyle = '#808080';
    bCtx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 200; i++) {
        const x = Math.random() * 128;
        const y = Math.random() * 128;
        const size = Math.random() * 12 + 4;
        const val = Math.random() > 0.5 ? 255 : 0;
        bCtx.fillStyle = `rgba(${val}, ${val}, ${val}, 0.45)`;
        bCtx.fillRect(x, y, size, size);
    }
    const coalBumpTex = new THREE.CanvasTexture(bumpCanvas);
    coalBumpTex.wrapS = THREE.RepeatWrapping;
    coalBumpTex.wrapT = THREE.RepeatWrapping;
    coalMat.bumpMap = coalBumpTex;
    coalMat.bumpScale = 0.04;

    // We will place 5 coal blocks on the back end wall (z_local = -15 inside tunnelGroup)
    // End wall center is at x=0, y=0, z=-15. Depth of tunnel is 30.
    const positions = [
        { x: -0.6, y: -0.3, size: 0.35, hits: 3 },
        { x: 0.6, y: -0.1, size: 0.3, hits: 3 },
        { x: 0.0, y: 0.5, size: 0.4, hits: 4 },
        { x: -0.5, y: 0.6, size: 0.28, hits: 2 },
        { x: 0.5, y: 0.7, size: 0.32, hits: 3 }
    ];

    positions.forEach(pos => {
        // rough rock-like geometry (dodecahedron with detail 1)
        const geo = new THREE.DodecahedronGeometry(pos.size, 1);
        const mesh = new THREE.Mesh(geo, coalMat);
        
        // Random rotation for natural rock look
        mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        
        // Position on the end wall (let's set z slightly in front of endCapMesh at -14.85)
        mesh.position.set(pos.x, pos.y, -tunnelDepth / 2 + 0.15);
        mesh.userData = { hits: pos.hits, maxHits: pos.hits, originalScale: pos.size };
        
        tunnelGroup.add(mesh);
        coalBlocks.push(mesh);
    });
}


function createElevator() {
    elevatorGroup = new THREE.Group();
    // Position the elevator group at the portal entrance.
    // In portal coordinates: W=2.2, H=2.6, D=3.6. It spans from z=0 to z=-3.6.
    // Let's set its position such that its back gates are at z = 0.
    elevatorGroup.position.set(0, 0, 0);
    
    // Materials
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.85, roughness: 0.35 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.7, roughness: 0.5 });
    const barMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.9, roughness: 0.3 });
    
    // 1. Floor (2.2m wide, 0.06m thick, 3.6m deep)
    const floorGeo = new THREE.BoxGeometry(2.2, 0.06, 3.6);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.set(0, 0.03, -1.8);
    elevatorGroup.add(floor);
    
    // 2. Ceiling (2.2m wide, 0.06m thick, 3.6m deep)
    const ceilingGeo = new THREE.BoxGeometry(2.2, 0.06, 3.6);
    const ceiling = new THREE.Mesh(ceilingGeo, steelMat);
    ceiling.position.set(0, 2.57, -1.8);
    elevatorGroup.add(ceiling);
    
    // 3. Corner columns (four vertical posts)
    const postGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.6, 8);
    const corners = [
        { x: -1.08, z: -0.04 },
        { x: 1.08, z: -0.04 },
        { x: -1.08, z: -3.56 },
        { x: 1.08, z: -3.56 }
    ];
    corners.forEach(pos => {
        const post = new THREE.Mesh(postGeo, steelMat);
        post.position.set(pos.x, 1.3, pos.z);
        elevatorGroup.add(post);
    });
    
    // 4. Side bars (left and right grid walls)
    const sideBarGeo = new THREE.CylinderGeometry(0.015, 0.015, 2.6, 6);
    for (let z = -0.25; z >= -3.35; z -= 0.25) {
        // Left wall bars
        const leftBar = new THREE.Mesh(sideBarGeo, barMat);
        leftBar.position.set(-1.08, 1.3, z);
        elevatorGroup.add(leftBar);
        
        // Right wall bars
        const rightBar = new THREE.Mesh(sideBarGeo, barMat);
        rightBar.position.set(1.08, 1.3, z);
        elevatorGroup.add(rightBar);
    }
    
    // 5. Ceiling light bulb hanging
    const cordGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.3);
    const cordMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const cord = new THREE.Mesh(cordGeo, cordMat);
    cord.position.set(0, 2.4, -1.8);
    elevatorGroup.add(cord);
    
    const bulbGeo = new THREE.SphereGeometry(0.04, 8, 8);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffeeaa });
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.set(0, 2.23, -1.8);
    elevatorGroup.add(bulb);
    
    const cageLight = new THREE.PointLight(0xffc266, 1.2, 5);
    cageLight.position.set(0, 2.2, -1.8);
    elevatorGroup.add(cageLight);
    
    // 6. Sliding Gates
    // Create the procedural grid texture for gates
    const gateCanvas = document.createElement('canvas');
    gateCanvas.width = 256;
    gateCanvas.height = 512;
    const gCtx = gateCanvas.getContext('2d');
    gCtx.clearRect(0, 0, 256, 512);
    
    // Draw outer frame
    gCtx.strokeStyle = '#333333';
    gCtx.lineWidth = 16;
    gCtx.strokeRect(8, 8, 240, 496);
    
    // Draw grid lines
    gCtx.strokeStyle = '#555555';
    gCtx.lineWidth = 6;
    for (let x = 32; x < 240; x += 32) {
        gCtx.beginPath();
        gCtx.moveTo(x, 12);
        gCtx.lineTo(x, 500);
        gCtx.stroke();
    }
    gCtx.strokeStyle = '#444444';
    gCtx.lineWidth = 4;
    for (let y = 32; y < 500; y += 48) {
        gCtx.beginPath();
        gCtx.moveTo(12, y);
        gCtx.lineTo(244, y);
        gCtx.stroke();
    }
    
    const gateTex = new THREE.CanvasTexture(gateCanvas);
    const gateMat = new THREE.MeshStandardMaterial({
        map: gateTex,
        transparent: true,
        side: THREE.DoubleSide,
        roughness: 0.5,
        metalness: 0.8
    });
    
    // Gate geometry (each panel is 1.05m wide, 2.5m tall)
    const gateGeo = new THREE.PlaneGeometry(1.05, 2.5);
    
    // Front Gates (leads to mine, at z = -3.56 local)
    leftGateMesh = new THREE.Mesh(gateGeo, gateMat);
    leftGateMesh.position.set(-0.53, 1.25, -3.55);
    elevatorGroup.add(leftGateMesh);
    
    rightGateMesh = new THREE.Mesh(gateGeo, gateMat);
    rightGateMesh.position.set(0.53, 1.25, -3.55);
    elevatorGroup.add(rightGateMesh);
    
    // Back Gates (entrance, at z = -0.04 local)
    backLeftGateMesh = new THREE.Mesh(gateGeo, gateMat);
    // Starts OPEN (slid to the left)
    backLeftGateMesh.position.set(-1.58, 1.25, -0.05);
    elevatorGroup.add(backLeftGateMesh);
    
    backRightGateMesh = new THREE.Mesh(gateGeo, gateMat);
    // Starts OPEN (slid to the right)
    backRightGateMesh.position.set(1.58, 1.25, -0.05);
    elevatorGroup.add(backRightGateMesh);
    
    portalGroup.add(elevatorGroup);
    
    // 7. Shaft Walls Setup
    // Create seamless rock texture for shaft
    const shaftCanvas = document.createElement('canvas');
    shaftCanvas.width = 512;
    shaftCanvas.height = 512;
    const sCtx = shaftCanvas.getContext('2d');
    
    // Background rock color
    sCtx.fillStyle = '#1c1815';
    sCtx.fillRect(0, 0, 512, 512);
    
    // Draw rocky cracks and patterns
    sCtx.strokeStyle = '#0d0b0a';
    for (let i = 0; i < 25; i++) {
        sCtx.lineWidth = 1 + Math.random() * 4;
        sCtx.beginPath();
        let lx = Math.random() * 512;
        let ly = Math.random() * 512;
        sCtx.moveTo(lx, ly);
        for (let j = 0; j < 5; j++) {
            lx += (Math.random() - 0.5) * 80;
            ly += (Math.random() - 0.5) * 80;
            // wrap around
            const wx = (lx + 512) % 512;
            const wy = (ly + 512) % 512;
            sCtx.lineTo(wx, wy);
        }
        sCtx.stroke();
    }
    
    // Spray details
    for (let i = 0; i < 4000; i++) {
        const x = Math.random() * 512;
        const y = Math.random() * 512;
        const col = 10 + Math.random() * 25;
        sCtx.fillStyle = `rgb(${col + 5}, ${col}, ${col - 2})`;
        sCtx.fillRect(x, y, 2, 2);
    }
    
    shaftTex = new THREE.CanvasTexture(shaftCanvas);
    shaftTex.wrapS = THREE.RepeatWrapping;
    shaftTex.wrapT = THREE.RepeatWrapping;
    shaftTex.repeat.set(1.5, 2);
    
    const shaftWallMat = new THREE.MeshStandardMaterial({
        map: shaftTex,
        roughness: 0.9,
        metalness: 0.1
    });
    
    // Plane geometries for the left, right, and top of the shaft
    const shaftWallGeo = new THREE.PlaneGeometry(4.0, 3.0);
    const shaftCeilingGeo = new THREE.PlaneGeometry(2.6, 4.0);
    const shaftEndGeo = new THREE.PlaneGeometry(2.6, 3.0);
    
    // Left shaft plane (outside left bars)
    const shaftLeft = new THREE.Mesh(shaftWallGeo, shaftWallMat);
    shaftLeft.position.set(-1.3, 1.5, -1.8);
    shaftLeft.rotation.y = Math.PI / 2;
    
    // Right shaft plane (outside right bars)
    const shaftRight = new THREE.Mesh(shaftWallGeo, shaftWallMat);
    shaftRight.position.set(1.3, 1.5, -1.8);
    shaftRight.rotation.y = -Math.PI / 2;
    
    // Ceiling shaft plane
    const shaftCeiling = new THREE.Mesh(shaftCeilingGeo, shaftWallMat);
    shaftCeiling.position.set(0, 2.9, -1.8);
    shaftCeiling.rotation.x = Math.PI / 2;
    shaftCeiling.rotation.z = Math.PI / 2;

    // Front shaft plane (outside front gates - blocks view of the mine!)
    const shaftFront = new THREE.Mesh(shaftEndGeo, shaftWallMat);
    shaftFront.position.set(0, 1.5, -3.62);
    // facing inside (+Z) is default

    // Back shaft plane (outside back gates - active only during descent)
    shaftBack = new THREE.Mesh(shaftEndGeo, shaftWallMat);
    shaftBack.position.set(0, 1.5, 0.02);
    shaftBack.rotation.y = Math.PI; // faces inside (-Z)
    shaftBack.visible = false; // Hidden at start to allow entry
    
    // Group all shaft meshes to hide/show them together
    shaftMesh = new THREE.Group();
    shaftMesh.add(shaftLeft);
    shaftMesh.add(shaftRight);
    shaftMesh.add(shaftCeiling);
    shaftMesh.add(shaftFront);
    shaftMesh.add(shaftBack);
    portalGroup.add(shaftMesh);
}


function createMiner() {
    const group = new THREE.Group();
    
    // Crate he sits on
    const crateGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.8 });
    const crate = new THREE.Mesh(crateGeo, crateMat);
    crate.position.y = 0.25;
    group.add(crate);
    
    // Torso (Orange high-vis jacket)
    const torsoGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.5, 8);
    const torsoMat = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.5 });
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 0.75;
    torso.rotation.x = 0.1;
    group.add(torso);
    
    // Reflective vest stripes (Silver bands)
    const stripeGeo = new THREE.CylinderGeometry(0.155, 0.155, 0.05, 8);
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8, roughness: 0.2 });
    const stripe1 = new THREE.Mesh(stripeGeo, stripeMat);
    stripe1.position.y = 0.1;
    torso.add(stripe1);
    const stripe2 = new THREE.Mesh(stripeGeo, stripeMat);
    stripe2.position.y = -0.1;
    torso.add(stripe2);

    // Head (Flesh tone)
    const headGeo = new THREE.SphereGeometry(0.12, 12, 12);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffdbac, roughness: 0.6 });
    minerHead = new THREE.Mesh(headGeo, headMat);
    minerHead.position.set(0, 0.35, 0.05);
    torso.add(minerHead);
    
    // Eyes
    const eyeGeo = new THREE.SphereGeometry(0.015, 8, 8);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.04, 0.02, 0.1);
    minerHead.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.04, 0.02, 0.1);
    minerHead.add(rightEye);

    // Helmet (Yellow)
    const helmetGeo = new THREE.SphereGeometry(0.13, 12, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const helmetMat = new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.3, metalness: 0.2 });
    const helmet = new THREE.Mesh(helmetGeo, helmetMat);
    helmet.position.y = 0.03;
    helmet.rotation.x = 0.1;
    minerHead.add(helmet);
    
    // Helmet Brim
    const brimGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.01, 12);
    const brim = new THREE.Mesh(brimGeo, helmetMat);
    brim.position.y = 0.01;
    helmet.add(brim);

    // Helmet Light (Cylinder)
    const lampGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.05, 8);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8 });
    const lampMesh = new THREE.Mesh(lampGeo, lampMat);
    lampMesh.rotation.x = Math.PI / 2;
    lampMesh.position.set(0, 0.08, 0.12);
    helmet.add(lampMesh);
    
    // Light Lens
    const lensGeo = new THREE.SphereGeometry(0.02, 8, 8);
    const lensMat = new THREE.MeshBasicMaterial({ color: 0xffffee });
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.position.y = 0.025;
    lampMesh.add(lens);

    // Miner's Headlamp spotlight
    minerLampLight = new THREE.SpotLight(0xfff0dd, 2, 6, Math.PI / 6, 0.5, 1);
    minerLampLight.position.set(0, 0.08, 0.15);
    const lampTarget = new THREE.Object3D();
    lampTarget.position.set(0, 0, 1.5);
    minerHead.add(lampTarget);
    minerLampLight.target = lampTarget;
    minerHead.add(minerLampLight);

    // Legs (Blue pants, sitting posture)
    const legMat = new THREE.MeshStandardMaterial({ color: 0x0044cc, roughness: 0.7 });
    
    // Left Leg Thigh
    const thighGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.3, 8);
    const leftThigh = new THREE.Mesh(thighGeo, legMat);
    leftThigh.rotation.x = Math.PI / 2;
    leftThigh.position.set(-0.12, 0.45, 0.15);
    group.add(leftThigh);
    
    // Left Leg Shin
    const shinGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.35, 8);
    const leftShin = new THREE.Mesh(shinGeo, legMat);
    leftShin.position.set(0, 0, 0.18);
    leftShin.rotation.x = -Math.PI / 2;
    leftThigh.add(leftShin);
    
    // Right Leg Thigh
    const rightThigh = new THREE.Mesh(thighGeo, legMat);
    rightThigh.rotation.x = Math.PI / 2;
    rightThigh.position.set(0.12, 0.45, 0.15);
    group.add(rightThigh);
    
    // Right Leg Shin
    const rightShin = new THREE.Mesh(shinGeo, legMat);
    rightShin.position.set(0, 0, 0.18);
    rightShin.rotation.x = -Math.PI / 2;
    rightThigh.add(rightShin);
    
    // Boots
    const bootGeo = new THREE.BoxGeometry(0.09, 0.07, 0.15);
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const leftBoot = new THREE.Mesh(bootGeo, bootMat);
    leftBoot.position.set(0, -0.18, 0.03);
    leftShin.add(leftBoot);
    
    const rightBoot = new THREE.Mesh(bootGeo, bootMat);
    rightBoot.position.set(0, -0.18, 0.03);
    rightShin.add(rightBoot);

    // Left Arm (Resting on lap)
    const armGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.35, 8);
    const leftArm = new THREE.Mesh(armGeo, torsoMat);
    leftArm.position.set(-0.2, 0.1, 0.05);
    leftArm.rotation.set(0.3, 0, 0.2);
    torso.add(leftArm);
    
    // Right Arm (Holding sandwich, animated)
    minerRightArm = new THREE.Mesh(armGeo, torsoMat);
    minerRightArm.position.set(0.2, 0.1, 0.05);
    minerRightArm.rotation.set(-0.3, 0, -0.2);
    torso.add(minerRightArm);
    
    // Forearm / Hand
    const forearmGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.15, 8);
    const forearm = new THREE.Mesh(forearmGeo, headMat);
    forearm.position.y = -0.15;
    forearm.rotation.x = -Math.PI / 2;
    minerRightArm.add(forearm);
    
    // Sandwich
    const sandwichGeo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
    const sandwichMat = new THREE.MeshStandardMaterial({ color: 0xeedcb3, roughness: 0.9 });
    const sandwich = new THREE.Mesh(sandwichGeo, sandwichMat);
    sandwich.position.y = -0.1;
    forearm.add(sandwich);
    
    // Add small red lunchbox next to him on the floor
    const boxGeo = new THREE.BoxGeometry(0.25, 0.18, 0.15);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x990000, roughness: 0.5, metalness: 0.3 });
    const lunchbox = new THREE.Mesh(boxGeo, boxMat);
    lunchbox.position.set(0.4, 0.09, 0.2);
    lunchbox.rotation.y = 0.4;
    group.add(lunchbox);
    
    // Lunchbox handle
    const handleGeo = new THREE.TorusGeometry(0.05, 0.01, 4, 12, Math.PI);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.8, roughness: 0.4 });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.set(0, 0.09, 0);
    lunchbox.add(handle);

    return group;
}

function createPickaxe() {
    const group = new THREE.Group();
    const handleGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.6);
    const handleMat = new THREE.MeshLambertMaterial({ color: 0x5c3a21 });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.y = 0.3;
    group.add(handle);

    const headGeo = new THREE.CylinderGeometry(0.01, 0.03, 0.4);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.8 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.rotation.z = Math.PI / 2;
    head.position.y = 0.55;
    group.add(head);

    return group;
}

function addPosters() {
    const loader = new THREE.TextureLoader();

    for (let i = 0; i < 3; i++) {
        // Load a separate texture instance for each mesh to allow independent repeat/offset
        const tex = loader.load('./posters.jpg');
        tex.colorSpace = THREE.SRGBColorSpace;
        
        // Slice the 3-panel poster horizontally (each is 1/3 of the total width)
        tex.repeat.set(1 / 3, 1);
        tex.offset.set(i / 3, 0);
        
        const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
        
        // Infographic panels are roughly 1:2 aspect ratio
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.6), mat);

        const zPos = 8.0 - (i * 6.0); // Spaced nicely in lit regions (z_tunnel = 8, 2, -4)
        const yPos = 0.1; // slightly higher
        
        if (i % 2 === 0) {
            // Left wall: place in front of the log logs (x = -1.76) and tilt inward to match logs
            plane.position.set(-tunnelWidth / 2 + 0.24, yPos, zPos);
            plane.rotation.set(0, Math.PI / 2, -0.12);
        } else {
            // Right wall: place in front of the log logs (x = 1.76) and tilt inward to match logs
            plane.position.set(tunnelWidth / 2 - 0.24, yPos, zPos);
            plane.rotation.set(0, -Math.PI / 2, 0.12);
        }
        
        tunnelGroup.add(plane);
    }
}

function placePortal() {
    if (reticle.visible && !portalPlaced) {
        portalGroup.position.setFromMatrixPosition(reticle.matrix);
        const euler = new THREE.Euler().setFromRotationMatrix(reticle.matrix);
        portalGroup.quaternion.setFromEuler(euler);
        
        portalGroup.visible = true;
        portalPlaced = true;
        
        document.getElementById('ui-container').style.display = 'none';
        
        const ctx = THREE.AudioContext.getContext();
        if(ctx.state === 'suspended') ctx.resume();
    }
}

function tryGrabPickaxe(controller) {
    if(!portalPlaced || pickaxeEquipped) return;
    
    const controllerPos = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
    const pickaxePos = new THREE.Vector3().setFromMatrixPosition(pickaxe.matrixWorld);
    
    if (controllerPos.distanceTo(pickaxePos) < 1.0) {
        pickaxeEquipped = true;
        tunnelGroup.remove(pickaxe);
        pickaxe.position.set(0, 0, 0);
        pickaxe.rotation.set(-Math.PI/2, 0, 0);
        controller.add(pickaxe);
    }
}

function spawnMiningParticles(position, count, isDestroyed = false) {
    const particleMat = new THREE.MeshStandardMaterial({
        color: 0x111111,
        roughness: 0.25,
        metalness: 0.9
    });
    
    const geo = new THREE.DodecahedronGeometry(0.045, 0);

    for (let i = 0; i < count; i++) {
        const mesh = new THREE.Mesh(geo, particleMat);
        
        // Spawn slightly offset from coal block position
        const offset = new THREE.Vector3(
            (Math.random() - 0.5) * 0.2,
            (Math.random() - 0.5) * 0.2,
            0.05
        );
        mesh.position.copy(position).add(offset);
        
        // Random size variance
        const scale = (isDestroyed ? 0.6 : 0.4) + Math.random() * 0.8;
        mesh.scale.setScalar(scale);
        
        tunnelGroup.add(mesh);
        
        // Physical velocities inside tunnel coordinate space:
        // Fly backwards away from the wall (+Z) and expand in X/Y
        const vx = (Math.random() - 0.5) * 2.0;
        const vy = (Math.random() - 0.5) * 1.0 + 1.5; // fly upwards
        const vz = Math.random() * 2.2 + 0.8; // fly away from the end wall (+Z)
        
        miningParticles.push({
            mesh,
            vx,
            vy,
            vz,
            age: 0,
            maxAge: 1.2 + Math.random() * 0.5
        });
    }
}

function swingPickaxe() {
    if (hitSound.isPlaying) hitSound.stop();
    hitSound.play();
    
    // Check if player hits an active coal block
    const playerPos = camera.position.clone();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    
    let hitBlock = null;
    let minRayDistance = Infinity;
    
    coalBlocks.forEach(block => {
        const blockWorldPos = new THREE.Vector3();
        block.getWorldPosition(blockWorldPos);
        
        // Vector from player camera to coal block
        const toBlock = blockWorldPos.clone().sub(playerPos);
        const dist = toBlock.length();
        
        if (dist < 2.5) { // range of pickaxe reach
            const proj = toBlock.normalize().dot(forward);
            if (proj > 0.80) { // looking in the direction of the block
                const rayDist = playerPos.clone().addScaledVector(forward, dist).distanceTo(blockWorldPos);
                if (rayDist < 0.5 && rayDist < minRayDistance) {
                    minRayDistance = rayDist;
                    hitBlock = block;
                }
            }
        }
    });

    if (hitBlock) {
        hitBlock.userData.hits--;
        const localHitPos = hitBlock.position.clone();
        
        // Scale down size based on remaining hits
        const originalScale = hitBlock.userData.originalScale;
        const remainingRatio = hitBlock.userData.hits / hitBlock.userData.maxHits;
        const targetScale = originalScale * (0.35 + 0.65 * remainingRatio);
        
        // Hit flash pop animation
        hitBlock.scale.setScalar(targetScale * 1.3);
        setTimeout(() => {
            if (hitBlock && hitBlock.parent) {
                hitBlock.scale.setScalar(targetScale);
            }
        }, 80);

        if (hitBlock.userData.hits <= 0) {
            // Shattered! Spawn large debris burst
            spawnMiningParticles(localHitPos, 22, true);
            
            // Remove block
            tunnelGroup.remove(hitBlock);
            const index = coalBlocks.indexOf(hitBlock);
            if (index > -1) {
                coalBlocks.splice(index, 1);
            }
            
            // Haptic/vibration feedback
            if (navigator.vibrate) {
                navigator.vibrate([100, 50, 100, 50, 200]);
            }
        } else {
            // Spawn small chip particles
            spawnMiningParticles(localHitPos, 7, false);
        }
    }
    
    // Rumble standard AR
    if (hitTestSource && window.navigator && navigator.xr) { 
       const session = renderer.xr.getSession();
       if (session && session.inputSources) {
           session.inputSources.forEach(source => {
               if (source.gamepad && source.gamepad.hapticActuators && source.gamepad.hapticActuators.length > 0) {
                   source.gamepad.hapticActuators[0].pulse(0.6, 120);
               }
           });
       }
    }
    
    // Mobile vibration fallback
    if (isFallbackMode && navigator.vibrate) {
        navigator.vibrate(100);
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
    const delta = clock.getDelta();

    // Update active mining debris particles (gravity, velocity, floor bounce, fade out)
    for (let i = miningParticles.length - 1; i >= 0; i--) {
        const p = miningParticles[i];
        p.age += delta;
        
        // Gravity
        p.vy -= 9.8 * delta;
        
        // Velocity update
        p.mesh.position.x += p.vx * delta;
        p.mesh.position.y += p.vy * delta;
        p.mesh.position.z += p.vz * delta;
        
        // Floor collision check (floor is at y = -1.5 in tunnelGroup coordinates)
        const floorY = -tunnelHeight / 2 + 0.02;
        if (p.mesh.position.y <= floorY) {
            p.mesh.position.y = floorY;
            p.vy = -p.vy * 0.25; // bounce bounce
            p.vx *= 0.75;        // ground friction
            p.vz *= 0.75;
            if (Math.abs(p.vy) < 0.25) p.vy = 0;
        }
        
        // Fade out
        if (p.age > p.maxAge - 0.3) {
            const scaleRatio = Math.max(0, (p.maxAge - p.age) / 0.3);
            p.mesh.scale.setScalar(scaleRatio);
        }
        
        // Remove expired particles
        if (p.age >= p.maxAge) {
            tunnelGroup.remove(p.mesh);
            p.mesh.geometry.dispose();
            p.mesh.material.dispose();
            miningParticles.splice(i, 1);
        }
    }

    if (tunnelGroup) {
        const particles = tunnelGroup.children.find(c => c.type === 'Points');
        if (particles) {
            particles.position.y += Math.sin(timestamp * 0.001) * 0.005;
        }
    }
    
    // Flickering Point Lights
    pointLights.forEach(light => {
        const base = light.userData.baseIntensity || 0.6;
        const noise = (Math.random() - 0.5) * 0.12;
        const wave = Math.sin(timestamp * 0.007 + light.position.z) * 0.05 + 
                     Math.cos(timestamp * 0.013 - light.position.z) * 0.03;
        light.intensity = Math.max(0.1, base + noise + wave);
    });
    
    // Animate sitting miner (Breathing + eating sandwich)
    if (minerGroup && minerHead && minerRightArm) {
        // Slow breathing
        const breathe = Math.sin(timestamp * 0.0015) * 0.02;
        minerHead.rotation.x = 0.15 + breathe;
        
        // Eating cycle
        const cycle = (timestamp * 0.0005) % (Math.PI * 2);
        let armAngle = -0.3; // resting angle
        
        if (cycle > Math.PI && cycle < Math.PI * 1.5) {
            // Raising arm
            const t = (cycle - Math.PI) / (Math.PI * 0.5);
            armAngle = -0.3 - t * 1.1; 
        } else if (cycle >= Math.PI * 1.5 && cycle < Math.PI * 1.9) {
            // Holding at mouth (eating/chewing)
            armAngle = -1.4;
            // Nod head slightly to simulate chewing
            minerHead.rotation.x += Math.sin(timestamp * 0.015) * 0.03;
        } else if (cycle >= Math.PI * 1.9) {
            // Lowering arm
            const t = (cycle - Math.PI * 1.9) / (Math.PI * 0.1);
            armAngle = -1.4 + t * 1.1;
        }
        
        minerRightArm.rotation.x = armAngle;
    }
    
    updateFallbackMovement(delta);

    // Smooth pickaxe swing animation (sinusoidal rotation and position dip)
    if (pickaxeEquipped && swingProgress > 0) {
        swingProgress -= delta * 5.0; // swing animation takes 0.2 seconds
        if (swingProgress < 0) swingProgress = 0;

        const swingAngle = Math.sin((1.0 - swingProgress) * Math.PI) * 0.8;

        // Apply sinusoidal rotation (rotation.x swings down, rotation.z rolls inward)
        pickaxe.rotation.x = -Math.PI / 4 - swingAngle * 1.2;
        pickaxe.rotation.y = swingAngle * 0.2;
        pickaxe.rotation.z = swingAngle * 0.4;

        // Thrust pickaxe forward and drop it down slightly on impact
        pickaxe.position.set(
            0.3 - swingAngle * 0.1,
            -0.3 - swingAngle * 0.2,
            -0.5 - swingAngle * 0.25
        );
    } else if (pickaxeEquipped) {
        // Return to resting position
        pickaxe.rotation.set(-Math.PI / 4, 0, 0);
        pickaxe.position.set(0.3, -0.3, -0.5);
    }

    // Elevator (Cage) descent and gate opening animation
    const localCamPos = new THREE.Vector3();
    if (portalGroup && (isFallbackMode || portalPlaced)) {
        localCamPos.copy(camera.position);
        portalGroup.worldToLocal(localCamPos);
        
        // Trigger descent if user steps inside the cage
        if (elevatorState === 'BEFORE_START') {
            if (localCamPos.z < -0.4 && Math.abs(localCamPos.x) < 1.0 && localCamPos.z > -3.3) {
                startElevatorDescent();
            }
        }
    }

    if (elevatorState === 'DESCENDING') {
        elevatorTime += delta;

        // 1. Close the back gates (0.8s duration)
        if (elevatorTime < 0.8) {
            const t = elevatorTime / 0.8;
            backLeftGateMesh.position.x = -1.58 + t * (1.58 - 0.53);
            backRightGateMesh.position.x = 1.58 - t * (1.58 - 0.53);
        } else {
            backLeftGateMesh.position.x = -0.53;
            backRightGateMesh.position.x = 0.53;
        }

        // 2. Scroll the shaft texture
        if (shaftTex) {
            shaftTex.offset.y += 2.0 * delta;
        }

        // 3. Shake/vibrate effect
        const shakeX = (Math.random() - 0.5) * 0.012;
        const shakeY = (Math.random() - 0.5) * 0.012;
        const shakeZ = (Math.random() - 0.5) * 0.012;
        if (isFallbackMode) {
            camera.position.set(shakeX, tunnelHeight / 2 - 0.2 + shakeY, -1.8 + shakeZ);
        } else {
            elevatorGroup.position.set(shakeX, shakeY, shakeZ);
        }

        // 4. Transition to arrival (6 seconds descent)
        if (elevatorTime >= 6.0) {
            elevatorState = 'ARRIVED';
            elevatorTime = 0;

            if (elevatorRumbleSound && elevatorRumbleSound.isPlaying) {
                elevatorRumbleSound.stop();
            }

            // Reset positioning offsets from shake
            if (isFallbackMode) {
                camera.position.set(0, tunnelHeight / 2 - 0.2, -1.8);
            } else {
                elevatorGroup.position.set(0, 0, 0);
            }

            // Play door clang for opening
            if (elevatorGateSound) {
                if (elevatorGateSound.isPlaying) elevatorGateSound.stop();
                elevatorGateSound.play();
            }

            elevatorState = 'OPENING';
        }
    }

    if (elevatorState === 'OPENING') {
        elevatorTime += delta;

        // Slide open the front gates (1.5s duration)
        if (elevatorTime < 1.5) {
            const t = elevatorTime / 1.5;
            leftGateMesh.position.x = -0.53 - t * (1.58 - 0.53);
            rightGateMesh.position.x = 0.53 + t * (1.58 - 0.53);
        } else {
            leftGateMesh.position.x = -1.58;
            rightGateMesh.position.x = 1.58;
            elevatorState = 'FINISHED';

            // Hide outer shaft walls to reveal the mine
            if (shaftMesh) {
                shaftMesh.visible = false;
            }
        }
    }

    if (frame && !isFallbackMode) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (hitTestSourceRequested === false) {
            session.requestReferenceSpace('viewer').then(function (referenceSpace) {
                session.requestHitTestSource({ space: referenceSpace }).then(function (source) {
                    hitTestSource = source;
                });
            });
            session.addEventListener('end', function () {
                hitTestSourceRequested = false;
                hitTestSource = null;
            });
            hitTestSourceRequested = true;
        }

        if (hitTestSource && !portalPlaced) {
            const hitTestResults = frame.getHitTestResults(hitTestSource);

            if (hitTestResults.length > 0) {
                const hit = hitTestResults[0];
                reticle.visible = true;
                reticle.matrix.fromArray(hit.getPose(referenceSpace).transform.matrix);
            } else {
                reticle.visible = false;
            }
        }
    }

    renderer.render(scene, camera);
}
