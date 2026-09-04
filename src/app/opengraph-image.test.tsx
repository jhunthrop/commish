import { describe, expect, it } from "vitest";
import { alt, size, contentType } from "./opengraph-image";

/**
 * Route-level coverage only: `ImageResponse` itself renders through Satori, which is Next's own
 * concern to test, not this product's. What this file owns is the metadata Next reads to serve
 * the route correctly — the exact dimensions link-unfurl consumers expect, the declared content
 * type, and the alt text a screen reader announces for the card.
 */
describe("opengraph-image", () => {
  it("declares the 1200x630 unfurl card and PNG content type", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
  });

  it("carries the product's own name as its alt text", () => {
    expect(alt).toBe("Commish");
  });
});
