import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent
} from "react";
import {
  applyBrightness,
  cloneFrame,
  createEmptyFrame,
  createProject,
  getFrameDurationMs,
  getFrameTransitionTimeMs,
  type DeviceEffectSummary,
  hashLayout,
  hexToRgb,
  normalizeProject,
  rgbToHex,
  updateProjectTimestamp,
  type AnimationProject,
  type DeviceLayout,
  type NanoleafDevice,
  type PanelCell,
  type RgbColor
} from "@nanoleaf-jazz/shared";
import {
  addManualDevice,
  getDeviceEffects,
  getDevices,
  getHealth,
  getLayout,
  importDeviceEffect,
  pairDevice,
  previewFrame,
  setDevicePower,
  startPlayback,
  stopPlayback,
  uploadProject
} from "./api";
import appIcon from "./assets/nanoleaf-jazz-icon-256.png";
import { deleteProject, listProjects, loadRecentPaints, saveProject, saveRecentPaints } from "./storage";

type ToolMode = "paint" | "erase" | "sample" | "select";

type LayoutBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type ShapeMetrics = {
  triangleSide: number;
  triangleHeight: number;
  squareSide: number;
  hexRadius: number;
  hexHeight: number;
  lineWidth: number;
  lineLength: number;
  fallbackRadius: number;
  padding: number;
};

type RecentSwatch = {
  color: string;
  brightness: number;
};

const EMPTY_COLOR: RgbColor = { r: 0, g: 0, b: 0, brightness: 100 };
const DEGREE_STEP = 15;
const RECENT_COLORS_KEY = "nanoleaf-jazz:recent-colors";
const DEFAULT_RECENT_SWATCHES: RecentSwatch[] = [
  { color: "#FF6B35", brightness: 100 },
  { color: "#F7B32B", brightness: 100 },
  { color: "#4DD599", brightness: 100 },
  { color: "#3FA7D6", brightness: 100 },
  { color: "#7B61FF", brightness: 100 }
];

function coerceProject(project: AnimationProject): AnimationProject {
  return normalizeProject(project);
}

function rotatePoint(x: number, y: number, angleDegrees: number, centerX: number, centerY: number) {
  const angleRadians = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(angleRadians);
  const sin = Math.sin(angleRadians);
  const dx = x - centerX;
  const dy = y - centerY;

  return {
    x: centerX + dx * cos - dy * sin,
    y: centerY + dx * sin + dy * cos
  };
}

function getShapeMetrics(layout: DeviceLayout): ShapeMetrics {
  const base = Math.max(layout.sideLength || 0, 28);
  const overlap = 0.995;
  const triangleSide = base * overlap;
  const triangleHeight = (Math.sqrt(3) / 2) * triangleSide;
  const squareSide = base * overlap;
  const hexRadius = base * overlap;
  const hexHeight = Math.sqrt(3) * hexRadius;
  const lineWidth = Math.max(base * 0.32, 18);
  const lineLength = Math.max(base * 1.95, 76);
  const fallbackRadius = base * 0.58;
  const padding = Math.max(base * 0.75, 44);

  return {
    triangleSide,
    triangleHeight,
    squareSide,
    hexRadius,
    hexHeight,
    lineWidth,
    lineLength,
    fallbackRadius,
    padding
  };
}

function getPanelHalfExtents(panel: PanelCell, metrics: ShapeMetrics) {
  switch (panel.shape) {
    case "triangle":
      return {
        x: metrics.triangleSide / 2,
        y: (metrics.triangleHeight * 2) / 3
      };
    case "square":
      return {
        x: metrics.squareSide / 2,
        y: metrics.squareSide / 2
      };
    case "hexagon":
      return {
        x: metrics.hexRadius,
        y: metrics.hexHeight / 2
      };
    case "line":
      return {
        x: metrics.lineWidth / 2,
        y: metrics.lineLength / 2
      };
    default:
      return {
        x: metrics.fallbackRadius,
        y: metrics.fallbackRadius
      };
  }
}

function getRotatedBounds(layout: DeviceLayout, rotationDegrees: number, metrics: ShapeMetrics): LayoutBounds | null {
  if (!layout.panels.length) {
    return null;
  }

  const centerX = layout.panels.reduce((sum, panel) => sum + panel.x, 0) / layout.panels.length;
  const centerY = layout.panels.reduce((sum, panel) => sum + panel.y, 0) / layout.panels.length;

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const panel of layout.panels) {
    const rotated = rotatePoint(panel.x, panel.y, rotationDegrees, centerX, centerY);
    const extents = getPanelHalfExtents(panel, metrics);

    minX = Math.min(minX, rotated.x - extents.x);
    maxX = Math.max(maxX, rotated.x + extents.x);
    minY = Math.min(minY, rotated.y - extents.y);
    maxY = Math.max(maxY, rotated.y + extents.y);
  }

  return {
    minX,
    maxX,
    minY,
    maxY
  };
}

function normalizeRecentSwatches(entries: Array<string | RecentSwatch>): RecentSwatch[] {
  return entries
    .map((entry) => {
      if (typeof entry === "string") {
        return {
          color: entry.toUpperCase(),
          brightness: 100
        };
      }

      if (entry && typeof entry.color === "string") {
        return {
          color: entry.color.toUpperCase(),
          brightness: Math.max(0, Math.min(100, entry.brightness ?? 100))
        };
      }

      return null;
    })
    .filter((entry): entry is RecentSwatch => Boolean(entry))
    .slice(0, 10);
}

function readLegacyRecentSwatches(): RecentSwatch[] | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(RECENT_COLORS_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Array<string | RecentSwatch>;
    return normalizeRecentSwatches(parsed);
  } catch {
    return null;
  }
}

function pushRecentSwatch(swatches: RecentSwatch[], nextSwatch: RecentSwatch): RecentSwatch[] {
  const normalized = {
    color: nextSwatch.color.toUpperCase(),
    brightness: Math.max(0, Math.min(100, nextSwatch.brightness))
  };

  return [
    normalized,
    ...swatches.filter(
      (swatch) => !(swatch.color.toUpperCase() === normalized.color && swatch.brightness === normalized.brightness)
    )
  ].slice(0, 10);
}

function swatchEquals(left: RecentSwatch, right: RecentSwatch): boolean {
  return left.color.toUpperCase() === right.color.toUpperCase() && left.brightness === right.brightness;
}

function coerceFrameDurationMs(value: number): number {
  return Math.max(16, Math.min(60000, Math.round(value)));
}

function deriveFps(frameDurationMs: number): number {
  return Math.max(1, Math.round(1000 / Math.max(frameDurationMs, 1)));
}

function coerceTransitionTimeMs(value: number): number {
  return Math.max(0, Math.min(60000, Math.round(value)));
}

export function App() {
  const [devices, setDevices] = useState<NanoleafDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [layout, setLayout] = useState<DeviceLayout | null>(null);
  const [project, setProject] = useState<AnimationProject | null>(null);
  const [savedProjects, setSavedProjects] = useState<AnimationProject[]>([]);
  const [deviceEffects, setDeviceEffects] = useState<DeviceEffectSummary[]>([]);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [selectedColor, setSelectedColor] = useState("#FF6B35");
  const [selectedBrightness, setSelectedBrightness] = useState(100);
  const [recentSwatches, setRecentSwatches] = useState<RecentSwatch[]>(DEFAULT_RECENT_SWATCHES);
  const [areRecentSwatchesLoaded, setAreRecentSwatchesLoaded] = useState(false);
  const [toolMode, setToolMode] = useState<ToolMode>("paint");
  const [selectedPanels, setSelectedPanels] = useState<number[]>([]);
  const [status, setStatus] = useState("Ready");
  const [manualHost, setManualHost] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRefreshingDevices, setIsRefreshingDevices] = useState(false);
  const [isRefreshingDeviceEffects, setIsRefreshingDeviceEffects] = useState(false);
  const [isSubmittingManualHost, setIsSubmittingManualHost] = useState(false);
  const [isImportingEffectName, setIsImportingEffectName] = useState<string | null>(null);
  const [isPairingDeviceId, setIsPairingDeviceId] = useState<string | null>(null);
  const [isTogglingPower, setIsTogglingPower] = useState(false);
  const [isUploadingProject, setIsUploadingProject] = useState(false);
  const [isDevicePanelExpanded, setIsDevicePanelExpanded] = useState(false);
  const [hoveredPanelId, setHoveredPanelId] = useState<number | null>(null);
  const [isPaintPickerOpen, setIsPaintPickerOpen] = useState(false);
  const paintPickerRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const pickerStartRef = useRef<RecentSwatch>({
    color: "#FF6B35",
    brightness: 100
  });

  const selectedDevice = devices.find((device) => device.id === selectedDeviceId) ?? null;
  const hasConnectedDevice = Boolean(selectedDevice?.paired && selectedDevice.reachable);
  const currentFrame = project?.frames[currentFrameIndex] ?? null;
  const frameCells = currentFrame?.cells ?? {};
  const viewRotation = project?.viewRotation ?? 0;
  const viewMirrorX = project?.viewMirrorX ?? true;
  const viewMirrorY = project?.viewMirrorY ?? false;

  useEffect(() => {
    void refreshRecentSwatches();
    void refreshDevices();
    void refreshProjects();
    void refreshHealth();
  }, []);

  useEffect(() => {
    if (areRecentSwatchesLoaded) {
      void saveRecentPaints(recentSwatches);
    }
  }, [areRecentSwatchesLoaded, recentSwatches]);

  useEffect(() => {
    if (!selectedDevice || !selectedDevice.paired) {
      setLayout(null);
      return;
    }

    void loadLayout(selectedDevice.id);
  }, [selectedDevice]);

  useEffect(() => {
    if (!selectedDevice?.paired || !selectedDevice.reachable) {
      setDeviceEffects([]);
      return;
    }

    void refreshDeviceEffects(selectedDevice.id);
  }, [selectedDevice?.id, selectedDevice?.paired, selectedDevice?.reachable]);

  useEffect(() => {
    if (!isPaintPickerOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!paintPickerRef.current?.contains(event.target as Node)) {
        closePaintPicker(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePaintPicker(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPaintPickerOpen, selectedColor, selectedBrightness]);

  const shapeMetrics = useMemo(() => (layout ? getShapeMetrics(layout) : null), [layout]);

  const layoutCenter = useMemo(() => {
    if (!layout?.panels.length) {
      return null;
    }

    const centerX = layout.panels.reduce((sum, panel) => sum + panel.x, 0) / layout.panels.length;
    const centerY = layout.panels.reduce((sum, panel) => sum + panel.y, 0) / layout.panels.length;
    return { x: centerX, y: centerY };
  }, [layout]);

  const orderedPanels = useMemo(() => {
    if (!layout) {
      return [];
    }

    const rank = (panel: PanelCell) => {
      if (panel.panelId === hoveredPanelId) {
        return 2;
      }

      if (selectedPanels.includes(panel.panelId)) {
        return 1;
      }

      return 0;
    };

    return [...layout.panels].sort((left, right) => rank(left) - rank(right));
  }, [hoveredPanelId, layout, selectedPanels]);

  const bounds = useMemo(() => {
    if (!layout || !shapeMetrics) {
      return null;
    }

    return getRotatedBounds(layout, viewRotation, shapeMetrics);
  }, [layout, shapeMetrics, viewRotation]);

  const currentSwatch = useMemo<RecentSwatch>(
    () => ({
      color: selectedColor,
      brightness: selectedBrightness
    }),
    [selectedBrightness, selectedColor]
  );

  function rememberSwatch(swatch: RecentSwatch) {
    setRecentSwatches((current) => pushRecentSwatch(current, swatch));
  }

  function openPaintPicker() {
    pickerStartRef.current = currentSwatch;
    setIsPaintPickerOpen(true);
  }

  function closePaintPicker(commitRecent: boolean) {
    if (!isPaintPickerOpen) {
      return;
    }

    if (commitRecent && !swatchEquals(pickerStartRef.current, currentSwatch)) {
      rememberSwatch(currentSwatch);
    }

    setIsPaintPickerOpen(false);
  }

  function chooseSwatch(swatch: RecentSwatch) {
    setSelectedColor(swatch.color);
    setSelectedBrightness(swatch.brightness);
  }

  function selectDevice(device: NanoleafDevice) {
    setSelectedDeviceId(device.id);
    if (device.paired && device.reachable) {
      setIsDevicePanelExpanded(false);
    }
  }

  async function refreshRecentSwatches() {
    try {
      const persisted = await loadRecentPaints();
      if (persisted) {
        setRecentSwatches(normalizeRecentSwatches(persisted));
        setAreRecentSwatchesLoaded(true);
        return;
      }

      const legacy = readLegacyRecentSwatches();
      const migrated = legacy ?? DEFAULT_RECENT_SWATCHES;
      setRecentSwatches(migrated);
      await saveRecentPaints(migrated);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(RECENT_COLORS_KEY);
      }
    } catch (error) {
      setStatus(`Recent paint storage unavailable: ${(error as Error).message}`);
    } finally {
      setAreRecentSwatchesLoaded(true);
    }
  }

  async function refreshDevices() {
    try {
      setIsRefreshingDevices(true);
      const nextDevices = await getDevices();
      setDevices(nextDevices);

      if (selectedDeviceId && !nextDevices.some((device) => device.id === selectedDeviceId)) {
        setSelectedDeviceId(nextDevices[0]?.id ?? "");
      } else if (!selectedDeviceId && nextDevices[0]) {
        setSelectedDeviceId(nextDevices[0].id);
      }
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setIsRefreshingDevices(false);
    }
  }

  async function refreshProjects() {
    const nextProjects = await listProjects();
    setSavedProjects(nextProjects.map(coerceProject));
  }

  async function refreshDeviceEffects(deviceId: string) {
    try {
      setIsRefreshingDeviceEffects(true);
      const nextEffects = await getDeviceEffects(deviceId);
      setDeviceEffects(nextEffects.effects);
    } catch (error) {
      setDeviceEffects([]);
      setStatus((error as Error).message);
    } finally {
      setIsRefreshingDeviceEffects(false);
    }
  }

  async function refreshHealth() {
    try {
      const health = await getHealth();
      setIsPlaying(health.playback.active);
    } catch {
      // Bridge might not be running yet.
    }
  }

  async function loadLayout(deviceId: string) {
    try {
      const nextLayout = await getLayout(deviceId);
      setLayout(nextLayout);
      setSelectedPanels([]);

      if (!project || project.deviceId !== deviceId || project.layoutHash !== hashLayout(nextLayout)) {
        const device = devices.find((entry) => entry.id === deviceId);
        if (device) {
          setProject(
            createProject({
              name: `${device.name} Sequence`,
              deviceId: device.id,
              deviceModel: device.model,
              layout: nextLayout
            })
          );
          setCurrentFrameIndex(0);
        }
      }
    } catch (error) {
      setLayout(null);
      setStatus((error as Error).message);
    }
  }

  function updateProject(nextProject: AnimationProject) {
    setProject(updateProjectTimestamp(coerceProject(nextProject)));
  }

  function adjustRotation(deltaDegrees: number) {
    if (!project) {
      return;
    }

    updateProject({
      ...project,
      viewRotation: project.viewRotation + deltaDegrees
    });
  }

  function toggleFlip() {
    if (!project) {
      return;
    }

    updateProject({
      ...project,
      viewMirrorX: !project.viewMirrorX,
      viewMirrorY: false
    });
  }

  function setFrameDurationMs(value: number) {
    if (!project || Number.isNaN(value)) {
      return;
    }

    const frameDurationMs = coerceFrameDurationMs(value);
    updateProject({
      ...project,
      frameDurationMs,
      fps: deriveFps(frameDurationMs)
    });
  }

  function setTransitionTimeMs(value: number) {
    if (!project || Number.isNaN(value)) {
      return;
    }

    updateProject({
      ...project,
      transitionTimeMs: coerceTransitionTimeMs(value)
    });
  }

  function setCurrentFrameDurationOverride(rawValue: string) {
    if (!project || !currentFrame) {
      return;
    }

    const nextProject = structuredClone(project);
    const frame = nextProject.frames[currentFrameIndex];
    if (!frame) {
      return;
    }

    if (rawValue.trim() === "") {
      frame.frameDurationMs = undefined;
    } else {
      const parsed = Number.parseInt(rawValue, 10);
      if (Number.isNaN(parsed)) {
        return;
      }

      frame.frameDurationMs = coerceFrameDurationMs(parsed);
    }
    updateProject(nextProject);
  }

  function setCurrentFrameTransitionOverride(rawValue: string) {
    if (!project || !currentFrame) {
      return;
    }

    const nextProject = structuredClone(project);
    const frame = nextProject.frames[currentFrameIndex];
    if (!frame) {
      return;
    }

    if (rawValue.trim() === "") {
      frame.transitionTimeMs = undefined;
    } else {
      const parsed = Number.parseInt(rawValue, 10);
      if (Number.isNaN(parsed)) {
        return;
      }

      frame.transitionTimeMs = coerceTransitionTimeMs(parsed);
    }
    updateProject(nextProject);
  }

  function resetCurrentFrameTiming(field: "frameDurationMs" | "transitionTimeMs") {
    if (!project || !currentFrame) {
      return;
    }

    const nextProject = structuredClone(project);
    const frame = nextProject.frames[currentFrameIndex];
    if (!frame) {
      return;
    }

    delete frame[field];
    updateProject(nextProject);
  }

  function paintPanel(frame: AnimationProject["frames"][number], panelId: number) {
    frame.cells[String(panelId)] = hexToRgb(selectedColor, selectedBrightness);
  }

  function samplePanel(panel: PanelCell) {
    if (!currentFrame) {
      return;
    }

    const color = currentFrame.cells[String(panel.panelId)] ?? { r: 0, g: 0, b: 0, brightness: 0 };
    const sampledSwatch = {
      color: `#${rgbToHex(color)}`,
      brightness: Math.max(0, Math.min(100, color.brightness))
    };
    setSelectedColor(sampledSwatch.color);
    setSelectedBrightness(sampledSwatch.brightness);
    rememberSwatch(sampledSwatch);
    setStatus(`Sampled panel ${panel.panelId}: ${sampledSwatch.color} at ${sampledSwatch.brightness}%`);
  }

  function handlePanelClick(panel: PanelCell, event: ReactMouseEvent<SVGElement>) {
    if (!project || !currentFrame) {
      return;
    }

    if (toolMode === "sample") {
      samplePanel(panel);
      return;
    }

    if (toolMode === "select" || event.shiftKey) {
      setSelectedPanels((current) =>
        current.includes(panel.panelId)
          ? current.filter((panelId) => panelId !== panel.panelId)
          : [...current, panel.panelId]
      );
      return;
    }

    const nextProject = structuredClone(project);
    const frame = nextProject.frames[currentFrameIndex];
    if (!frame) {
      return;
    }

    if (toolMode === "erase") {
      delete frame.cells[String(panel.panelId)];
    } else {
      paintPanel(frame, panel.panelId);
    }

    updateProject(nextProject);
  }

  function appendFrame() {
    if (!project) {
      return;
    }

    updateProject({
      ...project,
      frames: [...project.frames, createEmptyFrame()]
    });
    setCurrentFrameIndex(project.frames.length);
  }

  function duplicateFrame() {
    if (!project || !currentFrame) {
      return;
    }

    const nextFrames = [...project.frames];
    nextFrames.splice(currentFrameIndex + 1, 0, cloneFrame(currentFrame));
    updateProject({
      ...project,
      frames: nextFrames
    });
    setCurrentFrameIndex(currentFrameIndex + 1);
  }

  function deleteFrameAt(index: number) {
    if (!project) {
      return;
    }

    if (project.frames.length === 1) {
      updateProject({
        ...project,
        frames: [createEmptyFrame()]
      });
      setCurrentFrameIndex(0);
      return;
    }

    const nextFrames = project.frames.filter((_, frameIndex) => frameIndex !== index);
    updateProject({
      ...project,
      frames: nextFrames
    });
    setCurrentFrameIndex(Math.max(0, Math.min(index - 1, nextFrames.length - 1)));
  }

  function moveFrame(direction: -1 | 1) {
    if (!project) {
      return;
    }

    const nextIndex = currentFrameIndex + direction;
    if (nextIndex < 0 || nextIndex >= project.frames.length) {
      return;
    }

    const nextFrames = [...project.frames];
    const [frame] = nextFrames.splice(currentFrameIndex, 1);
    nextFrames.splice(nextIndex, 0, frame);
    updateProject({
      ...project,
      frames: nextFrames
    });
    setCurrentFrameIndex(nextIndex);
  }

  function clearFrame() {
    if (!project || !currentFrame) {
      return;
    }

    const nextProject = structuredClone(project);
    nextProject.frames[currentFrameIndex] = {
      ...createEmptyFrame(),
      frameDurationMs: currentFrame.frameDurationMs,
      transitionTimeMs: currentFrame.transitionTimeMs
    };
    updateProject(nextProject);
    setSelectedPanels([]);
  }

  function fillSelection() {
    if (!project || !currentFrame || selectedPanels.length === 0) {
      return;
    }

    const nextProject = structuredClone(project);
    const frame = nextProject.frames[currentFrameIndex];
    for (const panelId of selectedPanels) {
      paintPanel(frame, panelId);
    }
    updateProject(nextProject);
  }

  async function saveCurrentProject() {
    if (!project) {
      return;
    }

    await saveProject(project);
    await refreshProjects();
    setStatus(`Saved ${project.name}`);
  }

  async function removeProject(projectId: string) {
    await deleteProject(projectId);
    await refreshProjects();
  }

  async function uploadCurrentProject() {
    if (!selectedDevice || !project) {
      return;
    }

    try {
      setIsUploadingProject(true);
      const result = await uploadProject(selectedDevice.id, project);
      await refreshDeviceEffects(selectedDevice.id);
      setStatus(`Uploaded "${result.effectName}" to ${selectedDevice.name}`);
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setIsUploadingProject(false);
    }
  }

  async function previewCurrentFrame() {
    if (!selectedDevice || !project || !currentFrame) {
      return;
    }

    try {
      await previewFrame(selectedDevice.id, currentFrame, getFrameTransitionTimeMs(project, currentFrame));
      setStatus(`Previewed frame ${currentFrameIndex + 1}`);
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  async function togglePlayback() {
    if (!selectedDevice || !project) {
      return;
    }

    try {
      if (isPlaying) {
        await stopPlayback(selectedDevice.id);
        setIsPlaying(false);
        setStatus("Playback stopped");
      } else {
        await startPlayback(selectedDevice.id, project);
        setIsPlaying(true);
        setStatus("Playback started");
      }
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  async function handlePair(deviceId: string) {
    try {
      setIsPairingDeviceId(deviceId);
      const pairedDevice = await pairDevice(deviceId);
      setStatus(`Paired ${pairedDevice.name}`);
      await refreshDevices();
      setSelectedDeviceId(deviceId);
      await loadLayout(deviceId);
      await refreshDeviceEffects(deviceId);
      setIsDevicePanelExpanded(false);
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setIsPairingDeviceId(null);
    }
  }

  async function addManualHost() {
    if (!manualHost.trim()) {
      return;
    }

    try {
      setIsSubmittingManualHost(true);
      const device = await addManualDevice({ host: manualHost.trim() });
      setManualHost("");
      await refreshDevices();
      setSelectedDeviceId(device.id);
      setStatus(`Saved ${device.host}. Open pairing mode and click Pair.`);
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setIsSubmittingManualHost(false);
    }
  }

  async function toggleSelectedDevicePower() {
    if (!selectedDevice || !selectedDevice.paired) {
      return;
    }

    try {
      setIsTogglingPower(true);
      const nextOn = !selectedDevice.isOn;
      await setDevicePower(selectedDevice.id, nextOn);
      await refreshDevices();
      setStatus(`${selectedDevice.name} turned ${nextOn ? "on" : "off"}`);
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setIsTogglingPower(false);
    }
  }

  async function loadDeviceEffect(effect: DeviceEffectSummary) {
    if (!selectedDevice) {
      return;
    }

    try {
      setIsImportingEffectName(effect.name);
      const result = await importDeviceEffect(selectedDevice.id, effect.name);

      if (!result.project) {
        setStatus(result.effect.reason ?? `Device effect "${effect.name}" cannot be edited here.`);
        return;
      }

      setProject(coerceProject(result.project));
      setCurrentFrameIndex(0);
      setStatus(`Loaded device effect "${result.effect.name}" into the editor`);
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setIsImportingEffectName(null);
    }
  }

  function exportProject() {
    if (!project) {
      return;
    }

    const blob = new Blob([JSON.stringify(project, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name.replace(/\s+/g, "-").toLowerCase()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importProject(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const imported = coerceProject(JSON.parse(text) as AnimationProject);
      if (layout && imported.layoutHash !== hashLayout(layout)) {
        setStatus("Imported project layout does not match the active device.");
      }
      setProject(imported);
      setCurrentFrameIndex(0);
    } catch (error) {
      setStatus(`Import failed: ${(error as Error).message}`);
    } finally {
      event.target.value = "";
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="panel brand-panel">
          <img className="brand-watermark" src={appIcon} alt="" aria-hidden="true" />
          <div className="brand-heading">
            <img className="brand-mark" src={appIcon} alt="" aria-hidden="true" />
            <p className="eyebrow">Nanoleaf Jazz</p>
          </div>
          <h1>Frame-by-frame light choreography for Nanoleaf panels.</h1>
        </div>

        <div className={`panel device-panel ${hasConnectedDevice && !isDevicePanelExpanded ? "compact" : ""}`}>
          <div className="section-heading">
            <h2>Devices</h2>
            <div className="heading-actions">
              {hasConnectedDevice && (
                <button type="button" onClick={() => setIsDevicePanelExpanded((current) => !current)}>
                  {isDevicePanelExpanded ? "Fold" : "Change"}
                </button>
              )}
              <button onClick={() => void refreshDevices()} disabled={isRefreshingDevices}>
                {isRefreshingDevices ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          {hasConnectedDevice && selectedDevice && (
            <div className="connected-device-summary">
              <div>
                <strong>{selectedDevice.name}</strong>
                <span className="device-meta">
                  {selectedDevice.host}:{selectedDevice.port} | {selectedDevice.model || "paired"}
                </span>
              </div>
              <div className="connected-device-actions">
                <button
                  type="button"
                  className={`icon-button power-button ${selectedDevice.isOn === false ? "off" : "on"}`}
                  onClick={() => void toggleSelectedDevicePower()}
                  disabled={isTogglingPower}
                  aria-label={selectedDevice.isOn === false ? "Turn device on" : "Turn device off"}
                  title={selectedDevice.isOn === false ? "Turn on" : "Turn off"}
                >
                  <PowerIcon />
                </button>
              </div>
            </div>
          )}
          {(!hasConnectedDevice || isDevicePanelExpanded) && (
            <>
              <p className="muted device-help">
                Auto-discovery uses mDNS and SSDP. If nothing appears, enter the controller IP manually.
              </p>
              <div className="manual-add">
                <input
                  value={manualHost}
                  onChange={(event) => setManualHost(event.target.value)}
                  placeholder="Device IP or hostname"
                />
                <button onClick={() => void addManualHost()} disabled={isSubmittingManualHost}>
                  {isSubmittingManualHost ? "Checking..." : "Add"}
                </button>
              </div>
              <div className="device-list">
                {devices.length === 0 && (
                  <div className="empty-state">
                    <span>No Nanoleaf devices found yet.</span>
                    <span className="muted">Use Refresh or add the controller IP manually.</span>
                  </div>
                )}
                {devices.map((device) => (
                  <div
                    key={device.id}
                    className={`device-card ${device.id === selectedDeviceId ? "selected" : ""}`}
                    onClick={() => selectDevice(device)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectDevice(device);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="device-header">
                      <span>{device.name}</span>
                      <span className={`device-pill ${device.reachable ? "ok" : "warn"}`}>
                        {device.reachable ? "reachable" : "offline"}
                      </span>
                    </div>
                    <span className="device-meta">
                      {device.host}:{device.port} | {device.source} | {device.paired ? device.model || "paired" : "not paired"}
                    </span>
                    <div className="device-actions">
                      {!device.paired ? (
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            void handlePair(device.id);
                          }}
                          disabled={!device.reachable || isPairingDeviceId === device.id}
                        >
                          {isPairingDeviceId === device.id ? "Pairing..." : "Pair"}
                        </button>
                      ) : (
                        <span className="muted">Ready for layout load and playback.</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="panel">
          <div className="section-heading">
            <h2>Project</h2>
            <button onClick={() => void saveCurrentProject()} disabled={!project}>
              Save
            </button>
          </div>
          {project ? (
            <>
              <label>
                Name
                <input
                  value={project.name}
                  onChange={(event) => updateProject({ ...project, name: event.target.value })}
                />
              </label>
              <label>
                Milliseconds Per Frame
                <div className="timing-grid">
                  <div className="timing-field">
                    <span className="muted compact-note">Default</span>
                    <input
                      type="number"
                      min={16}
                      max={60000}
                      step={1}
                      value={project.frameDurationMs}
                      onChange={(event) => setFrameDurationMs(Number.parseInt(event.target.value || "83", 10))}
                    />
                  </div>
                  <div className="timing-field">
                    <span className="muted compact-note">Current Frame</span>
                    <div className="timing-inline">
                      <input
                        type="number"
                        min={16}
                        max={60000}
                        step={1}
                        value={currentFrame?.frameDurationMs ?? ""}
                        placeholder={String(project.frameDurationMs)}
                        onChange={(event) => setCurrentFrameDurationOverride(event.target.value)}
                        disabled={!currentFrame}
                      />
                      <button
                        type="button"
                        className="icon-button timing-reset-button"
                        onClick={() => resetCurrentFrameTiming("frameDurationMs")}
                        disabled={!currentFrame || currentFrame.frameDurationMs == null}
                        aria-label="Reset current frame duration to default"
                        title="Reset to default"
                      >
                        <ResetIcon />
                      </button>
                    </div>
                  </div>
                </div>
                <span className="muted compact-note">Approx. {deriveFps(project.frameDurationMs)} fps</span>
              </label>
              <label>
                Transition Time
                <div className="timing-grid">
                  <div className="timing-field">
                    <span className="muted compact-note">Default</span>
                    <input
                      type="number"
                      min={0}
                      max={60000}
                      step={1}
                      value={project.transitionTimeMs}
                      onChange={(event) => setTransitionTimeMs(Number.parseInt(event.target.value || "0", 10))}
                    />
                  </div>
                  <div className="timing-field">
                    <span className="muted compact-note">Current Frame</span>
                    <div className="timing-inline">
                      <input
                        type="number"
                        min={0}
                        max={60000}
                        step={1}
                        value={currentFrame?.transitionTimeMs ?? ""}
                        placeholder={String(project.transitionTimeMs)}
                        onChange={(event) => setCurrentFrameTransitionOverride(event.target.value)}
                        disabled={!currentFrame}
                      />
                      <button
                        type="button"
                        className="icon-button timing-reset-button"
                        onClick={() => resetCurrentFrameTiming("transitionTimeMs")}
                        disabled={!currentFrame || currentFrame.transitionTimeMs == null}
                        aria-label="Reset current frame transition to default"
                        title="Reset to default"
                      >
                        <ResetIcon />
                      </button>
                    </div>
                  </div>
                </div>
                <span className="muted compact-note">
                  0 ms is abrupt; values near frame duration continuously fade.
                </span>
              </label>
              <label>
                Recent Paint
                <div className="recent-colors">
                  {recentSwatches.map((swatch) => {
                    const previewColor = applyBrightness(hexToRgb(swatch.color, swatch.brightness));
                    return (
                      <button
                        key={`${swatch.color}-${swatch.brightness}`}
                        type="button"
                        className={`color-chip ${swatchEquals(swatch, currentSwatch) ? "active" : ""}`}
                        style={{ backgroundColor: `#${rgbToHex(previewColor)}` }}
                        onClick={() => chooseSwatch(swatch)}
                        title={`${swatch.color} at ${swatch.brightness}%`}
                      >
                        <span>{swatch.brightness}%</span>
                      </button>
                    );
                  })}
                </div>
              </label>
              <label>
                Orientation
                <div className="orientation-controls">
                  <button
                    onClick={() => adjustRotation(-DEGREE_STEP)}
                    type="button"
                    className="icon-button"
                    aria-label="Rotate left 15 degrees"
                    title="Rotate left 15 degrees"
                  >
                    <RotateLeftIcon />
                  </button>
                  <button
                    onClick={toggleFlip}
                    type="button"
                    className={`icon-button ${project.viewMirrorX ? "active" : ""}`}
                    aria-label="Flip layout"
                    title="Flip layout"
                  >
                    <FlipIcon />
                  </button>
                  <button
                    onClick={() => adjustRotation(DEGREE_STEP)}
                    type="button"
                    className="icon-button"
                    aria-label="Rotate right 15 degrees"
                    title="Rotate right 15 degrees"
                  >
                    <RotateRightIcon />
                  </button>
                </div>
              </label>
              <div className="project-io-section">
                <span className="form-section-label">Actions</span>
                <div className="project-actions orientation-controls">
                  <button
                    onClick={() => void uploadCurrentProject()}
                    disabled={!selectedDevice || !selectedDevice.paired || isUploadingProject}
                  >
                    {isUploadingProject ? "Uploading" : "Upload"}
                  </button>
                  <button onClick={exportProject}>Export</button>
                  <button type="button" onClick={() => importInputRef.current?.click()}>
                    Import
                  </button>
                  <input
                    ref={importInputRef}
                    className="project-import-input"
                    type="file"
                    accept="application/json"
                    onChange={(event) => void importProject(event)}
                  />
                </div>
              </div>
            </>
          ) : (
            <p className="muted">Pair a device to load its panel layout.</p>
          )}
        </div>

        <div className="panel library-panel">
          <div className="section-heading">
            <h2>Library</h2>
            <button
              type="button"
              onClick={() => selectedDevice && void refreshDeviceEffects(selectedDevice.id)}
              disabled={!selectedDevice?.paired || isRefreshingDeviceEffects}
            >
              {isRefreshingDeviceEffects ? "Refreshing" : "Refresh"}
            </button>
          </div>
          <div className="library-group">
            <span className="form-section-label">Local Projects</span>
            <div className="project-list">
              {savedProjects.length > 0 ? (
                savedProjects.map((item) => (
                  <div key={item.id} className="saved-project">
                    <label
                      className="saved-project-title"
                      onClick={() => {
                        setProject(coerceProject(item));
                        setCurrentFrameIndex(0);
                      }}
                    >
                      {item.name}
                    </label>
                    <button
                      className="danger icon-button trash-button"
                      onClick={() => void removeProject(item.id)}
                      aria-label={`Delete ${item.name}`}
                      title={`Delete ${item.name}`}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  <strong>No saved projects yet</strong>
                  <span className="muted">Save a project to keep it in the local library.</span>
                </div>
              )}
            </div>
          </div>
          <div className="library-group">
            <span className="form-section-label">Device Effects</span>
            {!selectedDevice?.paired ? (
              <p className="muted">Pair a device to browse its saved effects.</p>
            ) : deviceEffects.length > 0 ? (
              <div className="project-list">
                {deviceEffects.map((effect) => (
                  <div
                    key={effect.name}
                    className={`library-entry ${effect.isActive ? "active" : ""} ${effect.editable ? "" : "unsupported"}`}
                  >
                    <div className="library-entry-copy">
                      <button
                        type="button"
                        className="saved-project-title library-entry-title"
                        onClick={() => void loadDeviceEffect(effect)}
                        disabled={!effect.editable || isImportingEffectName === effect.name}
                        title={
                          effect.editable
                            ? `Load ${effect.name} into the editor`
                            : effect.reason ?? `${effect.name} cannot be edited here`
                        }
                      >
                        {effect.name}
                      </button>
                      <div className="library-entry-meta">
                        <span className="device-pill ok">{effect.animType}</span>
                        {effect.pluginType ? <span className="muted compact-note">{effect.pluginType}</span> : null}
                        {effect.isActive ? <span className="device-pill active-effect">Active</span> : null}
                      </div>
                      {effect.reason ? <span className="muted library-entry-note">{effect.reason}</span> : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadDeviceEffect(effect)}
                      disabled={!effect.editable || isImportingEffectName === effect.name}
                    >
                      {isImportingEffectName === effect.name ? "Loading" : effect.editable ? "Load" : "View"}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <strong>No device effects found</strong>
                <span className="muted">Saved effects on the Nanoleaf controller will appear here.</span>
              </div>
            )}
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="toolbar panel">
          <div className="toolbar-group">
            <button className={toolMode === "paint" ? "active" : ""} onClick={() => setToolMode("paint")}>
              Paint
            </button>
            <button className={toolMode === "erase" ? "active" : ""} onClick={() => setToolMode("erase")}>
              Erase
            </button>
            <button className={toolMode === "sample" ? "active" : ""} onClick={() => setToolMode("sample")}>
              Pick
            </button>
            <button className={toolMode === "select" ? "active" : ""} onClick={() => setToolMode("select")}>
              Select
            </button>
            <button onClick={fillSelection} disabled={selectedPanels.length === 0}>
              Fill Selection
            </button>
            <button onClick={clearFrame} disabled={!project}>
              Clear Frame
            </button>
          </div>
          <div className="toolbar-group toolbar-color-group">
            <div className="paint-picker" ref={paintPickerRef}>
              <button
                type="button"
                className={`paint-picker-trigger ${isPaintPickerOpen ? "active" : ""}`}
                onClick={() => {
                  if (isPaintPickerOpen) {
                    closePaintPicker(false);
                  } else {
                    openPaintPicker();
                  }
                }}
              >
                <span
                  className="paint-picker-swatch"
                  style={{
                    backgroundColor: `#${rgbToHex(applyBrightness(hexToRgb(selectedColor, selectedBrightness)))}`
                  }}
                />
                <span>Tile Paint</span>
                <span className="muted compact-note">{selectedBrightness}%</span>
              </button>
              {isPaintPickerOpen && (
                <div className="paint-picker-popover">
                  <div className="paint-picker-color-row">
                    <span
                      className="paint-picker-preview"
                      style={{
                        backgroundColor: `#${rgbToHex(applyBrightness(hexToRgb(selectedColor, selectedBrightness)))}`
                      }}
                    />
                    <label className="paint-picker-field">
                      <span>Color</span>
                      <input
                        type="color"
                        value={selectedColor}
                        onChange={(event) => setSelectedColor(event.target.value.toUpperCase())}
                      />
                    </label>
                  </div>
                  <label>
                    Brightness
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={selectedBrightness}
                      onChange={(event) => setSelectedBrightness(Number.parseInt(event.target.value, 10))}
                    />
                    <span className="muted compact-note">{selectedBrightness}%</span>
                  </label>
                  <div className="paint-picker-actions">
                    <button type="button" onClick={() => closePaintPicker(true)}>
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="toolbar-group">
            <button onClick={() => void previewCurrentFrame()} disabled={!selectedDevice || !currentFrame}>
              Preview Frame
            </button>
            <button onClick={() => void togglePlayback()} disabled={!selectedDevice || !project}>
              {isPlaying ? "Stop Loop" : "Play Loop"}
            </button>
          </div>
        </header>

        <section className="canvas-panel panel">
          {layout && bounds && shapeMetrics && layoutCenter ? (
            <svg
              className="layout-canvas"
              viewBox={`${bounds.minX - shapeMetrics.padding} ${bounds.minY - shapeMetrics.padding} ${bounds.maxX - bounds.minX + shapeMetrics.padding * 2} ${bounds.maxY - bounds.minY + shapeMetrics.padding * 2}`}
            >
              <g transform={`translate(${layoutCenter.x} ${layoutCenter.y})`}>
                <g transform={`scale(${viewMirrorX ? -1 : 1} ${viewMirrorY ? -1 : 1})`}>
                  <g transform={`rotate(${viewRotation})`}>
                    <g transform={`translate(${-layoutCenter.x} ${-layoutCenter.y})`}>
                      {orderedPanels.map((panel) => {
                        const isSelected = selectedPanels.includes(panel.panelId);
                        const isHovered = hoveredPanelId === panel.panelId;
                        const color = applyBrightness(frameCells[String(panel.panelId)] ?? EMPTY_COLOR);
                        return (
                          <g
                            key={panel.panelId}
                            transform={`translate(${panel.x}, ${panel.y}) rotate(${panel.orientation})`}
                          >
                            <Shape
                              panel={panel}
                              metrics={shapeMetrics}
                              fill={`#${rgbToHex(color)}`}
                              selected={isSelected || isHovered}
                              onClick={(event) => handlePanelClick(panel, event)}
                              onMouseEnter={() => setHoveredPanelId(panel.panelId)}
                              onMouseLeave={() => setHoveredPanelId((current) => (current === panel.panelId ? null : current))}
                            />
                            <text className="panel-label" textAnchor="middle" y={4}>
                              {panel.panelId}
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  </g>
                </g>
              </g>
            </svg>
          ) : (
            <div className="canvas-empty">
              <p>
                {selectedDevice && !selectedDevice.paired
                  ? "Pair the selected Nanoleaf to load its panel layout."
                  : "Pair and select a Nanoleaf device to load its layout."}
              </p>
            </div>
          )}
        </section>

        <section className="timeline panel">
          <div className="section-heading">
            <h2>Timeline</h2>
            <div className="toolbar-group">
              <button onClick={appendFrame} disabled={!project}>
                Add Frame
              </button>
              <button onClick={duplicateFrame} disabled={!project}>
                Duplicate
              </button>
              <button onClick={() => moveFrame(-1)} disabled={!project}>
                Move Left
              </button>
              <button onClick={() => moveFrame(1)} disabled={!project}>
                Move Right
              </button>
            </div>
          </div>
          <div className="timeline-strip">
            {project?.frames.map((frame, index) => (
              <button
                key={frame.id}
                className={`timeline-frame ${index === currentFrameIndex ? "selected" : ""}`}
                onClick={() => setCurrentFrameIndex(index)}
              >
                <LazyTimelineFramePreview
                  bounds={bounds}
                  frame={frame}
                  layout={layout}
                  layoutCenter={layoutCenter}
                  metrics={shapeMetrics}
                  viewMirrorX={viewMirrorX}
                  viewMirrorY={viewMirrorY}
                  viewRotation={viewRotation}
                />
                <span className="timeline-frame-meta">
                  <span>F{index + 1}</span>
                  <span>
                    {Object.keys(frame.cells).length} lit · {project ? getFrameDurationMs(project, frame) : 0} ms
                  </span>
                </span>
                <span
                  className="timeline-delete"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteFrameAt(index);
                  }}
                >
                  x
                </span>
              </button>
            ))}
          </div>
        </section>

        <footer className="status-bar">
          <span>{status}</span>
          <span>{selectedPanels.length} selected</span>
        </footer>
      </main>
    </div>
  );
}

function LazyTimelineFramePreview(props: {
  bounds: LayoutBounds | null;
  frame: AnimationProject["frames"][number];
  layout: DeviceLayout | null;
  layoutCenter: { x: number; y: number } | null;
  metrics: ShapeMetrics | null;
  viewMirrorX: boolean;
  viewMirrorY: boolean;
  viewRotation: number;
}) {
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    if (shouldRender) {
      return;
    }

    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setShouldRender(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldRender(true);
          observer.disconnect();
        }
      },
      {
        root: null,
        rootMargin: "120px"
      }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [shouldRender]);

  if (!props.layout || !props.bounds || !props.metrics || !props.layoutCenter) {
    return <span ref={containerRef} className="timeline-preview placeholder" />;
  }

  const bounds = props.bounds;
  const layout = props.layout;
  const layoutCenter = props.layoutCenter;
  const metrics = props.metrics;

  return (
    <span ref={containerRef} className="timeline-preview">
      {shouldRender && (
        <svg
          className="timeline-preview-svg"
          viewBox={`${bounds.minX - metrics.padding} ${bounds.minY - metrics.padding} ${bounds.maxX - bounds.minX + metrics.padding * 2} ${bounds.maxY - bounds.minY + metrics.padding * 2}`}
        >
          <g transform={`translate(${layoutCenter.x} ${layoutCenter.y})`}>
            <g transform={`scale(${props.viewMirrorX ? -1 : 1} ${props.viewMirrorY ? -1 : 1})`}>
              <g transform={`rotate(${props.viewRotation})`}>
                <g transform={`translate(${-layoutCenter.x} ${-layoutCenter.y})`}>
                  {layout.panels.map((panel) => {
                    const color = applyBrightness(props.frame.cells[String(panel.panelId)] ?? EMPTY_COLOR);
                    return (
                      <g key={panel.panelId} transform={`translate(${panel.x}, ${panel.y}) rotate(${panel.orientation})`}>
                        <MiniShape panel={panel} metrics={metrics} fill={`#${rgbToHex(color)}`} />
                      </g>
                    );
                  })}
                </g>
              </g>
            </g>
          </g>
        </svg>
      )}
    </span>
  );
}

function RotateLeftIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.8 7.2A7 7 0 1 1 5 12.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M7.7 3.8v4H3.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RotateRightIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16.2 7.2A7 7 0 1 0 19 12.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M16.3 3.8v4h3.9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FlipIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeDasharray="2 3" />
      <path d="M4 7l5 4V3L4 7Z" fill="currentColor" />
      <path d="M20 7l-5 4V3l5 4Z" fill="currentColor" />
      <path d="M4 17l5 4v-8l-5 4Z" fill="currentColor" opacity="0.55" />
      <path d="M20 17l-5 4v-8l5 4Z" fill="currentColor" opacity="0.55" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8 8.5h8m-6.5 0V18m5-9.5V18M9 5.5h6l.7 1.5H20M4 7h16m-2 0-.8 13H6.8L6 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 8V4m0 0h4M6 4l4 4m2-3a7 7 0 1 1-6 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PowerIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M8 5.8a7 7 0 1 0 8 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MiniShape(props: {
  panel: PanelCell;
  metrics: ShapeMetrics;
  fill: string;
}) {
  const commonProps = {
    className: "timeline-preview-shape",
    fill: props.fill
  };

  switch (props.panel.shape) {
    case "triangle": {
      const { triangleSide, triangleHeight } = props.metrics;
      const topY = (-2 * triangleHeight) / 3;
      const bottomY = triangleHeight / 3;
      return (
        <polygon
          {...commonProps}
          points={`${-triangleSide / 2},${bottomY} 0,${topY} ${triangleSide / 2},${bottomY}`}
        />
      );
    }
    case "square": {
      const { squareSide } = props.metrics;
      return <rect {...commonProps} x={-squareSide / 2} y={-squareSide / 2} width={squareSide} height={squareSide} rx={8} />;
    }
    case "line": {
      const { lineWidth, lineLength } = props.metrics;
      return <rect {...commonProps} x={-lineWidth / 2} y={-lineLength / 2} width={lineWidth} height={lineLength} rx={lineWidth / 2} />;
    }
    case "hexagon": {
      const { hexRadius, hexHeight } = props.metrics;
      return (
        <polygon
          {...commonProps}
          points={`${-hexRadius},0 ${-hexRadius / 2},${-hexHeight / 2} ${hexRadius / 2},${-hexHeight / 2} ${hexRadius},0 ${hexRadius / 2},${hexHeight / 2} ${-hexRadius / 2},${hexHeight / 2}`}
        />
      );
    }
    default:
      return <circle {...commonProps} r={props.metrics.fallbackRadius} />;
  }
}

function Shape(props: {
  panel: PanelCell;
  metrics: ShapeMetrics;
  fill: string;
  selected: boolean;
  onClick: (event: ReactMouseEvent<SVGElement>) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const commonProps = {
    onClick: props.onClick,
    onMouseEnter: props.onMouseEnter,
    onMouseLeave: props.onMouseLeave,
    className: props.selected ? "panel-shape selected" : "panel-shape",
    fill: props.fill
  };

  switch (props.panel.shape) {
    case "triangle": {
      const { triangleSide, triangleHeight } = props.metrics;
      const topY = (-2 * triangleHeight) / 3;
      const bottomY = triangleHeight / 3;
      return (
        <polygon
          {...commonProps}
          points={`${-triangleSide / 2},${bottomY} 0,${topY} ${triangleSide / 2},${bottomY}`}
        />
      );
    }
    case "square": {
      const { squareSide } = props.metrics;
      return <rect {...commonProps} x={-squareSide / 2} y={-squareSide / 2} width={squareSide} height={squareSide} rx={8} />;
    }
    case "line": {
      const { lineWidth, lineLength } = props.metrics;
      return <rect {...commonProps} x={-lineWidth / 2} y={-lineLength / 2} width={lineWidth} height={lineLength} rx={lineWidth / 2} />;
    }
    case "hexagon": {
      const { hexRadius, hexHeight } = props.metrics;
      return (
        <polygon
          {...commonProps}
          points={`${-hexRadius},0 ${-hexRadius / 2},${-hexHeight / 2} ${hexRadius / 2},${-hexHeight / 2} ${hexRadius},0 ${hexRadius / 2},${hexHeight / 2} ${-hexRadius / 2},${hexHeight / 2}`}
        />
      );
    }
    default:
      return <circle {...commonProps} r={props.metrics.fallbackRadius} />;
  }
}
