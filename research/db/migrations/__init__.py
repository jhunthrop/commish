"""The DDL of each alembic revision, split by table group so no file outgrows review.

A revision under `alembic/versions/` calls these; nothing else may. Each module is frozen with
its revision: a later schema change is a new revision, never an edit here.
"""
