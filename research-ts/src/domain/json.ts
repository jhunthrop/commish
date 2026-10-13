/** A JSON value as it round-trips through a `jsonb` column or a job payload: the research core's
 *  jobs and register rows carry it, and the audit vocabulary (`./audit`) re-exports it. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}
