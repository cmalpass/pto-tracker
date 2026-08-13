"""Static application server for PTO Tracker.

All user data and PTO calculations live in the browser. Flask is retained as a
small development and deployment server for the HTML, CSS, and JavaScript
assets.
"""

import os

from flask import Flask, render_template


app = Flask(__name__, static_folder="static", template_folder="templates")


@app.get("/")
def index():
    """Serve the browser application shell."""
    return render_template("index.html")


if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "").lower() in {"1", "true", "yes"}
    host = os.environ.get("FLASK_HOST", "127.0.0.1")
    app.run(debug=debug, host=host, port=int(os.environ.get("PORT", "5000")))
