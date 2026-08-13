#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
دفتر الديون الصوتي — خادم محلي للتجربة الفورية
=================================================
يشغّل خادم ويب بسيط على http://localhost:5173 لتجربة التطبيق
كاملاً (بما فيها الميكروفون) دون أي نشر أو تثبيت أي حزمة.

لماذا هذا ضروري: التعرف الصوتي في المتصفح (Web Speech API) يرفض العمل
عند فتح الملف مباشرة (file://) لأسباب أمنية، لكنه يعمل بشكل طبيعي على
http://localhost لأن المتصفح يعتبره "سياقاً آمناً" تماماً مثل HTTPS.

الاستخدام:
  python3 serve.py

يعمل بـ Python وحده (لا يحتاج أي تثبيت إضافي)، ويفتح المتصفح تلقائياً.
"""
import http.server
import socketserver
import webbrowser
import os
import sys

PORT = 5173
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # منع التخزين المؤقت العدواني أثناء التطوير حتى تظهر التعديلات فوراً
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, format, *args):
        # سجل مختصر وواضح بدل سجل Python الافتراضي الطويل
        print(f"  → {args[0]} {args[1]}")

def main():
    try:
        with socketserver.TCPServer(("", PORT), Handler) as httpd:
            url = f"http://localhost:{PORT}"
            print("=" * 55)
            print("  دفتر الديون الصوتي — خادم محلي يعمل الآن")
            print("=" * 55)
            print(f"  افتح المتصفح على: {url}")
            print("  اضغط Ctrl+C لإيقاف الخادم")
            print("=" * 55)
            try:
                webbrowser.open(url)
            except Exception:
                pass
            httpd.serve_forever()
    except OSError as e:
        if 'Address already in use' in str(e) or e.errno in (48, 98):
            print(f"⚠️  المنفذ {PORT} مستخدم مسبقاً. أغلق أي خادم آخر يعمل عليه أو عدّل PORT في أعلى هذا الملف.")
        else:
            print(f"⚠️  خطأ في تشغيل الخادم: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nتم إيقاف الخادم.")
        sys.exit(0)

if __name__ == "__main__":
    main()
