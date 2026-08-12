"""Timezone boundary tests for canonical application dates."""
from datetime import datetime, timezone
import unittest
from unittest.mock import patch

import app


class FrozenDateTime(datetime):
    """Provide a deterministic instant while preserving datetime behavior."""

    @classmethod
    def now(cls, tz=None):
        instant = datetime(2026, 1, 1, 0, 30, tzinfo=timezone.utc)
        return instant.astimezone(tz) if tz else instant.replace(tzinfo=None)


class TestTimezoneBoundaries(unittest.TestCase):
    def test_configured_timezone_controls_local_date_at_midnight_boundary(self):
        with patch.object(app, 'datetime', FrozenDateTime):
            self.assertEqual(app.get_local_today({'timezone': 'UTC'}).isoformat(), '2026-01-01')
            self.assertEqual(
                app.get_local_today({'timezone': 'America/Los_Angeles'}).isoformat(),
                '2025-12-31',
            )

    def test_invalid_timezone_uses_safe_utc_default(self):
        with patch.object(app, 'datetime', FrozenDateTime):
            self.assertEqual(app.get_local_today({'timezone': 'Not/A_Timezone'}).isoformat(), '2026-01-01')


if __name__ == '__main__':
    unittest.main()
