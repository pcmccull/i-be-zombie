import * as THREE from 'three';

const app = document.getElementById('app');
const hud = document.getElementById('hud');

if (hud) {
  hud.textContent = 'I BE ZOMBIE - loading';
}

if (app) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  app.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x4a5260);
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
  renderer.render(scene, camera);
}
