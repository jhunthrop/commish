import "@testing-library/jest-dom/vitest";
import "vitest-axe/extend-expect";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// vitest.config.mts sets `globals: false`, so @testing-library/react's automatic
// afterEach(cleanup) (which relies on global test hooks) never registers. Register
// it once here so every RTL test file unmounts between tests without boilerplate.
afterEach(() => {
  cleanup();
});
