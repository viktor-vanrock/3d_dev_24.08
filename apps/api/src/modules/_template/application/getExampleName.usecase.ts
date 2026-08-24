// _template — application layer. Use-cases orchestrate the domain + repositories and own transaction
// boundaries. This is where a public port's behavior is implemented. Thin controllers call these;
// foreign domains reach these only through the public port (never importing this file directly).

import type { ExampleId } from "../domain/types.ts";
import type { ExampleRepository } from "../infrastructure/example.repository.ts";
import type { ExamplePort } from "../public/index.ts";

export class GetExampleNameUseCase implements ExamplePort {
  constructor(private readonly repo: ExampleRepository) {}

  async getExampleName(id: ExampleId): Promise<string | null> {
    const example = await this.repo.findById(id);
    return example?.name ?? null;
  }
}
