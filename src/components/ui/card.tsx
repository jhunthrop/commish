import type { HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  readonly as?: "div" | "section" | "article";
}

export function Card({ as: Tag = "div", className = "", children, ...rest }: CardProps) {
  return (
    <Tag className={`rounded-lg border border-border bg-surface-elevated p-4 ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
