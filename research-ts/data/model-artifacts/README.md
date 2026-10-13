# Model artifacts

One JSON record per published version of every fitted table the engine serves, at
`<family>/<artifact>/v<version>.json`. These files are the reviewed input to
`npm run artifacts:publish`, which loads every record into the `model_artifacts` table of whichever
database `DATABASE_URL` names. Nothing in the server reads these files: the product reads the table
through `src/projections/model/artifacts.ts`, which pins the version each reader was written against
and fails loudly when the store lacks it.

## Record shape

```json
{
  "name": "preseason/game-variance-skill",
  "version": 1,
  "fitStamp": "2026-09-04T21:14:06-05:00",
  "fittedOn": "the train window, in the fit script's words",
  "payload": { }
}
```

`payload` is whatever the artifact's own parser accepts (`src/projections/model/artifact-catalog.ts`
names every artifact and its parser). `fitStamp` is when the fit ran; the initial records carry the
commit date of the generated module they replaced.

## How a version changes

A fit script (`npm run projections:game-variance:fit`, `projections:kdef:fit`,
`projections:props-anchor:fit`) writes the NEXT version's record here and publishes the same payload
to the store it ran against, then prints the pin to bump. The code starts serving the new version
when a reviewed commit bumps `version` in the artifact's spec. A version is immutable: publishing it
again with the same payload is a no-op, with a different payload is refused.

## Production

`npm run artifacts:publish` against production, once per new record, after the build has migrated.
The publish is idempotent, so re-running it is safe.

## Artifacts

| Name | Fit script | Readers |
| --- | --- | --- |
| `preseason/game-variance-skill` | `scripts/game-variance-fit.ts` | `loadShippedGameVariance` (`src/projections/preseason/game-variance-artifacts.ts`), every `preseasonBoard` caller |
| `preseason/game-variance-kdef` | `scripts/kdef-fit.ts` | same, composed with the skill half |
| `market/props-anchor-weight` | `scripts/props-anchor-fit.ts` | `scripts/preseason-persist.ts`, the blended arm's constants |
