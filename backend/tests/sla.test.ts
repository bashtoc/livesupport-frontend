import { describe, expect, it } from "vitest";
import { addBusinessMinutes } from "../src/modules/sla/service.js";

describe("business-hour SLA deadlines", () => {
  const policy = {
    timezone: "Africa/Lagos",
    business_days: [1, 2, 3, 4, 5],
    business_open: "08:00:00",
    business_close: "18:00:00",
    first_response_minutes: 15,
    resolution_minutes: 480,
  };

  it("counts only minutes inside configured business hours", () => {
    const fridayAtClose = new Date("2026-10-02T16:55:00.000Z"); // 17:55 Lagos
    const result = addBusinessMinutes(fridayAtClose, 10, policy);
    expect(result.toISOString()).toBe("2026-10-05T07:05:00.000Z");
  });
});
