import { SetMetadata } from "@nestjs/common";
import { ACCESS_MODE_KEY } from "../guards/permission.guard.ts";
import { AccessMode } from "../domain/access-mode.ts";

// Маршрут не требует аутентификации. Внутреннюю проверку бизнес-входа этот
// декоратор не заменяет: для неё используется @Internal().
export const Public = (): ClassDecorator & MethodDecorator => SetMetadata(ACCESS_MODE_KEY, AccessMode.PUBLIC);
