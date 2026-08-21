#!/bin/bash
# Local linter script to check GladiusArena Intelligent Contract

echo "Running GenVM Linter on GladiusArena..."
genvm-lint check contracts/gladius_arena.py
