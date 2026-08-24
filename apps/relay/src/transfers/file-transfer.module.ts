import { Module, type DynamicModule, type Provider } from "@nestjs/common";
import { RelayApiModule } from "../api/api.module.ts";
import { ObservabilityModule } from "../observability/observability.module.ts";
import { FILE_TRANSFER_OPTIONS, FileTransferService, type FileTransferOptions } from "./file-transfer.service.ts";

export interface FileTransferModuleOptions {
  /** Provider whose token is TRANSFER_SESSION_PORT. */
  readonly sessionPort: Provider;
  readonly transfer?: Partial<FileTransferOptions>;
}

@Module({})
export class FileTransferModule {
  static register(options: FileTransferModuleOptions): DynamicModule {
    return {
      module: FileTransferModule,
      imports: [RelayApiModule, ObservabilityModule],
      providers: [
        options.sessionPort,
        { provide: FILE_TRANSFER_OPTIONS, useValue: options.transfer ?? {} },
        FileTransferService,
      ],
      exports: [FileTransferService],
    };
  }
}
