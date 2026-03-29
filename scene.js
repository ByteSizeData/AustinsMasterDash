/* ===== Austin's Master Dash — Three.js Orbital Scene ===== */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const COLORS = {
  red: new THREE.Color(0xff4757),
  yellow: new THREE.Color(0xffc312),
  green: new THREE.Color(0x2ed573),
  completed: new THREE.Color(0x444466),
  core: new THREE.Color(0xff6348),
};

const RING_RADII = { red: 4, yellow: 8, green: 13 };
const NODE_SIZES = { red: 0.45, yellow: 0.35, green: 0.28 };

let scene, camera, renderer, controls;
let coreMesh, coreGlow, coreLight;
let taskNodes = [];
let raycaster, mouse;
let hoveredNode = null;
let clock;
let starField;

// ===== Init =====
function init() {
  const canvas = document.getElementById('orbit-canvas');
  clock = new THREE.Clock();

  // Scene
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050510, 0.012);

  // Camera
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(0, 12, 18);
  camera.lookAt(0, 0, 0);

  // Renderer
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  // Controls
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 8;
  controls.maxDistance = 40;
  controls.maxPolarAngle = Math.PI * 0.75;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.3;

  // Lights
  scene.add(new THREE.AmbientLight(0x222244, 0.5));
  coreLight = new THREE.PointLight(0xff6348, 2, 30);
  scene.add(coreLight);

  // Raycaster
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // Build scene
  createStarField();
  createCore();
  createOrbitRings();

  // Events
  window.addEventListener('resize', onResize);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('click', onClick);

  // Wait for app.js to load tasks, then build nodes
  setTimeout(buildNodes, 500);

  // Animation
  animate();
}

// ===== Star Field =====
function createStarField() {
  const geo = new THREE.BufferGeometry();
  const count = 2000;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 150;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 150;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 150;
    sizes[i] = Math.random() * 1.5 + 0.5;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const mat = new THREE.PointsMaterial({
    color: 0x8888cc,
    size: 0.15,
    transparent: true,
    opacity: 0.6,
    sizeAttenuation: true,
  });

  starField = new THREE.Points(geo, mat);
  scene.add(starField);
}

// ===== Core =====
function createCore() {
  // Main sphere
  const geo = new THREE.SphereGeometry(0.8, 32, 32);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xff6348,
    emissive: 0xff4500,
    emissiveIntensity: 1.5,
    roughness: 0.3,
    metalness: 0.6,
  });
  coreMesh = new THREE.Mesh(geo, mat);
  scene.add(coreMesh);

  // Glow sphere
  const glowGeo = new THREE.SphereGeometry(1.4, 32, 32);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xff6348,
    transparent: true,
    opacity: 0.08,
    side: THREE.BackSide,
  });
  coreGlow = new THREE.Mesh(glowGeo, glowMat);
  scene.add(coreGlow);

  // Second glow layer
  const glow2Geo = new THREE.SphereGeometry(2.2, 32, 32);
  const glow2Mat = new THREE.MeshBasicMaterial({
    color: 0xff6348,
    transparent: true,
    opacity: 0.03,
    side: THREE.BackSide,
  });
  scene.add(new THREE.Mesh(glow2Geo, glow2Mat));
}

// ===== Orbit Rings =====
function createOrbitRings() {
  const ringConfigs = [
    { radius: RING_RADII.red, color: 0xff4757, opacity: 0.15 },
    { radius: RING_RADII.yellow, color: 0xffc312, opacity: 0.10 },
    { radius: RING_RADII.green, color: 0x2ed573, opacity: 0.07 },
  ];

  for (const cfg of ringConfigs) {
    const geo = new THREE.RingGeometry(cfg.radius - 0.03, cfg.radius + 0.03, 128);
    const mat = new THREE.MeshBasicMaterial({
      color: cfg.color,
      transparent: true,
      opacity: cfg.opacity,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    scene.add(ring);

    // Dotted ring outline
    const points = [];
    for (let i = 0; i <= 128; i++) {
      const angle = (i / 128) * Math.PI * 2;
      points.push(new THREE.Vector3(
        Math.cos(angle) * cfg.radius,
        0,
        Math.sin(angle) * cfg.radius
      ));
    }
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const lineMat = new THREE.LineBasicMaterial({
      color: cfg.color,
      transparent: true,
      opacity: cfg.opacity * 1.5,
    });
    scene.add(new THREE.Line(lineGeo, lineMat));
  }
}

// ===== Task Nodes =====
function buildNodes() {
  // Remove old nodes
  for (const node of taskNodes) {
    scene.remove(node.mesh);
    if (node.glowMesh) scene.remove(node.glowMesh);
    if (node.trail) scene.remove(node.trail);
  }
  taskNodes = [];

  if (typeof window.getTasksForScene !== 'function') {
    setTimeout(buildNodes, 300);
    return;
  }

  const tasks = window.getTasksForScene();
  if (!tasks || tasks.length === 0) return;

  // Group by urgency
  const groups = { red: [], yellow: [], green: [] };
  for (const t of tasks) {
    const u = t.urgency || 'green';
    if (groups[u]) groups[u].push(t);
  }

  // Create nodes for each group
  for (const [urgency, items] of Object.entries(groups)) {
    const radius = RING_RADII[urgency];
    const size = NODE_SIZES[urgency];
    const color = COLORS[urgency];
    const count = items.length;

    items.forEach((task, i) => {
      const angle = (i / Math.max(count, 1)) * Math.PI * 2;
      const isCompleted = task.completed;

      // Main sphere
      const geo = new THREE.SphereGeometry(isCompleted ? size * 0.6 : size, 24, 24);
      const mat = new THREE.MeshStandardMaterial({
        color: isCompleted ? COLORS.completed : color,
        emissive: isCompleted ? 0x222233 : color,
        emissiveIntensity: isCompleted ? 0.2 : 0.8,
        roughness: 0.4,
        metalness: 0.5,
        transparent: isCompleted,
        opacity: isCompleted ? 0.4 : 1,
      });
      const mesh = new THREE.Mesh(geo, mat);

      // Position on ring
      const jitter = (Math.random() - 0.5) * 1.5;
      mesh.position.set(
        Math.cos(angle) * (radius + jitter),
        (Math.random() - 0.5) * 1.5,
        Math.sin(angle) * (radius + jitter)
      );

      mesh.userData = { taskId: task.id, urgency, baseAngle: angle, radius: radius + jitter };
      scene.add(mesh);

      // Glow
      let glowMesh = null;
      if (!isCompleted) {
        const glowGeo = new THREE.SphereGeometry(size * 2, 16, 16);
        const glowMat = new THREE.MeshBasicMaterial({
          color: color,
          transparent: true,
          opacity: 0.06,
          side: THREE.BackSide,
        });
        glowMesh = new THREE.Mesh(glowGeo, glowMat);
        glowMesh.position.copy(mesh.position);
        scene.add(glowMesh);
      }

      taskNodes.push({
        mesh,
        glowMesh,
        task,
        urgency,
        baseAngle: angle,
        radius: radius + jitter,
        orbitSpeed: 0.08 + Math.random() * 0.04,
        yOffset: mesh.position.y,
      });
    });
  }
}

// ===== Animation =====
function animate() {
  requestAnimationFrame(animate);
  const elapsed = clock.getElapsedTime();

  // Core pulse
  if (coreMesh) {
    const pulse = 1 + Math.sin(elapsed * 2) * 0.08;
    coreMesh.scale.setScalar(pulse);
    coreGlow.scale.setScalar(pulse * 1.75);
    coreMesh.material.emissiveIntensity = 1.2 + Math.sin(elapsed * 3) * 0.4;
  }

  // Orbit task nodes
  for (const node of taskNodes) {
    const speed = node.orbitSpeed * (node.urgency === 'red' ? 1.5 : node.urgency === 'yellow' ? 1 : 0.6);
    const angle = node.baseAngle + elapsed * speed;
    node.mesh.position.x = Math.cos(angle) * node.radius;
    node.mesh.position.z = Math.sin(angle) * node.radius;
    node.mesh.position.y = node.yOffset + Math.sin(elapsed * 0.8 + node.baseAngle) * 0.3;

    if (node.glowMesh) {
      node.glowMesh.position.copy(node.mesh.position);
      node.glowMesh.material.opacity = 0.04 + Math.sin(elapsed * 2 + node.baseAngle) * 0.03;
    }

    // Scale pulse for red urgency
    if (node.urgency === 'red' && !node.task.completed) {
      const p = 1 + Math.sin(elapsed * 3 + node.baseAngle) * 0.1;
      node.mesh.scale.setScalar(p);
    }
  }

  // Subtle star rotation
  if (starField) {
    starField.rotation.y = elapsed * 0.005;
    starField.rotation.x = elapsed * 0.002;
  }

  controls.update();
  renderer.render(scene, camera);
}

// ===== Interaction =====
function onMouseMove(e) {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const meshes = taskNodes.map(n => n.mesh);
  const intersects = raycaster.intersectObjects(meshes);

  const tooltip = document.getElementById('hover-tooltip');
  const canvas = document.getElementById('orbit-canvas');

  if (intersects.length > 0) {
    const hit = intersects[0].object;
    const node = taskNodes.find(n => n.mesh === hit);
    if (node && node !== hoveredNode) {
      hoveredNode = node;
      canvas.style.cursor = 'pointer';

      tooltip.innerHTML = `
        <div class="tt-name">${escapeHtml(node.task.name)}</div>
        <div class="tt-due">${node.task.course} &middot; ${node.task.dueLabel || 'No due date'}</div>
      `;
      tooltip.classList.add('visible');
    }
    if (node) {
      tooltip.style.left = (e.clientX + 15) + 'px';
      tooltip.style.top = (e.clientY - 10) + 'px';
    }
  } else {
    if (hoveredNode) {
      hoveredNode = null;
      canvas.style.cursor = 'default';
      tooltip.classList.remove('visible');
    }
  }
}

function onClick(e) {
  raycaster.setFromCamera(mouse, camera);
  const meshes = taskNodes.map(n => n.mesh);
  const intersects = raycaster.intersectObjects(meshes);

  if (intersects.length > 0) {
    const hit = intersects[0].object;
    const node = taskNodes.find(n => n.mesh === hit);
    if (node && typeof window.onTaskSelected === 'function') {
      window.onTaskSelected(node.task.id);
    }
  }
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Expose rebuild function for app.js
window.rebuildScene = buildNodes;

// Start
init();
