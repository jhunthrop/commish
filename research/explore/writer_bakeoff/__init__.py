"""LANE 261, THE WRITER BAKE-OFF: GLM-5.3 Flash against DeepSeek V4.1 Flash on the week reads.

Both writers write every week sheet of one instant (the copy's newest rest-of-season board) through the
production writer (`capsules.week.write.write_week_read`), the same prompt, the same sentence-shape
constraints and the same judge (GLM, unchanged), all inside one dollar budget (`run_budget`). The
may-not-start drafts the judge read are judged again by DeepSeek as a second table. Nothing is written to
any store table: the sheets are read on read-only connections and the results go to a JSON file.
Exploration only, never a served module.
"""
