import { SetMetadata } from "@nestjs/common";
import { AccessMode } from "../domain/access-mode.ts";
import { ACCESS_MODE_KEY } from "../guards/permission.guard.ts";

// Требует существующую активную пользовательскую сессию, без platform grant.
export const User = (): ClassDecorator & MethodDecorator => SetMetadata(ACCESS_MODE_KEY, AccessMode.USER);
