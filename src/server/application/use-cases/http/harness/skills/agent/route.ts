import { NextRequest } from "next/server";

import { applySkillWrite } from "../route";

/**
 * The agent's path for writing a skill.
 *
 * Separate from the operator's `PUT /api/harness/skills` so that who asked is
 * decided by where the request arrived rather than by a field it can set. Only
 * the harness tool executors post here.
 */
export async function PUT(request: NextRequest) {
  return applySkillWrite(request, "agent");
}
