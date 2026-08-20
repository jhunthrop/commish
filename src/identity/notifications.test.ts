import { describe, it, expect } from "vitest";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/events";
import { NOTIFICATION_CATALOG, channelStatus, deliverableChannels } from "./notifications";

describe("NOTIFICATION_CATALOG", () => {
  it("only catalogues things the product actually publishes", () => {
    // The catalog is a promise to the user about what they will be told. Every topic maps to a
    // real event type in the one taxonomy, so a topic cannot describe a notification nobody sends.
    for (const topic of NOTIFICATION_CATALOG) {
      for (const event of topic.events) expect(REALTIME_EVENT_TYPES).toContain(event);
    }
  });

  it("gives every topic a key, a title and a detail", () => {
    for (const topic of NOTIFICATION_CATALOG) {
      expect(topic.key.length).toBeGreaterThan(0);
      expect(topic.title.length).toBeGreaterThan(0);
      expect(topic.detail.length).toBeGreaterThan(0);
      expect(topic.events.length).toBeGreaterThan(0);
    }
  });
});

describe("channels", () => {
  it("reports email as not connected, and in-app as live", () => {
    // Plan D delivers the sender. Until it does, email is DESCRIBED and never offered as a switch:
    // a toggle that changes nothing is the half-state the no-MVP directive rules out, and in a
    // product about to hold money it is worse than absent, because the user believes it.
    expect(deliverableChannels()).toEqual(["in_app"]);
    expect(channelStatus("email")).toBe("not-connected");
    expect(channelStatus("in_app")).toBe("live");
  });
});
