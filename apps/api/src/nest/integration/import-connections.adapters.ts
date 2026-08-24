import { Global, Injectable, Module } from "@nestjs/common";
import { decryptIdentity, encryptIdentity } from "../../modules/auth/public/index.ts";
import { createCults3dConnector, PermanentImportItemError, type ImportAuth } from "../../modules/imports/public/index.ts";
import { ImportProviderUnavailableError, InvalidImportCredentialsError } from "../../modules/importConnections/public/index.ts";
import { IMPORT_CONNECTIONS_EXTERNAL_PORT, type ExternalImportModelSummary, type ImportConnectionsExternalPort } from "../../modules/importConnections/public/index.ts";

interface StoredCredential {
  readonly api_key: string;
}

@Injectable()
export class ImportConnectionsExternalAdapter implements ImportConnectionsExternalPort {
  validateCredentials(input: { readonly username: string; readonly apiKey: string }): Promise<readonly ExternalImportModelSummary[]> {
    return this.list(input);
  }

  listModels(input: { readonly username: string; readonly apiKey: string }): Promise<readonly ExternalImportModelSummary[]> {
    return this.list(input);
  }

  encryptCredentials(apiKey: string): Buffer {
    return encryptIdentity({ api_key: apiKey } satisfies StoredCredential);
  }

  decryptCredentials(value: Buffer): string {
    return (decryptIdentity(value) as StoredCredential).api_key;
  }

  private async list(auth: ImportAuth): Promise<readonly ExternalImportModelSummary[]> {
    try {
      return await createCults3dConnector(auth, null).listOwnModels(auth);
    } catch (error) {
      if (error instanceof PermanentImportItemError) throw new InvalidImportCredentialsError();
      throw new ImportProviderUnavailableError();
    }
  }
}

@Global()
@Module({
  providers: [ImportConnectionsExternalAdapter, { provide: IMPORT_CONNECTIONS_EXTERNAL_PORT, useExisting: ImportConnectionsExternalAdapter }],
  exports: [IMPORT_CONNECTIONS_EXTERNAL_PORT],
})
export class ImportConnectionsIntegrationModule {}
