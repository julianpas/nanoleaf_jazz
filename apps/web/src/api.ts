import type {
  AddManualDeviceInput,
  AnimationFrame,
  AnimationProject,
  DeviceLayout,
  HealthResponse,
  NanoleafDevice
} from "@nanoleaf-jazz/shared";

const API_ROOT = import.meta.env.VITE_API_ROOT ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(payload.message || "Request failed");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function getHealth() {
  return request<HealthResponse>("/health");
}

export function getDevices() {
  return request<NanoleafDevice[]>("/devices");
}

export function addManualDevice(input: AddManualDeviceInput) {
  return request<NanoleafDevice>("/devices/manual", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function pairDevice(deviceId: string) {
  return request<NanoleafDevice>(`/devices/${encodeURIComponent(deviceId)}/pair`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function getLayout(deviceId: string) {
  return request<DeviceLayout>(`/devices/${encodeURIComponent(deviceId)}/layout`);
}

export function previewFrame(deviceId: string, frame: AnimationFrame, transitionTimeMs?: number) {
  return request<{ ok: true }>("/playback/frame", {
    method: "POST",
    body: JSON.stringify({ deviceId, frame, transitionTimeMs })
  });
}

export function startPlayback(deviceId: string, project: AnimationProject) {
  return request<{ ok: true }>("/playback/start", {
    method: "POST",
    body: JSON.stringify({ deviceId, project })
  });
}

export function stopPlayback(deviceId?: string) {
  return request<{ ok: true }>("/playback/stop", {
    method: "POST",
    body: JSON.stringify({ deviceId })
  });
}

export function uploadProject(deviceId: string, project: AnimationProject) {
  return request<{ ok: true; effectName: string }>("/effects/upload", {
    method: "POST",
    body: JSON.stringify({ deviceId, project })
  });
}
