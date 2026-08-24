import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { AssistantRunEnqueueRepository } from "../../modules/assistant/infrastructure/assistant-run-enqueue.repository.ts";
import { GenerationEnqueueRepository } from "../../modules/generations/infrastructure/generation-enqueue.repository.ts";
import { ModelIndexEnqueueRepository } from "../../modules/models/infrastructure/model-index-enqueue.repository.ts";
import { ProjectSliceEnqueueRepository } from "../../modules/models/infrastructure/project-slice-enqueue.repository.ts";
import { MeshConversionEnqueueRepository } from "../../modules/projects/infrastructure/mesh-conversion-enqueue.repository.ts";
import { DATABASE_POOL } from "../database/database.constants.ts";
import type { QueueEnqueueResult, QueueJob, QueuePort } from "./queue.port.ts";

function unsupportedJob(job: never): never {
  const queue = (job as { readonly queue?: string }).queue ?? "missing";
  throw new TypeError(`unsupported queue job '${queue}'`);
}

@Injectable()
export class PgQueueAdapter implements QueuePort {
  private readonly modelIndex: ModelIndexEnqueueRepository;
  private readonly meshConversion: MeshConversionEnqueueRepository;
  private readonly projectSlice: ProjectSliceEnqueueRepository;
  private readonly generation: GenerationEnqueueRepository;
  private readonly assistantRun: AssistantRunEnqueueRepository;

  constructor(@Inject(DATABASE_POOL) pool: Pool) {
    this.modelIndex = new ModelIndexEnqueueRepository(pool);
    this.meshConversion = new MeshConversionEnqueueRepository(pool);
    this.projectSlice = new ProjectSliceEnqueueRepository(pool);
    this.generation = new GenerationEnqueueRepository(pool);
    this.assistantRun = new AssistantRunEnqueueRepository(pool);
  }

  async enqueue(job: QueueJob): Promise<QueueEnqueueResult> {
    switch (job.queue) {
      case "model-index.v1":
        return this.modelIndex.enqueue(job);
      case "mesh-conversion.v1":
        return this.meshConversion.enqueue(job);
      case "project-slice-request.v1":
        return this.projectSlice.enqueue(job);
      case "generation.v2":
        return this.generation.enqueue(job);
      case "assistant-run.v1":
        return this.assistantRun.enqueue(job);
      default:
        return unsupportedJob(job);
    }
  }
}
