import { Injectable } from "@nestjs/common";
import type { OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";

@Injectable()
export class RuntimeState implements OnApplicationBootstrap, OnApplicationShutdown {
  private ready = false;
  private reason: string | undefined = "booting";

  onApplicationBootstrap(): void {
    this.markReady();
  }

  onApplicationShutdown(): void {
    this.markNotReady("shutting_down");
  }

  markReady(): void {
    this.ready = true;
    this.reason = undefined;
  }

  markNotReady(reason: string): void {
    this.ready = false;
    this.reason = reason.slice(0, 64);
  }

  snapshot(): { readonly ready: boolean; readonly reason?: string } {
    return this.reason ? { ready: this.ready, reason: this.reason } : { ready: this.ready };
  }
}
