"""Enlighten's hardware server: a small relay between the app and a hasseb USB DALI Master.

It has no governor of its own (ADR 0003). It checks who is talking to it, builds every USB report itself
from a frame it has decoded, keeps one client, and turns the lights off whenever that client goes away.
"""
