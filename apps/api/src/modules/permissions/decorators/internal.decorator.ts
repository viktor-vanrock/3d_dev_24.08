import { SetMetadata } from "@nestjs/common";
import { AccessMode } from "../domain/access-mode.ts";
import { ACCESS_MODE_KEY } from "../guards/permission.guard.ts";

// Вход защищён отдельной машинной аутентификацией (API key, relay secret,
// webhook signature). Permission grants к нему не применяются.
export const Internal = (): ClassDecorator & MethodDecorator => SetMetadata(ACCESS_MODE_KEY, AccessMode.INTERNAL);
