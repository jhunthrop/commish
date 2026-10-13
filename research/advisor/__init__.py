"""THE ADVISOR (phase C).

The request-time HTTP service `api` and `room` call for the live pick recommendation, under 50 ms
per call at p90, measured. It reads what the nightly run wrote and never fits anything at request
time.
"""
