import { Inject, Injectable } from "@nestjs/common";
import type { OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "./database.constants.ts";

@Injectable()
export class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(_signal?: string): Promise<void> {
    await this.pool.end();
  }
}
