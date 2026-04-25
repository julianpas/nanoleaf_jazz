import net from "node:net";
import {
  applyBrightness,
  createColor,
  createProject,
  getFrameDurationMs,
  getFrameTransitionTimeMs,
  inferPanelShape,
  type AnimationFrame,
  type AnimationProject,
  type DeviceEffectSummary,
  type DeviceLayout,
  type NanoleafDevice
} from "@nanoleaf-jazz/shared";

type DeviceInfoResponse = {
  name: string;
  model: string;
  firmwareVersion?: string;
  state?: {
    on?: {
      value?: boolean;
    };
  };
};

type RawLayoutResponse = {
  numPanels: number;
  sideLength: number;
  positionData: Array<{
    panelId: number;
    x: number;
    y: number;
    o: number;
    shapeType: number;
  }>;
};

type TokenResponse = {
  auth_token: string;
};

type EffectSelectResponse = string;

type EffectWritePayload = {
  command: string;
  animName?: string;
  version?: string;
  animType?: string;
  animData?: string;
  loop?: boolean;
  palette?: unknown[];
};

type NanoleafEffect = {
  animName: string;
  animType: string;
  animData?: string | null;
  loop?: boolean;
  version?: string;
  palette?: unknown[];
  pluginType?: string;
  pluginUuid?: string;
  pluginOptions?: Array<{
    name: string;
    value: unknown;
  }>;
  colorType?: string;
};

type EffectListResponse = {
  animations?: NanoleafEffect[];
};

type ParsedAnimStep = {
  cells: Record<string, ReturnType<typeof createColor>>;
  durationMs: number;
};

type ParsedCustomAnimData =
  | {
      ok: true;
      steps: ParsedAnimStep[];
    }
  | {
      ok: false;
      reason: string;
    };

function buildBaseUrl(device: Pick<NanoleafDevice, "host" | "port">, token?: string): string {
  const root = `http://${device.host}:${device.port}`;
  if (!token) {
    return `${root}/api/v1`;
  }

  return `${root}/api/v1/${token}`;
}

function withTimeout(timeoutMs = 3000): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Nanoleaf request failed with ${response.status} ${response.statusText}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function parseBody<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Nanoleaf request failed with ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  if (!text.trim()) {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}

function toTransitionTimeUnits(durationMs: number): number {
  return Math.max(0, Math.round(durationMs / 100));
}

function putEffectCommand(
  device: Pick<NanoleafDevice, "host" | "port">,
  token: string,
  payload: EffectWritePayload
) {
  return fetch(`${buildBaseUrl(device, token)}/effects`, {
    method: "PUT",
    signal: withTimeout(3000),
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      write: payload
    })
  });
}

function summarizeEffect(
  effect: NanoleafEffect,
  selectedEffectName?: string,
  parsedCustomEffect?: ParsedCustomAnimData
): DeviceEffectSummary {
  const customParse = effect.animType === "custom" ? parsedCustomEffect ?? parseCustomAnimData(effect.animData) : undefined;

  if (effect.animType === "custom") {
    return {
      name: effect.animName,
      animType: effect.animType,
      editable: customParse?.ok ?? false,
      reason: customParse?.ok ? undefined : customParse?.reason ?? "Custom effect data is missing.",
      isActive: selectedEffectName === effect.animName
    };
  }

  if (effect.animType === "plugin") {
    return {
      name: effect.animName,
      animType: effect.animType,
      editable: false,
      reason: "Plugin effects use Nanoleaf motions, which the frame editor cannot round-trip.",
      pluginType: effect.pluginType,
      pluginUuid: effect.pluginUuid,
      isActive: selectedEffectName === effect.animName
    };
  }

  return {
    name: effect.animName,
    animType: effect.animType,
    editable: false,
    reason: `Unsupported effect type: ${effect.animType}`,
    pluginType: effect.pluginType,
    pluginUuid: effect.pluginUuid,
    isActive: selectedEffectName === effect.animName
  };
}

function colorsEqual(
  left: Record<string, ReturnType<typeof createColor>>,
  right: Record<string, ReturnType<typeof createColor>>
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    const leftColor = left[key];
    const rightColor = right[key];
    if (!rightColor) {
      return false;
    }

    if (
      leftColor.r !== rightColor.r ||
      leftColor.g !== rightColor.g ||
      leftColor.b !== rightColor.b ||
      leftColor.brightness !== rightColor.brightness
    ) {
      return false;
    }
  }

  return true;
}

function parseCustomAnimData(animData?: string | null): ParsedCustomAnimData {
  if (!animData?.trim()) {
    return {
      ok: false,
      reason: "Custom effect data is missing."
    };
  }

  const tokens = animData.trim().split(/\s+/);
  let cursor = 0;
  const readNumber = () => {
    const value = Number.parseInt(tokens[cursor] ?? "", 10);
    cursor += 1;
    return value;
  };

  const numPanels = readNumber();
  if (!Number.isFinite(numPanels) || numPanels <= 0) {
    return {
      ok: false,
      reason: "Custom effect header is invalid."
    };
  }

  const perPanel: Array<{
    panelId: number;
    frames: Array<{
      color: ReturnType<typeof createColor>;
      durationMs: number;
    }>;
  }> = [];

  for (let panelIndex = 0; panelIndex < numPanels; panelIndex += 1) {
    const panelId = readNumber();
    const numFrames = readNumber();
    if (!Number.isFinite(panelId) || !Number.isFinite(numFrames) || numFrames < 0) {
      return {
        ok: false,
        reason: "Custom effect panel data is invalid."
      };
    }

    const frames: Array<{
      color: ReturnType<typeof createColor>;
      durationMs: number;
    }> = [];

    for (let frameIndex = 0; frameIndex < numFrames; frameIndex += 1) {
      const r = readNumber();
      const g = readNumber();
      const b = readNumber();
      const _w = readNumber();
      const transitionUnits = readNumber();
      if ([r, g, b, transitionUnits].some((value) => !Number.isFinite(value))) {
        return {
          ok: false,
          reason: "Custom effect color frame data is invalid."
        };
      }

      frames.push({
        color: createColor({
          r: Math.max(0, Math.min(255, r)),
          g: Math.max(0, Math.min(255, g)),
          b: Math.max(0, Math.min(255, b)),
          brightness: 100
        }),
        durationMs: Math.max(0, transitionUnits) * 100
      });
    }

    perPanel.push({
      panelId,
      frames
    });
  }

  if (cursor !== tokens.length) {
    return {
      ok: false,
      reason: "Custom effect data has unexpected trailing tokens."
    };
  }

  const stepCount = perPanel[0]?.frames.length ?? 0;
  if (stepCount === 0) {
    return {
      ok: false,
      reason: "Custom effect contains no frames."
    };
  }

  if (!perPanel.every((panel) => panel.frames.length === stepCount)) {
    return {
      ok: false,
      reason: "Panels use different frame counts, which the current editor cannot represent."
    };
  }

  const steps: ParsedAnimStep[] = [];
  for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
    const durationMs = perPanel[0]?.frames[stepIndex]?.durationMs ?? 0;
    if (!perPanel.every((panel) => panel.frames[stepIndex]?.durationMs === durationMs)) {
      return {
        ok: false,
        reason: "Panels use different transition timings, which the current editor cannot represent."
      };
    }

    const cells: ParsedAnimStep["cells"] = {};
    for (const panel of perPanel) {
      const frame = panel.frames[stepIndex];
      if (!frame) {
        return {
          ok: false,
          reason: "Custom effect frame data is incomplete."
        };
      }

      cells[String(panel.panelId)] = frame.color;
    }

    steps.push({
      cells,
      durationMs
    });
  }

  return {
    ok: true,
    steps
  };
}

function toProjectFromEffect(
  device: Pick<NanoleafDevice, "id" | "model" | "name">,
  layout: DeviceLayout,
  effect: NanoleafEffect
): AnimationProject {
  const parsed = parseCustomAnimData(effect.animData);
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }

  let steps = parsed.steps;
  let importedTransitions = steps.map((step) => step.durationMs);
  let importedDurations = steps.map((step) => Math.max(step.durationMs, 100));

  const pairwiseRepeat =
    steps.length >= 2 &&
    steps.length % 2 === 0 &&
    steps.every((step, index) => {
      if (index % 2 === 1) {
        return true;
      }

      const holdStep = steps[index + 1];
      return Boolean(holdStep) && colorsEqual(step.cells, holdStep.cells);
    });

  if (pairwiseRepeat) {
    const transitionDurations = steps.filter((_, index) => index % 2 === 0).map((step) => step.durationMs);
    const holdDurations = steps.filter((_, index) => index % 2 === 1).map((step) => step.durationMs);
    importedTransitions = transitionDurations;
    importedDurations = transitionDurations.map((duration, index) => duration + (holdDurations[index] ?? 0));
    steps = steps.filter((_, index) => index % 2 === 0);
  } else {
    importedTransitions = steps.map(() => 0);
    importedDurations = steps.map((step) => step.durationMs);
  }

  const defaultFrameDurationMs = Math.max(100, importedDurations[0] ?? 100);
  const defaultTransitionTimeMs = Math.min(importedTransitions[0] ?? 0, defaultFrameDurationMs);

  const project = createProject({
    name: effect.animName,
    deviceId: device.id,
    deviceModel: device.model,
    layout,
    frameDurationMs: defaultFrameDurationMs
  });

  return {
    ...project,
    name: effect.animName,
    transitionTimeMs: defaultTransitionTimeMs,
    frames: steps.map((step, index) => ({
      id: `frame_import_${index}`,
      cells: structuredClone(step.cells),
      frameDurationMs: importedDurations[index] === defaultFrameDurationMs ? undefined : importedDurations[index],
      transitionTimeMs: importedTransitions[index] === defaultTransitionTimeMs ? undefined : importedTransitions[index]
    }))
  };
}

export async function createAuthToken(device: Pick<NanoleafDevice, "host" | "port">): Promise<string> {
  const response = await fetch(`${buildBaseUrl(device)}/new`, {
    method: "POST",
    signal: withTimeout(3000)
  });
  const payload = await parseResponse<TokenResponse>(response);
  return payload.auth_token;
}

export async function fetchDeviceInfo(
  device: Pick<NanoleafDevice, "host" | "port">,
  token: string
): Promise<DeviceInfoResponse> {
  const response = await fetch(`${buildBaseUrl(device, token)}/`, {
    signal: withTimeout(3000)
  });
  return parseResponse<DeviceInfoResponse>(response);
}

export async function setDevicePower(
  device: Pick<NanoleafDevice, "host" | "port">,
  token: string,
  on: boolean
): Promise<void> {
  const response = await fetch(`${buildBaseUrl(device, token)}/state`, {
    method: "PUT",
    signal: withTimeout(3000),
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      on: {
        value: on
      }
    })
  });

  await parseResponse(response);
}

export async function fetchDeviceLayout(
  device: Pick<NanoleafDevice, "host" | "port">,
  token: string
): Promise<DeviceLayout> {
  const response = await fetch(`${buildBaseUrl(device, token)}/panelLayout/layout`, {
    signal: withTimeout(3000)
  });
  const payload = await parseResponse<RawLayoutResponse>(response);

  return {
    numPanels: payload.numPanels,
    sideLength: payload.sideLength,
    panels: payload.positionData
      .filter((panel) => panel.panelId > 0)
      .map((panel) => ({
        panelId: panel.panelId,
        x: panel.x,
        y: panel.y,
        orientation: panel.o,
        shapeType: panel.shapeType,
        shape: inferPanelShape(panel.shapeType)
      }))
  };
}

export async function getSelectedEffect(
  device: Pick<NanoleafDevice, "host" | "port">,
  token: string
): Promise<string | undefined> {
  const response = await fetch(`${buildBaseUrl(device, token)}/effects/select`, {
    signal: withTimeout(3000)
  });
  if (!response.ok) {
    return undefined;
  }

  const payload = (await response.text()) as EffectSelectResponse;

  try {
    return JSON.parse(payload) as string;
  } catch {
    return payload.trim();
  }
}

export async function listEffects(
  device: Pick<NanoleafDevice, "host" | "port">,
  token: string
): Promise<{ effects: DeviceEffectSummary[]; selectedEffectName?: string }> {
  const [response, selectedEffectName] = await Promise.all([
    putEffectCommand(device, token, {
      command: "requestAll"
    }),
    getSelectedEffect(device, token)
  ]);
  const payload = await parseBody<EffectListResponse>(response);
  const effects = (payload?.animations ?? [])
    .map((effect) => summarizeEffect(effect, selectedEffectName))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    effects,
    selectedEffectName
  };
}

export async function loadEffectProject(
  device: Pick<NanoleafDevice, "id" | "name" | "model" | "host" | "port">,
  token: string,
  effectName: string,
  layout: DeviceLayout
): Promise<{ effect: DeviceEffectSummary; project?: AnimationProject }> {
  const response = await putEffectCommand(device, token, {
    command: "request",
    animName: effectName
  });
  const effect = await parseBody<NanoleafEffect>(response);
  const summary = summarizeEffect(effect);

  if (!summary.editable) {
    return {
      effect: summary
    };
  }

  return {
    effect: summary,
    project: toProjectFromEffect(device, layout, effect)
  };
}

export async function selectEffect(
  device: Pick<NanoleafDevice, "host" | "port">,
  token: string,
  effectName: string
): Promise<void> {
  const response = await fetch(`${buildBaseUrl(device, token)}/effects`, {
    method: "PUT",
    signal: withTimeout(3000),
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      select: effectName
    })
  });

  await parseResponse(response);
}

function frameToAnimData(frame: AnimationFrame, transitionTimeMs: number): string {
  const entries = Object.entries(frame.cells);
  const segments = [String(entries.length)];
  const transitionUnits = toTransitionTimeUnits(transitionTimeMs);

  for (const [panelId, color] of entries) {
    const output = applyBrightness(color);
    segments.push(
      panelId,
      "1",
      String(output.r),
      String(output.g),
      String(output.b),
      "0",
      String(transitionUnits)
    );
  }

  return segments.join(" ");
}

function projectToAnimData(project: AnimationProject, layout: DeviceLayout): string {
  const frameTimings = project.frames.map((frame) => {
    const transitionTimeMs = getFrameTransitionTimeMs(project, frame);
    const holdTimeMs = Math.max(0, getFrameDurationMs(project, frame) - transitionTimeMs);
    return {
      transitionUnits: toTransitionTimeUnits(transitionTimeMs),
      holdUnits: toTransitionTimeUnits(holdTimeMs)
    };
  });
  const framesPerPanel = frameTimings.reduce(
    (total, timing) => total + (timing.holdUnits > 0 ? 2 : 1),
    0
  );
  const segments = [String(layout.panels.length)];

  for (const panel of layout.panels) {
    segments.push(String(panel.panelId), String(framesPerPanel));

    for (const [index, frame] of project.frames.entries()) {
      const timing = frameTimings[index];
      const color = applyBrightness(frame.cells[String(panel.panelId)] ?? createColor({ brightness: 0 }));
      segments.push(String(color.r), String(color.g), String(color.b), "0", String(timing.transitionUnits));

      if (timing.holdUnits > 0) {
        segments.push(String(color.r), String(color.g), String(color.b), "0", String(timing.holdUnits));
      }
    }
  }

  return segments.join(" ");
}

export async function displayFrame(
  device: Pick<NanoleafDevice, "host" | "port">,
  token: string,
  frame: AnimationFrame,
  transitionTimeMs = 100
): Promise<void> {
  const response = await putEffectCommand(device, token, {
    command: "display",
    version: "1.0",
    animType: "static",
    animData: frameToAnimData(frame, transitionTimeMs),
    loop: false,
    palette: []
  });

  await parseResponse(response);
}

export async function deleteEffect(
  device: Pick<NanoleafDevice, "host" | "port">,
  token: string,
  effectName: string
): Promise<void> {
  const response = await putEffectCommand(device, token, {
    command: "delete",
    animName: effectName
  });

  await parseResponse(response);
}

export async function uploadProjectEffect(
  device: Pick<NanoleafDevice, "host" | "port">,
  token: string,
  project: AnimationProject,
  layout: DeviceLayout
): Promise<string> {
  const effectName = project.name.trim() || "Nanoleaf Jazz Effect";

  try {
    await deleteEffect(device, token, effectName);
  } catch {
    // Overwrite is best-effort. Missing effects are fine.
  }

  const response = await putEffectCommand(device, token, {
    command: "add",
    animName: effectName,
    version: "2.0",
    animType: "custom",
    animData: projectToAnimData(project, layout),
    loop: true,
    palette: []
  });

  await parseResponse(response);
  await selectEffect(device, token, effectName);
  return effectName;
}

export async function probeDevicePort(
  device: Pick<NanoleafDevice, "host" | "port">,
  timeoutMs = 1000
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(device.port, device.host);
  });
}
