from app import app


def test_static_shell_sets_baseline_security_headers():
    client = app.test_client()
    response = client.get("/")

    assert response.status_code == 200
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "SAMEORIGIN"
    assert response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    policy = response.headers["Content-Security-Policy"]
    assert "object-src 'none'" in policy
    assert "frame-ancestors 'self'" in policy
    assert "script-src 'self' https://cdn.jsdelivr.net" in policy


def test_chart_script_is_integrity_pinned():
    client = app.test_client()
    html = client.get("/").get_data(as_text=True)

    assert 'integrity="sha384-e6nUZLBkQ86NJ6TVVKAeSaK8jWa3NhkYWZFomE39AvDbQWeie9PlQqM3pmYW5d1g"' in html
    assert 'crossorigin="anonymous"' in html
