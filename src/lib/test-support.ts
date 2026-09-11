import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

/**
 * RESOLVE A ROUTE THE WAY THE SERVER DOES, for route-level tests.
 *
 * A Next route is a tree of async server components: the framework awaits each one and splices
 * its result in before any browser React sees the tree. `@testing-library/react` drives browser
 * React, which refuses an async component outright ("... is an async Client Component"), so a
 * route test that only awaits the page function stops at the FIRST component and never runs the
 * server work nested beneath it. A route whose membership gate lives one component deep (the
 * league room's `RoomPage`) then renders as an un-invoked element instead of throwing its 404.
 *
 * This walks the tree and awaits exactly the async components, leaving synchronous ones as
 * elements for `render` to drive with real hooks. At runtime that is precisely the server/client
 * boundary: a `"use client"` component is a plain synchronous function, and only a server
 * component returns a promise. Anything an awaited component throws (`notFound()`, `redirect()`)
 * propagates out of the returned promise, exactly as a browser would see it.
 */
function isAsyncComponent(type: unknown): type is (props: object) => Promise<ReactNode> {
  return typeof type === "function" && type.constructor.name === "AsyncFunction";
}

export async function resolveServerTree(node: ReactNode | Promise<ReactNode>): Promise<ReactNode> {
  const resolved = await node;

  if (Array.isArray(resolved)) {
    return Promise.all(resolved.map((child) => resolveServerTree(child as ReactNode)));
  }
  if (!isValidElement(resolved)) return resolved;

  const element = resolved as ReactElement<{ readonly children?: ReactNode }>;
  if (isAsyncComponent(element.type)) {
    return resolveServerTree(await element.type(element.props));
  }

  const { children } = element.props;
  if (children === undefined) return element;
  return cloneElement(element, undefined, await resolveServerTree(children));
}
