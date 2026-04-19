import net from "node:net";
import {
  applyBrightness,
  createColor,
  inferPanelShape,
  type AnimationFrame,
  type AnimationProject,
  type DeviceLayout,
  type NanoleafDevice
} from "@nanoleaf-jazz/shared";

type DeviceInfoResponse = {
  name: string;
  model: string;
  firmwareVersion?: string;
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
  const transitionTimeMs = Math.max(0, Math.min(project.transitionTimeMs, project.frameDurationMs));
  const holdTimeMs = Math.max(0, project.frameDurationMs - transitionTimeMs);
  const transitionUnits = toTransitionTimeUnits(transitionTimeMs);
  const holdUnits = toTransitionTimeUnits(holdTimeMs);
  const framesPerPanel = project.frames.length * (holdUnits > 0 ? 2 : 1);
  const segments = [String(layout.panels.length)];

  for (const panel of layout.panels) {
    segments.push(String(panel.panelId), String(framesPerPanel));

    for (const frame of project.frames) {
      const color = applyBrightness(frame.cells[String(panel.panelId)] ?? createColor({ brightness: 0 }));
      segments.push(String(color.r), String(color.g), String(color.b), "0", String(transitionUnits));

      if (holdUnits > 0) {
        segments.push(String(color.r), String(color.g), String(color.b), "0", String(holdUnits));
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
