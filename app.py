"""Static application server for PTO Tracker.

All user data and PTO calculations live in the browser. Flask is retained as a
small development and deployment server for the HTML, CSS, and JavaScript
assets.
"""

import os

from flask import Flask, render_template


app = Flask(__name__, static_folder="static", template_folder="templates")


@app.after_request
def set_security_headers(response):
    """Apply baseline browser protections to the static application shell."""
    response.headers.setdefault("Content-Security-Policy", (
        "default-src 'self'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "object-src 'none'; "
        "script-src 'self' https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js; "
        "style-src 'self' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "frame-ancestors 'self'"
    ))
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return response


@app.get("/")
def index():
    """Serve the browser application shell."""
    return render_template("index.html")


if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "").lower() in {"1", "true", "yes"}
    host = os.environ.get("FLASK_HOST", "127.0.0.1")
    app.run(debug=debug, host=host, port=int(os.environ.get("PORT", "5000")))
