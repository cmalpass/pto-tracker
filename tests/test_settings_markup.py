from app import app


def test_pay_period_options_use_unambiguous_payroll_terms():
    html = app.test_client().get("/").get_data(as_text=True)

    assert "24 — Semi-monthly (twice monthly)" in html
    assert "26 — Biweekly (every two weeks)" in html
    assert "27 — Biweekly year with 27 pay dates" in html
    assert "52 — Weekly" in html
    assert "semi-monthly and biweekly schedules are different" in html
