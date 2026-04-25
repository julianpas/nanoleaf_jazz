import type {
  DeviceLayout,
  AnimationProject,
  AnimationFrame,
  NanoleafDevice,
  PlaybackState
} from "@nanoleaf-jazz/shared";
import { fillFrameWithPanelIds, getFrameDurationMs, getFrameTransitionTimeMs } from "@nanoleaf-jazz/shared";
import { displayFrame, getSelectedEffect, selectEffect } from "./nanoleaf-client.js";

type ActivePlayback = {
  session: symbol;
  timer?: NodeJS.Timeout;
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
    const session = Symbol("playback");
    let frameIndex = 0;
    const panelIds = layout.panels.map((panel) => panel.panelId);

    this.activePlayback = {
      session,
      previousEffect,
      state: {
        active: true,
        deviceId: device.id,
        projectId: project.id,
        frameIndex
      }
    };

    const scheduleNext = (delayMs: number) => {
      if (this.activePlayback?.session !== session) {
        return;
      }

      this.activePlayback.timer = setTimeout(() => {
        void tick();
      }, delayMs);
    };

    const tick = async (): Promise<void> => {
      const frame = project.frames[frameIndex];
      if (!frame || this.activePlayback?.session !== session) {
        return;
      }

      const transitionTimeMs = getFrameTransitionTimeMs(project, frame);
      const frameDurationMs = getFrameDurationMs(project, frame);
      await displayFrame(device, token, fillFrameWithPanelIds(frame, panelIds), transitionTimeMs);

      if (this.activePlayback?.session !== session) {
        return;
      }

      this.activePlayback = {
        ...this.activePlayback,
        previousEffect,
        state: {
          active: true,
          deviceId: device.id,
          projectId: project.id,
          frameIndex
        }
      };
      frameIndex = (frameIndex + 1) % project.frames.length;
      scheduleNext(frameDurationMs);
    }

    await tick();
  }

  async stop(device?: Pick<NanoleafDevice, "host" | "port">, token?: string) {
    const activePlayback = this.activePlayback;
    if (!activePlayback) {
      return;
    }

    if (activePlayback.timer) {
      clearTimeout(activePlayback.timer);
    }
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
