import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo } from "react";
import ThreeGlobe from "three-globe";
import { Color, Fog, MeshPhongMaterial } from "three";
import world from "../../data/world.json";

// ── colour tokens ─────────────────────────────────────────────────────────────
const GLOBE_BASE      = "#071225"; // deep ocean navy
const CONTINENT_DOT   = "#3f6da8"; // visible slate-blue against the ocean
const BRAND_VIOLET   = "#7c3aed";
const BRAND_CYAN      = "#18d5f2";
const ATMOSPHERE      = "#2584ff";

const ARC_COLORS = [BRAND_CYAN, "#2584ff", BRAND_VIOLET, "#a78bfa"];

// ── arc / node data ────────────────────────────────────────────────────────────
interface ArcDatum {
  order: number; startLat: number; startLng: number;
  endLat: number; endLng: number; arcAlt: number; color: string;
}
interface PointDatum { lat: number; lng: number; color: string; }

const arcs: ArcDatum[] = [
  { order: 1,  startLat: 52.37,  startLng: 4.89,    endLat: 40.71,  endLng: -74.01,  arcAlt: 0.22, color: ARC_COLORS[0] },
  { order: 2,  startLat: 50.11,  startLng: 8.68,    endLat: 1.35,   endLng: 103.82,  arcAlt: 0.30, color: ARC_COLORS[2] },
  { order: 3,  startLat: 59.33,  startLng: 18.06,   endLat: 35.68,  endLng: 139.69,  arcAlt: 0.36, color: ARC_COLORS[1] },
  { order: 4,  startLat: 37.77,  startLng: -122.42, endLat: 51.51,  endLng: -0.13,   arcAlt: 0.25, color: ARC_COLORS[2] },
  { order: 5,  startLat: -33.87, startLng: 151.21,  endLat: 1.35,   endLng: 103.82,  arcAlt: 0.20, color: ARC_COLORS[0] },
  { order: 6,  startLat: 25.20,  startLng: 55.27,   endLat: 48.86,  endLng: 2.35,    arcAlt: 0.18, color: ARC_COLORS[3] },
  { order: 7,  startLat: -23.55, startLng: -46.63,  endLat: 40.71,  endLng: -74.01,  arcAlt: 0.28, color: ARC_COLORS[1] },
  { order: 8,  startLat: 28.61,  startLng: 77.21,   endLat: 52.37,  endLng: 4.89,    arcAlt: 0.34, color: ARC_COLORS[2] },
  { order: 9,  startLat: 43.65,  startLng: -79.38,  endLat: 37.77,  endLng: -122.42, arcAlt: 0.16, color: ARC_COLORS[0] },
  { order: 10, startLat: -1.29,  startLng: 36.82,   endLat: 25.20,  endLng: 55.27,   arcAlt: 0.17, color: ARC_COLORS[3] },
];

const ringPoints: PointDatum[] = Array.from(
  new Map(
    arcs.flatMap((a) => [
      [`${a.startLat},${a.startLng}`, { lat: a.startLat, lng: a.startLng, color: a.color }],
      [`${a.endLat},${a.endLng}`,     { lat: a.endLat,   lng: a.endLng,   color: a.color }],
    ])
  ).values()
);

// ── scene fog ─────────────────────────────────────────────────────────────────
function SceneFog() {
  const { scene } = useThree();
  useEffect(() => {
    scene.fog = new Fog("#020817", 260, 390);
    return () => { scene.fog = null; };
  }, [scene]);
  return null;
}

// ── globe mesh ────────────────────────────────────────────────────────────────
function GlobeObject() {
  const globe = useMemo(() => new ThreeGlobe(), []);

  useEffect(() => {
    // ── base sphere ──────────────────────────────────────────────────────────
    const mat = globe.globeMaterial() as MeshPhongMaterial;
    mat.color            = new Color(GLOBE_BASE);
    mat.emissive         = new Color("#030b1d");
    mat.emissiveIntensity = 0.18;
    mat.shininess        = 12;

    // ── dotted continent layer ───────────────────────────────────────────────
    // hexPolygonsData expects an array of GeoJSON Feature objects.
    // hexPolygonGeoJsonGeometry tells ThreeGlobe which property is the geometry.
    // hexPolygonUseDots(true) renders as a point-cloud rather than filled caps.
    // resolution 3 = H3 level 3 (~100 km hex grid), sufficient for visible land.
    // margin 0.3 = 30 % gap between adjacent dots (higher = bigger visible dots).
    globe
      .showAtmosphere(true)
      .atmosphereColor(ATMOSPHERE)
      .atmosphereAltitude(0.14)
      .hexPolygonsData((world as { features: object[] }).features)
      .hexPolygonGeoJsonGeometry("geometry")
      .hexPolygonResolution(3)
      .hexPolygonMargin(0.3)
      .hexPolygonUseDots(true)
      .hexPolygonAltitude(0.004)
      .hexPolygonColor(() => CONTINENT_DOT)
      .hexPolygonsTransitionDuration(0)

    // ── animated arcs ────────────────────────────────────────────────────────
      .arcsData(arcs)
      .arcStartLat((d) => (d as ArcDatum).startLat)
      .arcStartLng((d) => (d as ArcDatum).startLng)
      .arcEndLat((d)   => (d as ArcDatum).endLat)
      .arcEndLng((d)   => (d as ArcDatum).endLng)
      .arcColor((d: object) => (d as ArcDatum).color)
      .arcAltitude((d) => (d as ArcDatum).arcAlt)
      .arcStroke(0.7)
      .arcDashLength(0.55)
      .arcDashGap(1.1)
      .arcDashInitialGap((d: object) => (d as ArcDatum).order * 0.35)
      .arcDashAnimateTime(1800)

    // ── location dots ────────────────────────────────────────────────────────
      .pointsData(ringPoints)
      .pointLat((d)   => (d as PointDatum).lat)
      .pointLng((d)   => (d as PointDatum).lng)
      .pointColor((d) => (d as PointDatum).color)
      .pointAltitude(0.012)
      .pointRadius(0.1)
      .pointsMerge(true)

    // ── ring pulses ──────────────────────────────────────────────────────────
      .ringsData(ringPoints)
      .ringLat((d)            => (d as PointDatum).lat)
      .ringLng((d)            => (d as PointDatum).lng)
      .ringColor((d: object)  => () => (d as PointDatum).color)
      .ringMaxRadius(2.4)
      .ringPropagationSpeed(2.3)
      .ringRepeatPeriod(900);

  }, [globe]);

  useFrame((_, delta) => { globe.rotation.y += delta * 0.042; });

  return <primitive object={globe} />;
}

// ── exported component ────────────────────────────────────────────────────────
export function GitHubGlobe() {
  return (
    <div className="relative h-full min-h-[350px] w-full bg-transparent"
         aria-label="Interactive global threat telemetry globe">
      <Canvas
        camera={{ position: [0, 0, 300], fov: 45, near: 1, far: 1000 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 1.75]}
      >
        <Suspense fallback={null}>
          <SceneFog />
          <ambientLight   color="#ffffff"  intensity={0.6} />
          <directionalLight color={BRAND_CYAN}   position={[-120, 80, 120]} intensity={0.8} />
          <directionalLight color={BRAND_VIOLET} position={[120, -80, 90]}  intensity={1.3} />
          <pointLight       color={BRAND_VIOLET} position={[0, 160, -120]}  intensity={12} />
          <GlobeObject />
          <OrbitControls
            enablePan={false}
            enableDamping
            dampingFactor={0.08}
            minDistance={230}
            maxDistance={390}
            autoRotate
            autoRotateSpeed={0.42}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
