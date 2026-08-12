"""Focused CSRF and authentication tests for browser/API request boundaries."""
import base64
import os
import tempfile
import unittest


class CsrfTestCase(unittest.TestCase):
    def setUp(self):
        self.database = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
        self.database.close()
        os.environ['PTO_DB_PATH'] = self.database.name
        os.environ.pop('PTO_REQUIRE_AUTH', None)
        from app import app, init_db
        self.app = app
        self.app.config.update(TESTING=True)
        self.app.config['DATABASE'] = self.database.name
        import app as app_module
        app_module.DATABASE = self.database.name
        init_db()
        self.client = self.app.test_client()

    def tearDown(self):
        os.unlink(self.database.name)
        os.environ.pop('PTO_DB_PATH', None)
        os.environ.pop('PTO_REQUIRE_AUTH', None)

    def csrf_cookie_and_token(self):
        response = self.client.get('/')
        cookie = response.headers['Set-Cookie'].split(';', 1)[0]
        token = cookie.split('=', 1)[1]
        return cookie, token

    def test_valid_token_allows_browser_write(self):
        cookie, token = self.csrf_cookie_and_token()
        response = self.client.post(
            '/api/notes',
            json={'date': '2026-01-01', 'text': 'Valid token'},
            headers={'Cookie': cookie, 'X-CSRF-Token': token},
        )
        self.assertEqual(response.status_code, 201)

    def test_missing_token_rejects_browser_write(self):
        cookie, _ = self.csrf_cookie_and_token()
        response = self.client.post(
            '/api/notes',
            json={'date': '2026-01-01', 'text': 'Missing token'},
            headers={'Cookie': cookie},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json, {'error': 'CSRF validation failed'})

    def test_invalid_token_rejects_browser_write(self):
        cookie, _ = self.csrf_cookie_and_token()
        response = self.client.post(
            '/api/notes',
            json={'date': '2026-01-01', 'text': 'Invalid token'},
            headers={'Cookie': cookie, 'X-CSRF-Token': 'wrong-token'},
        )
        self.assertEqual(response.status_code, 403)

    def test_cookie_less_api_client_remains_compatible(self):
        response = self.client.post(
            '/api/notes',
            json={'date': '2026-01-01', 'text': 'API client'},
        )
        self.assertEqual(response.status_code, 201)

    def test_authentication_still_precedes_csrf(self):
        os.environ.update({
            'PTO_REQUIRE_AUTH': 'true',
            'PTO_AUTH_USERNAME': 'user',
            'PTO_AUTH_PASSWORD': 'pass',
        })
        cookie, token = self.csrf_cookie_and_token()
        response = self.client.post(
            '/api/notes',
            json={'date': '2026-01-01', 'text': 'Auth required'},
            headers={
                'Cookie': cookie,
                'X-CSRF-Token': token,
                'Authorization': 'Basic ' + base64.b64encode(b'user:pass').decode(),
            },
        )
        self.assertEqual(response.status_code, 201)
