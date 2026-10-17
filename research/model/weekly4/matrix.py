"""ONE DESIGN MATRIX FOR EVERY BOOSTED MODEL: numeric columns as they are (missing as NaN, the tree's
native missing value, 2.10) and the categorical columns as fixed codes, one vocabulary for all.
"""

from collections.abc import Sequence
from types import MappingProxyType
from typing import Final

import numpy as np
import pandas as pd

VOCABULARY: Final = MappingProxyType(
    {
        "pass_location": ("left", "middle", "right"),
        "run_location": ("left", "middle", "right"),
        "run_gap": ("end", "guard", "tackle"),
        "roof": ("dome", "closed", "open", "outdoors"),  # 2.5: the four roof states, never "retractable"
    }
)


def design(frame: pd.DataFrame, features: Sequence[str]) -> tuple[np.ndarray, tuple[bool, ...]]:
    """The features as a float matrix and the categorical mask; a category outside its vocabulary,
    or none, is missing."""
    columns: list[np.ndarray] = []
    categorical: list[bool] = []
    for name in features:
        if name in VOCABULARY:
            codes = {value: float(i) for i, value in enumerate(VOCABULARY[name])}
            columns.append(frame[name].map(codes).to_numpy(dtype=float, na_value=np.nan))
            categorical.append(True)
        else:
            columns.append(frame[name].to_numpy(dtype=float, na_value=np.nan))
            categorical.append(False)
    found = np.column_stack(columns) if columns else np.empty((len(frame), 0))
    return found, tuple(categorical)
