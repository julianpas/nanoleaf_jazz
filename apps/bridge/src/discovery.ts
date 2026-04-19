import dgram from "node:dgram";
import { createDeviceId, type DeviceSource, type NanoleafDevice } from "@nanoleaf-jazz/shared";
import mdns from "multicast-dns";

type MdnsService = {
  instance: string;
  serviceName?: string;
  target?: string;
  host?: string;
  port?: number;
};

type DiscoveryRecord = {
  host: string;
  port: number;
  name: string;
  source: DeviceSource;
  discoveryHint?: string;
};

function toDevice(record: DiscoveryRecord): NanoleafDevice {
  return {
    id: createDeviceId(record.host, record.port),
    name: record.name,
    host: record.host,
    port: record.port,
    model: "unknown",
    paired: false,
    reachable: true,
    source: record.source,
    discoveryHint: record.discoveryHint
  };
}

function mergeDiscoveredDevices(records: DiscoveryRecord[]): NanoleafDevice[] {
  const deduped = new Map<string, NanoleafDevice>();

  for (const record of records) {
    const device = toDevice(record);
    const existing = deduped.get(device.id);
    if (!existing) {
      deduped.set(device.id, device);
      continue;
    }

    deduped.set(device.id, {
      ...existing,
      ...device,
      name: existing.name !== "Nanoleaf" ? existing.name : device.name,
      source: existing.source === "manual" ? device.source : existing.source,
      discoveryHint: existing.discoveryHint || device.discoveryHint
    });
  }

  return Array.from(deduped.values());
}

function discoverViaMdns(timeoutMs = 1800): Promise<NanoleafDevice[]> {
  return new Promise((resolve) => {
    const client = mdns();
    const services = new Map<string, MdnsService>();
    const hostAddresses = new Map<string, string>();

    client.on("response", (packet) => {
      const records = [...packet.answers, ...packet.additionals];

      for (const answer of records) {
        if (answer.type === "PTR" && typeof answer.data === "string" && answer.name === "_nanoleafapi._tcp.local") {
          const instance = answer.data;
          const entry = services.get(instance) ?? { instance };
          entry.serviceName = instance.replace("._nanoleafapi._tcp.local", "");
          services.set(instance, entry);
          continue;
        }

        if (answer.type === "SRV" && typeof answer.data === "object" && answer.data) {
          const entry = services.get(answer.name) ?? { instance: answer.name };
          entry.target = answer.data.target;
          entry.port = answer.data.port ?? answer.port ?? 16021;
          if (entry.target && hostAddresses.has(entry.target)) {
            entry.host = hostAddresses.get(entry.target);
          }
          services.set(answer.name, entry);
          continue;
        }

        if ((answer.type === "A" || answer.type === "AAAA") && typeof answer.data === "string") {
          hostAddresses.set(answer.name, answer.data);
          for (const service of services.values()) {
            if (service.target === answer.name) {
              service.host = answer.data;
            }
          }
        }
      }
    });

    client.query({
      questions: [
        {
          name: "_nanoleafapi._tcp.local",
          type: "PTR"
        }
      ]
    });

    setTimeout(() => {
      client.destroy();
      const devices = Array.from(services.values())
        .filter((service) => service.host)
        .map((service) => ({
          host: service.host!,
          port: service.port ?? 16021,
          name: service.serviceName || "Nanoleaf",
          source: "mdns" as const,
          discoveryHint: service.instance
        }));

      resolve(mergeDiscoveredDevices(devices));
    }, timeoutMs);
  });
}

function parseSsdpMessage(input: string): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const line of input.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    headers[key] = value;
  }

  return headers;
}

function recordFromLocation(location: string, source: DeviceSource, hint: string): DiscoveryRecord | null {
  try {
    const url = new URL(location);
    if (!url.hostname) {
      return null;
    }

    return {
      host: url.hostname,
      port: Number.parseInt(url.port || "16021", 10),
      name: "Nanoleaf",
      source,
      discoveryHint: hint
    };
  } catch {
    return null;
  }
}

function discoverViaSsdp(timeoutMs = 2200): Promise<NanoleafDevice[]> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const results: DiscoveryRecord[] = [];
    const searchTargets = ["nanoleaf_aurora:light", "ssdp:all"];

    socket.on("message", (message) => {
      const headers = parseSsdpMessage(message.toString());
      const location = headers.location;
      const server = headers.server ?? "";
      const st = headers.st ?? headers.nt ?? "";

      if (!location) {
        return;
      }

      if (!/nanoleaf/i.test(`${server} ${st} ${location}`)) {
        return;
      }

      const record = recordFromLocation(location, "ssdp", st || server || location);
      if (record) {
        results.push(record);
      }
    });

    socket.bind(0, () => {
      for (const target of searchTargets) {
        const message = Buffer.from(
          [
            "M-SEARCH * HTTP/1.1",
            "HOST: 239.255.255.250:1900",
            'MAN: "ssdp:discover"',
            "MX: 2",
            `ST: ${target}`,
            "",
            ""
          ].join("\r\n")
        );

        socket.send(message, 1900, "239.255.255.250");
      }
    });

    setTimeout(() => {
      socket.close();
      resolve(mergeDiscoveredDevices(results));
    }, timeoutMs);
  });
}

export async function discoverDevices(): Promise<NanoleafDevice[]> {
  const [mdnsDevices, ssdpDevices] = await Promise.all([discoverViaMdns(), discoverViaSsdp()]);
  return mergeDiscoveredDevices(
    [...mdnsDevices, ...ssdpDevices].map((device) => ({
      host: device.host,
      port: device.port,
      name: device.name,
      source: device.source,
      discoveryHint: device.discoveryHint
    }))
  );
}
