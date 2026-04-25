export type RgbColor = {
  r: number;
  g: number;
  b: number;
  brightness: number;
};

export type PanelShape = "triangle" | "square" | "hexagon" | "line" | "unknown";

export type PanelCell = {
  panelId: number;
  x: number;
  y: number;
  orientation: number;
  shapeType: number;
  shape: PanelShape;
};

export type DeviceLayout = {
  numPanels: number;
  sideLength: number;
  panels: PanelCell[];
};

export type DeviceSource = "mdns" | "ssdp" | "manual";

export type NanoleafDevice = {
  id: string;
  name: string;
  host: string;
  port: number;
  model: string;
  firmwareVersion?: string;
  isOn?: boolean;
  paired: boolean;
  reachable: boolean;
  source: DeviceSource;
  discoveryHint?: string;
};

export type AnimationFrame = {
  id: string;
  cells: Record<string, RgbColor>;
  frameDurationMs?: number;
  transitionTimeMs?: number;
};

export type AnimationProject = {
  id: string;
  name: string;
  deviceId: string;
  deviceModel: string;
  layoutHash: string;
  fps: number;
  frameDurationMs: number;
  transitionTimeMs: number;
  viewRotation: number;
  viewMirrorX: boolean;
  viewMirrorY: boolean;
  createdAt: string;
  updatedAt: string;
  frames: AnimationFrame[];
};

export type PlaybackState = {
  active: boolean;
  deviceId?: string;
  projectId?: string;
  frameIndex?: number;
};

export type HealthResponse = {
  ok: true;
  playback: PlaybackState;
};

export type PairDeviceInput = {
  host?: string;
};

export type AddManualDeviceInput = {
  host: string;
  name?: string;
  port?: number;
};

export type PlaybackFrameInput = {
  deviceId: string;
  frame: AnimationFrame;
  transitionTimeMs?: number;
};

export type PlaybackStartInput = {
  deviceId: string;
  project: AnimationProject;
};

export type SetDevicePowerInput = {
  deviceId: string;
  on: boolean;
};

export type UploadProjectInput = {
  deviceId: string;
  project: AnimationProject;
};

export type DeviceEffectSummary = {
  name: string;
  animType: string;
  editable: boolean;
  reason?: string;
  pluginType?: string;
  pluginUuid?: string;
  isActive: boolean;
};

export type DeviceEffectsResponse = {
  effects: DeviceEffectSummary[];
  selectedEffectName?: string;
};

export type DeviceEffectProjectResponse = {
  effect: DeviceEffectSummary;
  project?: AnimationProject;
};

export function createDeviceId(host: string, port = 16021): string {
  return `device:${host.trim()}:${port}`;
}

export function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createColor(color?: Partial<RgbColor>): RgbColor {
  return {
    r: color?.r ?? 0,
    g: color?.g ?? 0,
    b: color?.b ?? 0,
    brightness: color?.brightness ?? 100
  };
}

export function createEmptyFrame(): AnimationFrame {
  return {
    id: createId("frame"),
    cells: {}
  };
}

export function cloneFrame(frame: AnimationFrame): AnimationFrame {
  return {
    id: createId("frame"),
    cells: structuredClone(frame.cells),
    frameDurationMs: frame.frameDurationMs,
    transitionTimeMs: frame.transitionTimeMs
  };
}

export function fillFrameWithPanelIds(frame: AnimationFrame, panelIds: number[]): AnimationFrame {
  const cells: Record<string, RgbColor> = {};

  for (const panelId of panelIds) {
    cells[String(panelId)] = frame.cells[String(panelId)] ?? createColor({ brightness: 0 });
  }

  return {
    ...frame,
    cells
  };
}

export function createProject(params: {
  name: string;
  deviceId: string;
  deviceModel: string;
  layout: DeviceLayout;
  fps?: number;
  frameDurationMs?: number;
}): AnimationProject {
  const now = new Date().toISOString();
  const frameDurationMs = params.frameDurationMs ?? Math.round(1000 / Math.max(params.fps ?? 12, 1));
  return {
    id: createId("project"),
    name: params.name,
    deviceId: params.deviceId,
    deviceModel: params.deviceModel,
    layoutHash: hashLayout(params.layout),
    fps: Math.max(1, Math.round(1000 / Math.max(frameDurationMs, 1))),
    frameDurationMs,
    transitionTimeMs: 100,
    viewRotation: 0,
    viewMirrorX: true,
    viewMirrorY: false,
    createdAt: now,
    updatedAt: now,
    frames: [createEmptyFrame()]
  };
}

export function normalizeProject(project: AnimationProject): AnimationProject {
  const frameDurationMs =
    project.frameDurationMs ?? Math.max(16, Math.round(1000 / Math.max(project.fps ?? 12, 1)));
  const rawViewMirrorX = project.viewMirrorX ?? true;
  const rawViewMirrorY = project.viewMirrorY ?? false;
  const viewRotation = (project.viewRotation ?? 0) + (rawViewMirrorY ? 180 : 0);

  return {
    ...project,
    fps: Math.max(1, Math.round(1000 / Math.max(frameDurationMs, 1))),
    frameDurationMs,
    transitionTimeMs: project.transitionTimeMs ?? 100,
    viewRotation,
    viewMirrorX: rawViewMirrorY ? !rawViewMirrorX : rawViewMirrorX,
    viewMirrorY: false,
    frames: project.frames.map((frame) => ({
      ...frame,
      frameDurationMs:
        frame.frameDurationMs == null ? undefined : Math.max(16, Math.min(60000, Math.round(frame.frameDurationMs))),
      transitionTimeMs:
        frame.transitionTimeMs == null ? undefined : Math.max(0, Math.min(60000, Math.round(frame.transitionTimeMs)))
    }))
  };
}

export function getFrameDurationMs(project: AnimationProject, frame: AnimationFrame): number {
  const durationMs = frame.frameDurationMs ?? project.frameDurationMs;
  return Math.max(16, Math.min(60000, Math.round(durationMs)));
}

export function getFrameTransitionTimeMs(project: AnimationProject, frame: AnimationFrame): number {
  const transitionTimeMs = frame.transitionTimeMs ?? project.transitionTimeMs;
  return Math.max(0, Math.min(getFrameDurationMs(project, frame), Math.round(transitionTimeMs)));
}

export function updateProjectTimestamp(project: AnimationProject): AnimationProject {
  return {
    ...project,
    updatedAt: new Date().toISOString()
  };
}

export function hashLayout(layout: DeviceLayout): string {
  const input = layout.panels
    .map((panel) => `${panel.panelId}:${panel.x}:${panel.y}:${panel.orientation}:${panel.shapeType}`)
    .sort()
    .join("|");

  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }

  return `layout_${(hash >>> 0).toString(16)}`;
}

export function rgbToHex(color: RgbColor): string {
  return [color.r, color.g, color.b]
    .map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export function applyBrightness(color: RgbColor): RgbColor {
  const factor = Math.max(0, Math.min(100, color.brightness)) / 100;
  return {
    r: Math.round(color.r * factor),
    g: Math.round(color.g * factor),
    b: Math.round(color.b * factor),
    brightness: color.brightness
  };
}

export function hexToRgb(hex: string, brightness = 100): RgbColor {
  const normalized = hex.replace("#", "").padStart(6, "0").slice(0, 6);
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
    brightness
  };
}

export function inferPanelShape(shapeType: number): PanelShape {
  if ([0, 1, 2, 3, 14, 15, 16].includes(shapeType)) {
    return "triangle";
  }

  if ([4, 5, 11].includes(shapeType)) {
    return "square";
  }

  if ([7, 8, 21].includes(shapeType)) {
    return "hexagon";
  }

  if ([9, 10, 12, 13, 20].includes(shapeType)) {
    return "line";
  }

  return "unknown";
}
