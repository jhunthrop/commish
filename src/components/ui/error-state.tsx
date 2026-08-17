import type { ReactNode } from "react";
import { StatePanel } from "./state-panel";

export interface ErrorStateProps {
  readonly title: string;
  readonly description?: string;
  /** Required: an error state always offers a way forward (retry, go back, contact support). */
  readonly action: ReactNode;
}

export function ErrorState({ title, description, action }: ErrorStateProps) {
  return <StatePanel tone="negative" icon="alert-triangle" role="alert" title={title} description={description} action={action} />;
}
