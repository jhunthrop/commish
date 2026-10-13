"""The research lane's error taxonomy. Each class names an operator action, not a stack depth."""


class ResearchError(Exception):
    """Base of every error this lane raises on purpose."""


class ConfigurationError(ResearchError):
    """A required setting is missing or malformed. No retry fixes it; an operator does."""


class SchemaDriftError(ResearchError):
    """An upstream file or response no longer has the shape a mapper reads. Wants a human."""


class CoherenceError(ResearchError):
    """A batch contradicts itself (two values for one fact), which is a mapper bug."""
