import { UnauthorizedException } from "@nestjs/common";

export class AccountRestrictedException extends UnauthorizedException {
  constructor(readonly endsAt: string | null) {
    super();
  }
}
