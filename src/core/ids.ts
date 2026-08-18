import { SkillRouterError } from "../utils/errors.ts";

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function isValidCapabilityId(id: string): boolean {
  return ID_RE.test(id) && id.length <= 64;
}

export function assertValidCapabilityId(id: string): void {
  if (!isValidCapabilityId(id)) {
    throw new SkillRouterError("E_ID", `Invalid capability id "${id}". Use lowercase letters, numbers and dashes (e.g. "stripe-expert").`);
  }
}
