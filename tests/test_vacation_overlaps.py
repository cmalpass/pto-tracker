import os
import sys
import tempfile
import unittest
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import app as app_module


class VacationOverlapTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        app_module.DATABASE = os.path.join(self.temp_dir.name, 'pto.db')
        app_module.init_db()
        self.client = app_module.app.test_client()
        self.config = app_module.default_config()
        self.config['pto_holidays_require_pto'] = True

    def tearDown(self):
        self.temp_dir.cleanup()

    def add(self, name, start_date, end_date):
        return self.client.post('/api/vacations', json={
            'name': name,
            'start_date': start_date,
            'end_date': end_date,
            'auto_days': True,
        })

    def test_partial_nested_and_cross_year_writes_are_rejected(self):
        self.assertEqual(self.add('Partial base', '2026-08-03', '2026-08-07').status_code, 201)
        for name, start, end in (
            ('Partial overlap', '2026-08-06', '2026-08-10'),
            ('Nested overlap', '2026-08-04', '2026-08-05'),
            ('Cross-year overlap', '2026-08-01', '2027-01-01'),
        ):
            response = self.add(name, start, end)
            self.assertEqual(response.status_code, 409)
            payload = response.get_json()
            self.assertEqual(payload['conflicts'][0]['name'], 'Partial base')
            self.assertIn('overlap', payload['error'])

    def test_unpadded_dates_are_rejected_before_overlap_check(self):
        response = self.add('Unpadded', '2026-8-03', '2026-8-07')
        self.assertEqual(response.status_code, 400)
        self.assertIn('yyyy-mm-dd', response.get_json()['error'])

    def test_update_rejects_overlap_but_allows_self(self):
        first = self.add('First', '2026-09-01', '2026-09-03').get_json()
        second = self.add('Second', '2026-09-07', '2026-09-09').get_json()
        response = self.client.put(
            f"/api/vacations/{second['id']}",
            json={'start_date': '2026-09-03', 'end_date': '2026-09-08'},
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json()['conflicts'][0]['id'], first['id'])

        response = self.client.put(
            f"/api/vacations/{second['id']}",
            json={'start_date': '2026-09-07', 'end_date': '2026-09-09'},
        )
        self.assertEqual(response.status_code, 200)

    def test_legacy_overlaps_are_counted_once_across_years(self):
        with app_module.app.app_context():
            db = app_module.get_db()
            db.executemany(
                'INSERT INTO vacations (name, start_date, end_date, days, hours) VALUES (?, ?, ?, ?, ?)',
                [
                    ('Base', '2026-12-28', '2027-01-05', 7, 0),
                    ('Partial', '2026-12-30', '2027-01-07', 7, 0),
                    ('Nested', '2026-12-29', '2027-01-02', 4, 0),
                ],
            )
            db.commit()
            used_2026, _ = app_module.calculate_vacation_usage_in_range(
                date(2026, 1, 1), date(2026, 12, 31), self.config
            )
            used_2027, _ = app_module.calculate_vacation_usage_in_range(
                date(2027, 1, 1), date(2027, 12, 31), self.config
            )

        self.assertEqual(used_2026, 4)
        self.assertEqual(used_2027, 5)

    def test_update_restores_only_legacy_booking_contribution(self):
        with app_module.app.app_context():
            db = app_module.get_db()
            db.executemany(
                'INSERT INTO vacations (name, start_date, end_date, days, hours) VALUES (?, ?, ?, ?, ?)',
                [
                    ('Earlier', '2026-08-01', '2026-08-07', 5, 0),
                    ('Base', '2026-08-03', '2026-08-11', 7, 0),
                ],
            )
            db.commit()
            existing = db.execute('SELECT * FROM vacations WHERE name = ?', ('Base',)).fetchone()
            contribution = app_module._existing_booking_amount_through(
                existing, date(2026, 12, 31), app_module.get_config()
            )

        self.assertEqual(contribution, 2)


if __name__ == '__main__':
    unittest.main()
