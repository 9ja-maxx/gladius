#!/bin/bash
# Unified testing script for Gladius environment

echo "=== Running GenVM Linter ==="
./scripts/lint.sh
LINT_EXIT=$?

echo -e "\n=== Running Pytest Unit Tests ==="
pytest tests/direct/test_gladius_arena.py
TEST_EXIT=$?

echo -e "\n=== Verification Summary ==="
if [ $LINT_EXIT -eq 0 ] && [ $TEST_EXIT -eq 0 ]; then
    echo "✓ All checks passed successfully!"
    exit 0
else
    echo "❌ Some checks failed. Please review outputs."
    exit 1
fi
