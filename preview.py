"""Launch a local preview server for Budget Book in browser."""
import http.server
import os
import socketserver
import webbrowser
from pathlib import Path

PORT = 8000
DIRECTORY = Path(__file__).parent / "www"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIRECTORY), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main():
    # Allow port reuse so restarting quickly doesn't error
    socketserver.TCPServer.allow_reuse_address = True
    try:
        httpd = socketserver.TCPServer(("", PORT), Handler)
    except OSError:
        # Fallback to port 8080 if 8000 is occupied
        httpd = socketserver.TCPServer(("", 8080), Handler)
        port = 8080
    else:
        port = PORT

    url = f"http://localhost:{port}/preview.html"
    print("=" * 65)
    print("  [Home Assistant 記帳本] 本地預覽伺服器已啟動")
    print(f"  請在瀏覽器開啟網址: {url}")
    print("  按 Ctrl + C 可關閉伺服器")
    print("=" * 65)
    webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止預覽伺服器。")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
