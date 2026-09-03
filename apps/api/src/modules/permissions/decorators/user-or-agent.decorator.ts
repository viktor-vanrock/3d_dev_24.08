import { SetMetadata } from "@nestjs/common";
import { AccessMode } from "../domain/access-mode.ts";
import { ACCESS_MODE_KEY } from "../guards/permission.guard.ts";

// Маршрут принимает активную пользовательскую сессию либо действующий
// агентский content API key. Конкретная проверка ключа выполняется guard'ом.
export const UserOrAgent = (): ClassDecorator & MethodDecorator => SetMetadata(ACCESS_MODE_KEY, AccessMode.USER_OR_AGENT);
