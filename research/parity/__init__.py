"""THE PARITY HARNESS: the measurement every switch from the TypeScript core to Python is judged by.

For each ingest, the TypeScript oracle and the Python port run on the same recorded provider
responses into two scratch databases (drizzle-migrated and alembic-migrated), and the rows they
wrote are diffed table by table. `python -m research.parity --help` for the commands.
"""
