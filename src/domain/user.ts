export type ExperienceTier = "beginner" | "experienced";

export interface User {
  readonly id: string;
  readonly displayName: string;
  readonly experienceTier: ExperienceTier;
  readonly avatarUrl: string | null;
  readonly createdAt: string;
}
