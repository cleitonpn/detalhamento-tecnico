import { useEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  Grid,
  GizmoHelper,
  GizmoViewport,
  OrthographicCamera,
  PerspectiveCamera,
} from "@react-three/drei";
import * as THREE from "three";
import { SCALE } from "../domain/project.js";

function Model({ scene, project, selected, isolate, xray, onSelect }) {
  const { invalidate } = useThree();
  const model = useMemo(() => scene.clone(true), [scene]);
  const materials = useMemo(() => {
    const map = new Map();
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material)
        ? o.material.map((m) => m.clone())
        : o.material.clone();
      map.set(
        o,
        (Array.isArray(o.material) ? o.material : [o.material]).map((m) => ({
          color: m.color?.clone(),
          opacity: m.opacity,
          transparent: m.transparent,
          depthWrite: m.depthWrite,
          emissive: m.emissive?.clone(),
        })),
      );
    });
    return map;
  }, [model]);
  useEffect(
    () => () => {
      materials.forEach((_, o) =>
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
          m.dispose(),
        ),
      );
    },
    [materials],
  );
  useEffect(() => {
    const membership = new Map(
      project.parts.flatMap((p) => p.meshIds.map((id) => [id, p])),
    );
    materials.forEach((originals, mesh) => {
      const part = membership.get(mesh.userData.dtPath),
        active = selected.includes(part?.id);
      mesh.visible = Boolean(part) && (!isolate || !selected.length || active);
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(
        (m, i) => {
          if (m.color && originals[i].color) m.color.copy(originals[i].color);
          if (m.emissive) {
            if (active) m.emissive.set("#0b664f");
            else if (originals[i].emissive)
              m.emissive.copy(originals[i].emissive);
          }
          m.transparent = xray && !active ? true : originals[i].transparent;
          m.opacity = xray && !active ? 0.12 : originals[i].opacity;
          m.depthWrite = xray && !active ? false : originals[i].depthWrite;
        },
      );
    });
    invalidate();
  }, [materials, project.parts, selected, isolate, xray, invalidate]);
  return (
    <group scale={SCALE[project.sourceUnit]}>
      <primitive
        object={model}
        onClick={(event) => {
          event.stopPropagation();
          const part = project.parts.find((p) =>
            p.meshIds.includes(event.object.userData.dtPath),
          );
          if (part)
            onSelect(part.id, event.shiftKey || event.ctrlKey || event.metaKey);
        }}
      />
    </group>
  );
}

function CameraRig({ project, selected, view, focusTick }) {
  const { camera, controls, invalidate, size: viewport } = useThree();
  const previous = useRef("");
  useEffect(() => {
    if (!project || !controls) return;
    const key = `${project.id}:${project.sourceUnit}:${view}:${focusTick}:${viewport.width}:${viewport.height}`;
    if (previous.current === key) return;
    previous.current = key;
    const parts =
      focusTick && selected.length
        ? project.parts.filter((p) => selected.includes(p.id))
        : project.parts;
    const box = new THREE.Box3();
    parts.forEach((p) => {
      box.union(
        new THREE.Box3(
          new THREE.Vector3(...p.bounds.min),
          new THREE.Vector3(...p.bounds.max),
        ),
      );
    });
    const center = box.getCenter(new THREE.Vector3()),
      size = box.getSize(new THREE.Vector3());
    const radius = Math.max(...size.toArray(), 0.5) * 1.15;
    const directions = {
      perspective: [0.9, 0.6, 1],
      top: [0, 1, 0.001],
      front: [0, 0, 1],
      side: [1, 0, 0],
    };
    camera.up.set(...(view === "top" ? [0, 0, -1] : [0, 1, 0]));
    if (camera.isOrthographicCamera) {
      const [w, h] =
        view === "top"
          ? [size.x, size.z]
          : view === "side"
            ? [size.z, size.y]
            : [size.x, size.y];
      camera.zoom =
        Math.min(
          viewport.width / Math.max(w, 0.1),
          viewport.height / Math.max(h, 0.1),
        ) * 0.72;
    }
    const halfFov = THREE.MathUtils.degToRad((camera.fov || 38) / 2);
    const horizontalFov = Math.atan(
      (Math.tan(halfFov) * viewport.width) / Math.max(viewport.height, 1),
    );
    const distance = camera.isPerspectiveCamera
      ? (Math.max(size.length() / 2, 0.25) /
          Math.sin(Math.min(halfFov, horizontalFov))) *
        1.12
      : radius * 1.65;
    camera.position
      .copy(center)
      .add(
        new THREE.Vector3(...directions[view])
          .normalize()
          .multiplyScalar(distance),
      );
    controls.target.copy(center);
    camera.near = Math.max(radius / 1000, 0.001);
    camera.far = radius * 100;
    camera.updateProjectionMatrix();
    controls.update();
    invalidate();
  }, [
    project,
    view,
    focusTick,
    selected,
    camera,
    controls,
    invalidate,
    viewport,
  ]);
  return null;
}

function SelectionBox({ project, selected }) {
  const { invalidate } = useThree();
  const helper = useMemo(() => {
    if (!selected.length || !project) return null;
    const box = new THREE.Box3();
    project.parts
      .filter((p) => selected.includes(p.id))
      .forEach((p) =>
        box.union(
          new THREE.Box3(
            new THREE.Vector3(...p.bounds.min),
            new THREE.Vector3(...p.bounds.max),
          ),
        ),
      );
    return new THREE.Box3Helper(box, "#16e0a3");
  }, [project, selected]);
  useEffect(() => {
    invalidate();
    return () => {
      helper?.geometry.dispose();
      helper?.material.dispose();
    };
  }, [helper, invalidate]);
  return helper ? <primitive object={helper} /> : null;
}

export default function Viewer({
  scene,
  project,
  selected,
  view,
  focusTick,
  isolate,
  xray,
  onSelect,
  onReady,
}) {
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.5]}
      gl={{ antialias: true, preserveDrawingBuffer: false }}
      camera={{ position: [8, 6, 8], fov: 38 }}
      onCreated={({ gl }) => onReady(gl)}
      onPointerMissed={() => onSelect(null)}
    >
      {view === "perspective" ? (
        <PerspectiveCamera makeDefault fov={38} position={[8, 6, 8]} />
      ) : (
        <OrthographicCamera makeDefault position={[8, 6, 8]} zoom={40} />
      )}
      <color attach="background" args={["#c2ccda"]} />
      <ambientLight intensity={1.7} />
      <directionalLight position={[10, 20, 12]} intensity={2.3} />
      <directionalLight position={[-8, 8, -10]} intensity={1} />
      <OrbitControls
        makeDefault
        minPolarAngle={0.02}
        maxPolarAngle={Math.PI * 0.9}
        enableDamping
        dampingFactor={0.12}
      />
      <Grid
        position={[0, -0.002, 0]}
        args={[40, 40]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#a9b6c6"
        sectionSize={5}
        sectionThickness={0.8}
        sectionColor="#7d8da3"
        fadeDistance={35}
        infiniteGrid
      />
      {scene && project && (
        <>
          <Model {...{ scene, project, selected, isolate, xray, onSelect }} />
          <CameraRig {...{ project, selected, view, focusTick }} />
          <SelectionBox {...{ project, selected }} />
        </>
      )}
      <GizmoHelper alignment="bottom-right" margin={[70, 65]}>
        <GizmoViewport
          axisColors={["#ef7188", "#16b98c", "#438cf3"]}
          labelColor="white"
        />
      </GizmoHelper>
    </Canvas>
  );
}
