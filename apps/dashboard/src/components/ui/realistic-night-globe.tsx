import { OrbitControls, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo } from "react";
import ThreeGlobe from "three-globe";
import { Color, Fog, MeshPhongMaterial } from "three";

const BRAND_CYAN = "#18d5f2";
const BRAND_BLUE = "#2584ff";
const BRAND_VIOLET = "#7c3aed";
const BRAND_VIOLET_SOFT = "#a78bfa";
const ARC_COLORS = [BRAND_CYAN, BRAND_BLUE, BRAND_VIOLET, BRAND_VIOLET_SOFT];

interface ArcDatum {
  order: number;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  arcAlt: number;
  color: string;
}

interface PointDatum {
  lat: number;
  lng: number;
  color: string;
}

// The same global telemetry story as the original globe, now layered over a
// photographic night-Earth texture. The original implementation remains in
// github-globe.tsx and can be restored with a one-line import change in App.
const arcs: ArcDatum[] = [
  { order: 1, startLat: 52.37, startLng: 4.89, endLat: 40.71, endLng: -74.01, arcAlt: 0.22, color: ARC_COLORS[0] },
  { order: 2, startLat: 50.11, startLng: 8.68, endLat: 1.35, endLng: 103.82, arcAlt: 0.3, color: ARC_COLORS[2] },
  { order: 3, startLat: 59.33, startLng: 18.06, endLat: 35.68, endLng: 139.69, arcAlt: 0.36, color: ARC_COLORS[1] },
  { order: 4, startLat: 37.77, startLng: -122.42, endLat: 51.51, endLng: -0.13, arcAlt: 0.25, color: ARC_COLORS[2] },
  { order: 5, startLat: -33.87, startLng: 151.21, endLat: 1.35, endLng: 103.82, arcAlt: 0.2, color: ARC_COLORS[0] },
  { order: 6, startLat: 25.2, startLng: 55.27, endLat: 48.86, endLng: 2.35, arcAlt: 0.18, color: ARC_COLORS[3] },
  { order: 7, startLat: -23.55, startLng: -46.63, endLat: 40.71, endLng: -74.01, arcAlt: 0.28, color: ARC_COLORS[1] },
  { order: 8, startLat: 28.61, startLng: 77.21, endLat: 52.37, endLng: 4.89, arcAlt: 0.34, color: ARC_COLORS[2] },
  { order: 9, startLat: 43.65, startLng: -79.38, endLat: 37.77, endLng: -122.42, arcAlt: 0.16, color: ARC_COLORS[0] },
  { order: 10, startLat: -1.29, startLng: 36.82, endLat: 25.2, endLng: 55.27, arcAlt: 0.17, color: ARC_COLORS[3] },
];

const ringPoints: PointDatum[] = Array.from(
  new Map(
    arcs.flatMap((arc) => [
      [`${arc.startLat},${arc.startLng}`, { lat: arc.startLat, lng: arc.startLng, color: arc.color }],
      [`${arc.endLat},${arc.endLng}`, { lat: arc.endLat, lng: arc.endLng, color: arc.color }],
    ]),
  ).values(),
);

function SceneFog() {
  const { scene } = useThree();

  useEffect(() => {
    scene.fog = new Fog("#020817", 255, 390);
    return () => {
      scene.fog = null;
    };
  }, [scene]);

  return null;
}

function NightEarthObject() {
  const globe = useMemo(() => new ThreeGlobe(), []);

  useEffect(() => {
    const material = globe.globeMaterial() as MeshPhongMaterial;
    material.color = new Color("#ffffff");
    material.emissive = new Color("#07152e");
    material.emissiveIntensity = 0.16;
    material.specular = new Color("#16477c");
    material.shininess = 7;
    material.bumpScale = 7;

    globe
      .globeImageUrl("/textures/earth-night.jpg")
      .bumpImageUrl("/textures/earth-topology.png")
      .showAtmosphere(true)
      .atmosphereColor(BRAND_BLUE)
      .atmosphereAltitude(0.13)
      .arcsData(arcs)
      .arcStartLat((datum) => (datum as ArcDatum).startLat)
      .arcStartLng((datum) => (datum as ArcDatum).startLng)
      .arcEndLat((datum) => (datum as ArcDatum).endLat)
      .arcEndLng((datum) => (datum as ArcDatum).endLng)
      .arcColor((datum: object) => (datum as ArcDatum).color)
      .arcAltitude((datum) => (datum as ArcDatum).arcAlt)
      .arcStroke(0.62)
      .arcDashLength(0.52)
      .arcDashGap(1.05)
      .arcDashInitialGap((datum: object) => (datum as ArcDatum).order * 0.35)
      .arcDashAnimateTime(1900)
      .pointsData(ringPoints)
      .pointLat((datum) => (datum as PointDatum).lat)
      .pointLng((datum) => (datum as PointDatum).lng)
      .pointColor((datum) => (datum as PointDatum).color)
      .pointAltitude(0.015)
      .pointRadius(0.105)
      .pointsMerge(true)
      .ringsData(ringPoints)
      .ringLat((datum) => (datum as PointDatum).lat)
      .ringLng((datum) => (datum as PointDatum).lng)
      .ringColor((datum: object) => () => (datum as PointDatum).color)
      .ringMaxRadius(2.25)
      .ringPropagationSpeed(2.25)
      .ringRepeatPeriod(920);
  }, [globe]);

  useFrame((_, delta) => {
    globe.rotation.y += delta * 0.034;
  });

  return <primitive object={globe} />;
}

/**
 * Photographic night Earth with real city-light imagery and subtle topology,
 * plus the existing CIM telemetry arcs. Kept separate from GitHubGlobe so the
 * stylised original is always available as a safe fallback.
 */
export function RealisticNightGlobe() {
  return (
    <div
      className="relative h-full min-h-[350px] w-full overflow-hidden bg-transparent"
      aria-label="Interactive Earth at night with global threat telemetry"
    >
      <div className="pointer-events-none absolute inset-[12%] rounded-full bg-cim-blue/10 blur-3xl" />
      <Canvas
        camera={{ position: [0, 0, 300], fov: 45, near: 1, far: 1000 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 1.75]}
      >
        <Suspense fallback={null}>
          <SceneFog />
          <Stars radius={155} depth={35} count={650} factor={2.1} saturation={0.35} fade speed={0.25} />
          <ambientLight color="#d9edff" intensity={1.05} />
          <directionalLight color="#8ddcff" position={[-120, 90, 140]} intensity={0.85} />
          <directionalLight color={BRAND_VIOLET_SOFT} position={[130, -80, 100]} intensity={0.55} />
          <pointLight color={BRAND_BLUE} position={[0, 150, -120]} intensity={10} />
          <NightEarthObject />
          <OrbitControls
            enablePan={false}
            enableDamping
            dampingFactor={0.08}
            minDistance={225}
            maxDistance={390}
            autoRotate
            autoRotateSpeed={0.34}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
