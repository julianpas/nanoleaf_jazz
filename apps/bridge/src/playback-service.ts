import type {
  DeviceLayout,
  AnimationProject,
  NanoleafDevice,
  PlaybackState
} from "@nanoleaf-jazz/shared";
import { fillFrameWithPanelIds } from "@nanoleaf-jazz/shared";
import { displayFrame, getSelectedEffect, selectEffect } from "./nanoleaf-client.js";

type ActivePlayback = {
  timer: NodeJS.Timeout;
  state: PlaybackState;
  previousEffect?: string;
};

export class PlaybackService {
  private activePlayback?: ActivePlayback;

  getState(): PlaybackState {
    return this.activePlayback?.state ?? { active: false };
  }

  async start(
    device: Pick<NanoleafDevice, "id" | "host" | "port">,
    token: string,
    project: AnimationProject,
    layout: DeviceLayout
  ) {
    await this.stop(device, token);

    const previousEffect = await getSelectedEffect(device, token);
    let frameIndex = 0;
    const intervalMs = Math.max(16, Math.round(project.frameDurationMs));
    const panelIds = layout.panels.map((panel) => panel.panelId);

    const tick = async () => {
      const frame = project.frames[frameIndex];
      if (!frame) {
        return;
      }

      await displayFrame(device, token, fillFrameWithPanelIds(frame, panelIds), project.transitionTimeMs);
      this.activePlayback = {
        timer,
        previousEffect,
        state: {
          active: true,
          deviceId: device.id,
          projectId: project.id,
          frameIndex
        }
      };
      frameIndex = (frameIndex + 1) % project.frames.length;
    };

    const timer = setInterval(() => {
      void tick();
    }, intervalMs);

    await tick();
  }

  async stop(device?: Pick<NanoleafDevice, "host" | "port">, token?: string) {
    const activePlayback = this.activePlayback;
    if (!activePlayback) {
      return;
    }

    clearInterval(activePlayback.timer);
    this.activePlayback = undefined;

    if (device && token && activePlayback.previousEffect) {
      try {
        await selectEffect(device, token, activePlayback.previousEffect);
      } catch {
        // Leave the last frame active if restoring the previous effect fails.
      }
    }
  }
}
