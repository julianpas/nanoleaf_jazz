import { access } from "node:fs/promises";
import { resolve } from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  createDeviceId,
  type DeviceEffectProjectResponse,
  type DeviceEffectsResponse,
  fillFrameWithPanelIds,
  type AddManualDeviceInput,
  type HealthResponse,
  type NanoleafDevice,
  type PairDeviceInput,
  type PlaybackFrameInput,
  type PlaybackStartInput,
  type SetDevicePowerInput,
  type UploadProjectInput
} from "@nanoleaf-jazz/shared";
import { addManualDevice, clearToken, getManualDevices, getToken, saveToken } from "./config-store.js";
import { discoverDevices } from "./discovery.js";
import {
  createAuthToken,
  displayFrame,
  fetchDeviceInfo,
  fetchDeviceLayout,
  listEffects,
  loadEffectProject,
  probeDevicePort,
  setDevicePower,
  uploadProjectEffect
} from "./nanoleaf-client.js";
import { PlaybackService } from "./playback-service.js";

export type BridgeServerOptions = {
  logger?: boolean;
  webDist?: string;
};

export type StartBridgeOptions = BridgeServerOptions & {
  host?: string;
  port?: number;
};

export type BridgeRuntime = {
  server: FastifyInstance;
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
};

type StaticReply = FastifyReply & {
  sendFile: (filePath: string) => FastifyReply;
};

const EXPENSIVE_ENDPOINT_RATE_LIMIT = {
  max: 10,
  timeWindow: "1 second"
};

function getDefaultWebDistCandidates(): string[] {
  if (process.env.NANOLEAF_JAZZ_WEB_DIST) {
    return [process.env.NANOLEAF_JAZZ_WEB_DIST];
  }

  return [
    resolve(process.cwd(), "apps/web/dist"),
    resolve(process.cwd(), "../web/dist"),
    resolve(process.cwd(), "web")
  ];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function getBrowserHost(host: string): string {
  return host === "0.0.0.0" ? "127.0.0.1" : host;
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1]?.replace(/\\/g, "/");
  return Boolean(entryPoint?.endsWith("/apps/bridge/dist/server.js") || entryPoint?.endsWith("/apps/bridge/src/server.ts"));
}

export async function createBridgeServer(options: BridgeServerOptions = {}): Promise<FastifyInstance> {
  const playback = new PlaybackService();
  const server = Fastify({
    logger: options.logger ?? true
  });

  await server.register(cors, {
    origin: true
  });

  async function resolveDevices(): Promise<NanoleafDevice[]> {
    const [discoveredDevices, manualDevices] = await Promise.all([discoverDevices(), getManualDevices()]);
    const deduped = new Map<string, NanoleafDevice>();

    for (const device of [...manualDevices, ...discoveredDevices]) {
      const token = await getToken(device.id);
      const existing = deduped.get(device.id);
      deduped.set(device.id, {
        ...existing,
        ...device,
        paired: Boolean(token),
        reachable: existing?.reachable || device.reachable
      });
    }

    const devices = Array.from(deduped.values());
    return Promise.all(
      devices.map(async (device) => ({
        ...device,
        reachable: device.reachable || (await probeDevicePort(device))
      }))
    );
  }

  async function findDevice(deviceId: string): Promise<NanoleafDevice> {
    const devices = await resolveDevices();
    const device = devices.find((entry) => entry.id === deviceId);
    if (!device) {
      throw new Error(`Unknown device: ${deviceId}`);
    }

    return device;
  }

  async function hydrateDevice(device: NanoleafDevice): Promise<NanoleafDevice> {
    const token = await getToken(device.id);
    const reachable = device.reachable || (await probeDevicePort(device));

    if (!token || !reachable) {
      return {
        ...device,
        paired: Boolean(token),
        reachable
      };
    }

    try {
      const info = await fetchDeviceInfo(device, token);
      return {
        ...device,
        name: info.name || device.name,
        model: info.model || device.model,
        firmwareVersion: info.firmwareVersion,
        isOn: info.state?.on?.value,
        paired: true,
        reachable: true
      };
    } catch {
      await clearToken(device.id);
      return {
        ...device,
        paired: false,
        reachable
      };
    }
  }

  await server.register(rateLimit, {
    global: false
  });

  server.get("/api/health", async (): Promise<HealthResponse> => ({
    ok: true,
    playback: playback.getState()
  }));

  server.get(
    "/api/devices",
    {
      config: {
        rateLimit: EXPENSIVE_ENDPOINT_RATE_LIMIT
      }
    },
    async () => {
      const devices = await resolveDevices();
      return Promise.all(devices.map((device) => hydrateDevice(device)));
    }
  );

  server.post("/api/devices/manual", async (request, reply) => {
    const input = request.body as AddManualDeviceInput;
    if (!input?.host) {
      return reply.code(400).send({ message: "host is required" });
    }

    const port = input.port ?? 16021;
    const candidateDevice: NanoleafDevice = {
      id: createDeviceId(input.host, port),
      name: "Nanoleaf",
      host: input.host.trim(),
      port,
      model: "unknown",
      paired: false,
      reachable: false,
      source: "manual",
      discoveryHint: "manual"
    };

    if (!(await probeDevicePort(candidateDevice))) {
      return reply.code(400).send({
        message: `No Nanoleaf controller answered on ${candidateDevice.host}:${candidateDevice.port}.`
      });
    }

    const device = await addManualDevice(input);
    return {
      ...device,
      reachable: true
    };
  });

  server.post(
    "/api/devices/:id/pair",
    {
      config: {
        rateLimit: EXPENSIVE_ENDPOINT_RATE_LIMIT
      }
    },
    async (request, reply) => {
      const params = request.params as { id: string };
      const _input = request.body as PairDeviceInput | undefined;

      try {
        const device = await findDevice(params.id);
        const token = await createAuthToken(device);
        await saveToken(device.id, token);
        const info = await fetchDeviceInfo(device, token);

        return {
          ...device,
          name: info.name || device.name,
          model: info.model || device.model,
          firmwareVersion: info.firmwareVersion,
          isOn: info.state?.on?.value,
          paired: true,
          reachable: true
        };
      } catch (error) {
        request.log.error(error);
        return reply.code(400).send({
          message: "Pairing failed. Open the Nanoleaf pairing window and try again."
        });
      }
    }
  );

  server.post("/api/devices/:id/power", async (request, reply) => {
    const params = request.params as { id: string };
    const input = request.body as SetDevicePowerInput;

    try {
      const device = await findDevice(params.id);
      const token = await getToken(device.id);

      if (!token) {
        return reply.code(401).send({ message: "Device is not paired" });
      }

      if (!(await probeDevicePort(device))) {
        return reply.code(503).send({ message: "Device is not reachable on the local network" });
      }

      await setDevicePower(device, token, Boolean(input?.on));
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ message: "Unable to change device power" });
    }
  });

  server.get("/api/devices/:id/layout", async (request, reply) => {
    const params = request.params as { id: string };

    try {
      const device = await findDevice(params.id);
      const token = await getToken(device.id);

      if (!token) {
        return reply.code(401).send({ message: "Device is not paired" });
      }

      if (!(await probeDevicePort(device))) {
        return reply.code(503).send({ message: "Device is not reachable on the local network" });
      }

      return await fetchDeviceLayout(device, token);
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ message: "Unable to fetch layout" });
    }
  });

  server.get("/api/devices/:id/effects", async (request, reply): Promise<DeviceEffectsResponse | FastifyReply> => {
    const params = request.params as { id: string };

    try {
      const device = await findDevice(params.id);
      const token = await getToken(device.id);

      if (!token) {
        return reply.code(401).send({ message: "Device is not paired" });
      }

      if (!(await probeDevicePort(device))) {
        return reply.code(503).send({ message: "Device is not reachable on the local network" });
      }

      return await listEffects(device, token);
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ message: "Unable to fetch device effects" });
    }
  });

  server.get(
    "/api/devices/:id/effects/:effectName/import",
    async (request, reply): Promise<DeviceEffectProjectResponse | FastifyReply> => {
      const params = request.params as { id: string; effectName: string };

      try {
        const device = await findDevice(params.id);
        const token = await getToken(device.id);

        if (!token) {
          return reply.code(401).send({ message: "Device is not paired" });
        }

        if (!(await probeDevicePort(device))) {
          return reply.code(503).send({ message: "Device is not reachable on the local network" });
        }

        const layout = await fetchDeviceLayout(device, token);
        return await loadEffectProject(device, token, params.effectName, layout);
      } catch (error) {
        request.log.error(error);
        return reply.code(500).send({ message: "Unable to load device effect" });
      }
    }
  );

  server.post("/api/playback/frame", async (request, reply) => {
    const input = request.body as PlaybackFrameInput;
    const device = await findDevice(input.deviceId);
    const token = await getToken(device.id);

    if (!token) {
      return reply.code(401).send({ message: "Device is not paired" });
    }

    if (!(await probeDevicePort(device))) {
      return reply.code(503).send({ message: "Device is not reachable on the local network" });
    }

    try {
      const layout = await fetchDeviceLayout(device, token);
      const fullFrame = fillFrameWithPanelIds(input.frame, layout.panels.map((panel) => panel.panelId));
      await displayFrame(device, token, fullFrame, input.transitionTimeMs);
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ message: "Preview failed" });
    }
  });

  server.post("/api/playback/start", async (request, reply) => {
    const input = request.body as PlaybackStartInput;
    const device = await findDevice(input.deviceId);
    const token = await getToken(device.id);

    if (!token) {
      return reply.code(401).send({ message: "Device is not paired" });
    }

    if (!(await probeDevicePort(device))) {
      return reply.code(503).send({ message: "Device is not reachable on the local network" });
    }

    try {
      const layout = await fetchDeviceLayout(device, token);
      await playback.start(device, token, input.project, layout);
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ message: "Playback failed" });
    }
  });

  server.post("/api/playback/stop", async (request, reply) => {
    const body = (request.body ?? {}) as { deviceId?: string };

    try {
      if (body.deviceId) {
        const device = await findDevice(body.deviceId);
        const token = await getToken(device.id);
        await playback.stop(device, token);
      } else {
        await playback.stop();
      }

      return { ok: true };
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ message: "Unable to stop playback" });
    }
  });

  server.post("/api/effects/upload", async (request, reply) => {
    const input = request.body as UploadProjectInput;
    const device = await findDevice(input.deviceId);
    const token = await getToken(device.id);

    if (!token) {
      return reply.code(401).send({ message: "Device is not paired" });
    }

    if (!(await probeDevicePort(device))) {
      return reply.code(503).send({ message: "Device is not reachable on the local network" });
    }

    try {
      const layout = await fetchDeviceLayout(device, token);
      const effectName = await uploadProjectEffect(device, token, input.project, layout);
      return { ok: true, effectName };
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ message: "Upload to device failed" });
    }
  });

  const webDistCandidates = options.webDist ? [options.webDist] : getDefaultWebDistCandidates();
  let webDist: string | undefined;
  for (const candidate of webDistCandidates) {
    if (await pathExists(candidate)) {
      webDist = candidate;
      break;
    }
  }

  if (webDist) {
    await server.register(fastifyStatic, {
      root: webDist,
      prefix: "/"
    });

    server.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ message: "API route not found" });
      }

      return (reply as StaticReply).sendFile("index.html");
    });
  }

  return server;
}

export async function startBridgeServer(options: StartBridgeOptions = {}): Promise<BridgeRuntime> {
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const port = options.port ?? Number.parseInt(process.env.PORT ?? "8787", 10);
  const server = await createBridgeServer(options);

  await server.listen({
    host,
    port
  });

  const address = server.server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  const browserHost = getBrowserHost(host);

  return {
    server,
    host,
    port: boundPort,
    url: `http://${browserHost}:${boundPort}`,
    close: () => server.close()
  };
}

if (isMainModule()) {
  startBridgeServer({
    host: process.env.HOST ?? "0.0.0.0",
    port: Number.parseInt(process.env.PORT ?? "8787", 10),
    logger: true
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
