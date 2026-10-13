"""THE NIGHTLY RUN (phase D).

The chain that runs the ingests in `research.pipeline`, the fit, the capsules and the validation
gates at 05:00 UTC, writes every artifact under one run id to R2, and dispatches the web build. It
ships as a Cloud Run Job on a schedule. A failed gate keeps the previous run live.
"""
