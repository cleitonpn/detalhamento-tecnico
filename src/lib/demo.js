import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

export async function demoFile() {
  const scene = new THREE.Scene();
  function box(name, size, center, color, materialName) {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
    material.name = materialName;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.name = name;
    mesh.position.set(...center);
    scene.add(mesh);
  }
  box("Piso", [6, 0.1, 4], [3, 0.05, -2], "#8797a3", "Carpete");
  box("Parede de fundo", [6, 2.9, 0.1], [3, 1.55, -3.95], "#cabda1", "Madeira");
  box(
    "Parede lateral",
    [0.1, 2.9, 3.8],
    [0.05, 1.55, -2],
    "#cabda1",
    "Madeira",
  );
  box("Balcão", [2, 1, 0.5], [3, 0.6, -1.2], "#dedbcf", "MDF branco");
  box("Samsung TV", [1.24, 0.7, 0.04], [4.5, 1.85, -3.87], "#182032", "TV");
  box("Testeira frontal", [6, 0.8, 0.1], [3, 3.5, -0.05], "#273349", "Bagum");
  box("Testeira lateral", [0.1, 0.8, 4], [0.05, 3.5, -2], "#273349", "Bagum");
  for (const [i, x, z] of [
    [1, 0.05, -0.05],
    [2, 5.95, -0.05],
    [3, 5.95, -3.95],
  ]) {
    box(`Pilar ${i}`, [0.1, 3, 0.1], [x, 1.6, z], "#3d4d59", "Metal");
  }
  const result = await new GLTFExporter().parseAsync(scene, { binary: true });
  scene.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  return new File([result], "Stand demonstrativo.glb", {
    type: "model/gltf-binary",
  });
}
