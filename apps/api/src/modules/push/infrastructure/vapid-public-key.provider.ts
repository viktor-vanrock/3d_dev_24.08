import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class VapidPublicKeyProvider {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  read(): string | null {
    const publicKey = this.config.get<string>("VAPID_PUBLIC_KEY");
    const privateKey = this.config.get<string>("VAPID_PRIVATE_KEY");
    return publicKey !== undefined && publicKey !== "" && privateKey !== undefined && privateKey !== "" ? publicKey : null;
  }
}
