import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createDeviceId, type AddManualDeviceInput, type NanoleafDevice } from "@nanoleaf-jazz/shared";

type StoredDeviceConfig = {
  tokens: Record<string, string>;
  manualDevices: Record<string, NanoleafDevice>;
};

const DEFAULT_CONFIG: StoredDeviceConfig = {
  tokens: {},
  manualDevices: {}
};

function getConfigPath(): string {
  return join(homedir(), ".nanoleaf-jazz", "config.json");
}

function migrateLegacyDeviceId(deviceId: string): string {
  if (deviceId.startsWith("manual:") || deviceId.startsWith("mdns:") || deviceId.startsWith("ssdp:")) {
    return createDeviceId(deviceId.split(":").slice(1).join(":"));
  }

  return deviceId;
}

export async function readConfig(): Promise<StoredDeviceConfig> {
  const path = getConfigPath();

  try {
    const contents = await readFile(path, "utf8");
    const parsed = JSON.parse(contents) as Partial<StoredDeviceConfig>;
    const tokens = Object.fromEntries(
      Object.entries(parsed.tokens ?? {}).map(([deviceId, token]) => [migrateLegacyDeviceId(deviceId), token])
    );
    const manualDevices = Object.fromEntries(
      Object.values(parsed.manualDevices ?? {}).map((device) => {
        const deviceId = createDeviceId(device.host, device.port);
        return [
          deviceId,
          {
            ...device,
            id: deviceId,
            paired: Boolean(tokens[deviceId]),
            reachable: device.reachable ?? false,
            source: "manual" as const,
            discoveryHint: "manual"
          }
        ];
      })
    );

    return {
      tokens,
      manualDevices
    };
  } catch (error) {
    const knownCode = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (knownCode === "ENOENT") {
      return DEFAULT_CONFIG;
    }

    throw error;
  }
}

export async function writeConfig(config: StoredDeviceConfig): Promise<void> {
  const path = getConfigPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2), "utf8");
}

export async function saveToken(deviceId: string, token: string): Promise<void> {
  const config = await readConfig();
  config.tokens[deviceId] = token;
  await writeConfig(config);
}

export async function getToken(deviceId: string): Promise<string | undefined> {
  const config = await readConfig();
  return config.tokens[deviceId];
}

export async function clearToken(deviceId: string): Promise<void> {
  const config = await readConfig();
  delete config.tokens[deviceId];
  await writeConfig(config);
}

export async function addManualDevice(input: AddManualDeviceInput): Promise<NanoleafDevice> {
  const config = await readConfig();
  const host = input.host.trim();
  const port = input.port ?? 16021;
  const id = createDeviceId(host, port);
  const device: NanoleafDevice = {
    id,
    name: input.name?.trim() || `Nanoleaf ${host}`,
    host,
    port,
    model: "unknown",
    paired: Boolean(config.tokens[id]),
    reachable: false,
    source: "manual",
    discoveryHint: "manual"
  };
  config.manualDevices[id] = device;
  await writeConfig(config);
  return device;
}

export async function getManualDevices(): Promise<NanoleafDevice[]> {
  const config = await readConfig();
  return Object.values(config.manualDevices).map((device) => ({
    ...device,
    paired: Boolean(config.tokens[device.id]),
    reachable: device.reachable ?? false,
    source: "manual"
  }));
}
